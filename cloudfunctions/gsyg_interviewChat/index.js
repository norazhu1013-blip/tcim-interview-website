// 云函数 gsyg_interviewChat —— AI 访谈动态追问(v2.1:任务卡预生成 + 阶段化)
// 入参优先级:taskCard(session 里已存的完整卡) > taskCardSeed(现场拼) > kbSlice(v1 兜底)
//   { sessionId, itemId, itemContext:{stem,options,title},
//     teacherRanking,               // 最终排序数组 ['B','D','A','C']
//     taskCard? / taskCardSeed?,    // 二选一;taskCard 由 gsyg_selectFinal 预生成落地
//     stage,                        // 'S1_CONTEXT' | 'S2_COMPARE' | 'S3_STRATEGY' | 'S4_SUMMARY'
//     processTags[], history[], remainingMs,
//     kbSlice? }                    // v1 老字段
// 返回:{ ok, question, done, evidenceHint[], stage, nextStage }
//
// 硬约束(system prompt 内已声明):
//   1) 不透露标准排序 / 得分 / 对错;2) 每轮只问一个问题;3) 语气专业但通俗、非评判、不诱导
//
// 环境变量:
//   WXAI_MODEL/WXAI_PROVIDER/LLM_TIMEOUT_MS/SEC_CHECK 见 README
//   网页第三方 AI: WEB_INTERVIEW_LLM_PROFILE/DEEPSEEK_API_KEY/OPENAI_COMPATIBLE_* 等见 README

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_MODEL = process.env.WXAI_MODEL || 'hy3-preview';
const DEFAULT_PROVIDER = process.env.WXAI_PROVIDER || 'cloudbase';
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30000); // 2026-07-09 提到 30s:hy3-preview 生成 200-400 字 + 网络往返常需 15-25s,12s 频繁超时导致回退规则版
const SEC_CHECK_ON = String(process.env.SEC_CHECK || '') === '1';
const MAX_ANSWERABLE_AI_QUESTIONS = 6;
const DEFAULT_CLOSING_MESSAGE = '感谢您的分享，本情境的访谈先到这里。';

// LLM 配置白名单。前端只能传 llmProfile 选择这里已有的配置,不能传 endpoint/key。
// 密钥仍走云函数环境变量,不要写入代码或前端构建变量。
const LLM_PROFILES = Object.freeze({
  wxai: { type: 'wxai' },
  deepseek: {
    type: 'openai-compatible',
    endpoint: 'https://api.deepseek.com/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE || 0.2),
    maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 900)
  },
  'openai-compatible': {
    type: 'openai-compatible',
    endpoint: process.env.OPENAI_COMPATIBLE_ENDPOINT || '',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    model: process.env.OPENAI_COMPATIBLE_MODEL || '',
    temperature: Number(process.env.OPENAI_COMPATIBLE_TEMPERATURE || 0.2),
    maxTokens: Number(process.env.OPENAI_COMPATIBLE_MAX_TOKENS || 900)
  }
});

// ⚠️ 以下两个文件的 canonical 源在 tools/,由 `node tools/sync_cf.js` 物理拷入本目录。
//    改这些前先改 tools/ 里的原文件,再跑 sync,不要直接改本目录副本(会被覆盖)。
// canonical: tools/knowledge.json (由 tools/build_knowledge_v16.js 从 DOC/inbox_0709/_kb16/*.xlsx 生成)
let KB = null;
try { KB = require('./knowledge.json'); } catch (e) { console.warn('[kb] knowledge.json 加载失败:', e && e.message); KB = { items: {} }; }
// canonical: tools/task_card_builder.js (与 gsyg_selectFinal 共用同一份实现)
const taskCardBuilder = require('./task_card_builder.js');
taskCardBuilder.setKnowledge(KB);
const { STAGES, STAGE_LABEL, buildTaskCard, decideNextStage } = taskCardBuilder;

/* ------------------------------ prompt 构造 ------------------------------ */
// 2026-07-16:访谈策略升级为「决策程序版」v4.2(源:研究团队《AI 访谈运行提示词 v4.2》)。
//   · 系统提示词 = 静态访谈策略(先在内部形成"教师判断图";每轮只执行细化 S/T/A/R、
//     深化 ATTRIBUTE/CONSEQUENCE/VALUE/SCALE、拓展 REFRAME/…/STRUCTURE 三种功能之一;
//     关系深度优先;按答案空间去重;前提检验;反事实限量;任务卡降权;八项问题选择标准;
//     易懂性检核;句式与可回答/不可回答收束规则)。
//   · 个性化任务卡与教师排序作为「动态输入」放到 user 消息(见 buildUserPrompt)。
//   · 保留项目红线:不透露专家排序/得分/标准答案/对错;纯文字;严格 JSON。
// 注:任务卡数据由 gsyg_selectFinal 预生成(session.selection.final[i].task_card),
//    在 buildUserPrompt 内映射为该提示词的「动态输入」字段;缺卡时降级用 kbSlice。

const INTERVIEW_POLICY = [
  '你正在访谈一名已经完成幼儿园教师情境判断题排序的教师。程序已经选出当前值得访谈的情境，并向你提供题干、四个做法、教师排序、任务卡与对话历史。',
  '',
  '你的工作不是复测教师，也不是寻找标准答案，而是每轮只提出一个问题，使教师的专业判断比上一轮更清楚、更深入，或显现新的边界。',
  '',
  '【硬约束 — 不可违反(项目红线)】',
  '1) 绝不透露是否存在标准答案、专家排序、得分、排名或对错;只围绕教师本人的真实排序追问，不诱导预设答案。',
  '2) 每轮只提一个问题;承接语不是每轮必需，只在确认理解、建立转折或指出关键关系时使用。',
  '3) 语气专业但通俗、非评判;纯文字交流。',
  '4) 输出必须是严格 JSON(见文末【输出】)，不要 Markdown、不要代码块围栏。',
  '',
  '一、先在内部形成"教师判断图"',
  '不要把访谈理解为需要逐项填满的问卷。你只需根据已有材料，在内部逐渐形成一张教师判断图：',
  '教师注意的情境线索 → 对问题的界定和任务优先级 → 看重的策略特征 → 预期的作用过程与后果 → 试图保护的教育关切 → 判断成立或改变的条件',
  '这张图用于选择下一问和避免重复，不向教师展示。只记录教师已经明确表达的内容;你的推测只能标记为待检验假设，不能写成教师的稳定观念。',
  '一次访谈不要求把判断图的所有位置都问满。优先追问最能解释教师当前排序、最有分析价值的一条关系。',
  '访谈深度来自教师在情境线索、策略选择、预期后果、教育关切和成立条件之间建立了什么关系，不来自教师提供了多少动作细节、观察指标或现场话术。具体化只有在能够检验关键判断时才有价值；如果只是增加同类细节，应转向理由链下一层或结束当前情境。',
  '',
  '二、每轮只执行一种问题功能',
  '可使用三种问题功能：细化、深化、拓展。它们不是三个题库，而是三种推进教师思考的操作。',
  '',
  '1. 细化：把概括判断变成情境化、可分析的实践判断。细化不是“补齐信息”，而是把教师的排序或抽象语言展开为一条可以分析的实践关系。每轮只选下面一个操作：',
  '- 情境解释 S：用题干中的具体线索、矛盾或未说明条件，问教师如何解释它。构造式「具体线索或矛盾 + 这一线索对教师意味着什么/作答时作了什么假设」。',
  '- 任务判断 T：把两个可能同时合理但存在张力的教育任务并置，问教师如何定优先级。构造式「目标 A 与目标 B 的张力 + 此刻优先哪一个/什么条件决定优先级」。',
  '- 行动推演 A：把"支持、尊重、引导、鼓励"等原则转成现场语言、行动顺序或调整节点。构造式「首选策略中的关键动作 + 第一句话、第一步或一个调整节点中的一项」。',
  '- 结果标准 R：把"有效"转成教师认可的结果标准，了解什么变化能够支持或动摇原判断。构造式「策略实施后的可能结果 + 什么变化能说明目标正在实现/什么结果会使教师调整判断」。',
  '不要预先假定“表面配合”与“真正投入”、“角色游戏”与“身体运动”等一定相互排斥。只有题干或教师原话支持时才追问该区别；教师可以认为两个目标能够同时实现。',
  '细化问题必须抓住一个具体锚点，不能只问"您怎么看""为什么这样排序"或"请详细说说"。',
  '细化示例：不要问“您怎样理解小明的行为”；应问“小明一边说‘我不会搭’，一边已经把房子从一层加高到两层。您怎样理解这个看起来有些矛盾的表现？”',
  '同一情境中，以索取“具体说什么、具体做什么、观察什么表现或依据什么信号”为主要任务的问题通常合计使用一次即可。若第一次回答仍是抽象口号且该实践关系确实关键，可补充一次，但不得连续索要同类细节。获得一项足以分析的行动或结果标准后，优先转向作用机制、教育关切、价值权衡或适用条件。',
  '',
  '2. 深化：沿"策略特征—后果—教育关切—条件"推进一层。深化是建立教师理由之间的联系，而不是继续收集更多做法。先判断教师已说到链条哪一层，只追问下一条尚未说明的关系。',
  '深化链：区别性策略特征 A → 直接反应或作用机制 C1 → 后续影响 C2 → 教育关切 V → 价值冲突或适用条件。',
  '- 教师只说"D 更好"：先比较 D 与相邻选项，识别真正决定排序的策略特征。构造式「选项 X 和 Y 的共同点 + 一个具体差异 + 哪个差异真正决定排序」。',
  '- 教师已指出策略特征：追问它首先怎样改变儿童反应，再怎样影响后续活动或关系。构造式「教师刚说的特征 + 首先带来什么可观察变化 + 该变化再影响什么」。',
  '- 教师已说出后果：追问为什么这一后果在当前情境中值得保护。构造式「教师刚说的后果 + 它关系到什么教育机会或专业责任」。',
  '- 教师已说出教育关切：追问它与另一个同样合理的关切冲突时怎样权衡。构造式「关切 A 与关切 B 的冲突 + 什么条件决定优先级」。',
  '- 教师把因果说得过于确定：追问副作用、必要条件或反例。构造式「原有后果链 + 可能的相反后果/缺少什么条件时链条不成立」。',
  '不要连续空泛地问"为什么重要"。每一问必须复用教师上一层回答中的具体词语，并使理由链前进一层。',
  '刻度只在需要显现"程度和移动条件"时使用：①只选一个评价维度(现实采用可能性/适宜程度/实施信心/排序确信度);②明确 0 分与 10 分各代表什么;③给分后只选一个方向追问(已有基础/尚存障碍/提高一分/下降条件/可观察变化);④不要把所有选项逐一评分，也不要连问"为什么不是更低"和"为什么不是更高"。',
  '深化示例：教师已经说明回顾已有成果能够增加小明的信心，不要再问“为什么回顾经验很重要”，也不要继续索要另一组现场话术；可以问“当小明注意到自己已经搭好两层以后，这会怎样影响他下一次求助的方式？”',
  '',
  '3. 拓展：针对已经显现的一项前提，引入一个可检验的新差异。只有当教师原来的情境解释、策略理由或教育关切已较清楚时才使用。拓展不是反驳教师，也不是换一种方式暗示专家答案，而是让一个原先未被注意的差异进入判断。',
  '每次拓展必须四步：准确承接教师原判断 → 一次引入一个新差异 → 要求比较证据、后果或边界 → 允许教师接受、修改或拒绝。',
  '新差异只能从以下一种方式产生：',
  '- 重新命名：把教师使用的评价性名称与中性行为描述或另一种可能名称比较，看两种框定各突出什么。',
  '- 替代假设：提出一个同样能解释部分题干信息的暂时假设，问什么证据支持、什么证据反驳。',
  '- 观察位置：从当事儿童、其他幼儿或协作教师的位置看该策略可能意味着什么，不替他人断言内心。',
  '- 单一条件变化：只改变一个条件(安全风险/儿童经验/时间/人手/材料)，检验原判断边界。',
  '- 概念边界：比较"尊重与放任""支持独立与拒绝求助"等相近概念，用具体行为划界。',
  '- 实践结构：考察班额、师幼比、空间、材料、时间或园所评价怎样塑造选项，不把责任简单推给个人或制度。',
  '替代角度必须同时满足：与题干或教师原话有依据;使用"也有一种可能""如果暂时这样理解"等可撤回语言;可说明支持证据与反驳证据;教师拒绝时其拒绝理由仍视为有效资料。',
  '一个情境中原则上只使用一次新增假设或反事实。不得连续加入题干中没有的儿童语言、动作或事件，也不得不断增加反例迫使教师修改判断。教师回应后，下一问回到已显现的关系，转向后果、教育关切或适用边界。',
  '拓展示例：教师已经明确把小明的求助解释为缺少独立性，可以问“您目前更倾向于把反复求助理解为缺少独立性。也有一种可能是，小明是在确认教师是否愿意陪伴他。什么情况会让您更倾向于后一种理解？”',
  '',
  '4. 检查问题所依赖的前提',
  '生成任何问题前，检查其中的区别、冲突或因果关系是否有题干或教师原话支持，不为制造区分度而强行建立二分。',
  '如果教师认为两种状态“没有明显不同”“可以兼顾”“不一定”或“需要看情况”，这是对分析前提的实质修正。不要换例子继续维持原二分；改问两个目标怎样同时实现、什么条件下才发生冲突、教师认为更关键的另一项区别，或直接放弃该方向。',
  '',
  '三、怎样选择本轮问题类型',
  '首问(对话历史为空)：不要假定教师缺少什么，也不要说"您刚才提到"。在内部生成两个候选(一个细化：优先题干最有解释空间的矛盾线索或最能显现任务优先级的冲突;一个深化：比较教师排序中最相邻、最能区分判断的两个选项)，选更能打开教师判断过程、且不暗示标准答案的一问。首问不得使用拓展。',
  '追问：先从教师最近回答提取一个最值得推进的判断，确定它在判断图中的位置——',
  '- 只有概念或结论，无情境含义/行动/判断标准 → 用细化;',
  '- 已有具体做法或特征，但没说明怎样产生后果/保护什么/在何条件下成立 → 用深化;',
  '- 解释和理由链已清楚，且有一项可检验的命名/假设/遗漏视角/无条件化判断 → 用拓展;',
  '- 拓展后提出新行动设想但仍抽象 → 回到细化;',
  '- 拓展后出现新的后果或价值冲突 → 回到深化。',
  '- 已获得一项足以分析的行动或观察标准 → 不再索要同类细节，优先转向后果、教育关切、价值冲突或成立条件。',
  '类型转换由教师回答决定，不按固定题数推进，也不需要把 STAR、ACV 或所有拓展方式逐项使用。',
  '',
  '四、去重规则',
  '生成问题前，先从对话历史建立内部记录(已问的"锚点+认知操作+可能答案空间"、已明确回答的判断、已形成的因果与条件、已用的拓展角度)，然后：',
  '1. 候选问题的实质答案已在历史中出现 → 丢弃;',
  '2. 即使更换情境细节，只要仍要求相同认知操作、给出同一类答案，也属于重复并丢弃。“观察什么/什么信号/怎样看出/什么变化才算有效”同属观察判断；“具体说什么/第一句话/如何询问或邀请”同属现场话术；“接下来怎么做/某反应后怎么调/儿童拒绝怎么办”若只索要行动细节，同属行动推演;',
  '3. 同一教师原话可继续向下一层推进，但不能停在同一层反复确认;',
  '4. 一轮只推进一条关系(不同时问 S/T/A/R，不把 A/C/V 塞进同一问);',
  '5. 教师重复上一轮回答时，不要把原问题改写再问;向下一层/相反条件/适用边界推进;若无高价值方向则收束该情境;',
  '6. 任务卡是候选素材而非访谈脚本，不要因其提供多个示例就逐个照问;',
  '7. 未覆盖的任务卡证据允许保留为“本次访谈未确认”。不得仅因某条证据未覆盖，就提出实质重复、前提不足或低价值问题。问题选择首先服从教师当前表达与对话连续性，其次才考虑任务卡。',
  '',
  '五、问题选择标准：在内部比较以下八点，选择综合价值最高的一问，不向教师展示比较过程：',
  '1. 解释力：回答能否更好地解释教师为何形成当前排序；',
  '2. 连续性：是否紧接教师最近表达，而不是突然换话题；',
  '3. 推进价值：能否增加一条新的判断关系，而不只是增加同类细节；',
  '4. 区分度：能否区分两种可能的情境理解、任务优先级、后果链或适用条件；',
  '5. 前提正当性：问题中的区别、冲突或因果关系是否有题干或教师原话支持；',
  '6. 安全性：是否非评判、非诱导，并允许教师表达兼容关系、不确定或不同意见；',
  '7. 易懂性：教师能否在听到一遍后立即明白问题在问什么、需要完成哪一种思考；',
  '8. 互动负担：教师是否已回答过相似问题；新增价值是否足以抵消重复思考和作答负担。',
  '',
  '六、问题句式要求',
  '- 每轮最多一句简短承接语 + 一个主问题。承接语不是每轮必需；只在确认理解、建立转折或指出关键关系时使用，不机械反复以“您说……”开头;',
  '- 问题必须含题干细节、选项差异或教师原话中至少一个具体锚点;',
  '- 优先要求教师完成一种认知动作：解释/比较/排序/推演/检验/划界;',
  '- 使用自然、口语化且符合幼儿园教师日常表达习惯的语言；能用常用词说清楚时，不使用抽象术语、书面化套语或过长修饰语；',
  '- 一个问题只保留一个主要询问重点；若句中出现多个条件、比较对象或连续追问，删减到教师听一遍即可抓住的核心；',
  '- 输出前在内部做一次易懂性检核：①主问题是否过长或结构嵌套；②指代是否明确；③抽象概念是否可换成具体情境或可观察表现；④是否暗含两个以上需要分别回答的问题。任一项不满足时，先改写再输出；',
  '- 易懂性改写不得删除本轮的具体锚点，也不得把有分析价值的比较或检验简化成无锚点的泛问；',
  '- 避免"为什么这样排序""您怎么看""还有吗""请详细说明"等无锚点问题;',
  '- 不向教师说出 STAR、ACV、价值链、反身性等理论名称;',
  '- 不使用"正确做法""优秀教师通常""是不是应该"等权威或道德暗示;',
  '- 不把教师一次回答概括成稳定人格、底层价值观或能力等级。',
  '',
  '七、何时结束当前情境',
  '满足任一充分条件即可结束，不必问满所有维度：已形成能解释排序的判断链；教师已说明一个关键策略特征，并进一步说明后果、教育关切或适用条件中的至少一项；新问题只会重复已有内容；剩余时间不足。不要求补齐三类问题或任务卡全部证据，问题的新增分析价值优先于数量。',
  '如果还需教师确认或修正总结，应把确认作为可回答的问题并令 done=false；教师回答后，下一轮才令 done=true。done=true 时输出中性、陈述性的收束语，不再提问、不要求继续回答，也不给专家评价。',
  '',
  '【输出】只输出严格 JSON，无任何多余字符/代码块围栏：',
  '{"next_question":"done=false 时为发送给教师的一个主问题；done=true 时为不要求回答的陈述性收束语","done":false,"covered_evidence":[],"question_strategy":{"mode":"opening/follow_up/closing","type":"细化/深化/拓展/收束","operator":"S/T/A/R/ATTRIBUTE/CONSEQUENCE/VALUE/SCALE/REFRAME/ALTERNATIVE/OBSERVER/CONTEXT/BOUNDARY/STRUCTURE/CLOSE","anchor":"本轮锚定的题干细节/选项差异/教师原话","relation_sought":"本轮希望教师建立、比较或检验的一条关系","advances_from":"相较上一轮新增的推进;首问填从题干或排序打开判断"}}',
  '- next_question：可直接发送给教师;禁止出现编号/括注/内部术语/理论名称。done=false 时必须是一个可回答的主问题；done=true 时必须是陈述性收束语，不得含问号或要求确认、解释、补充、选择;',
  '- done：应结束该情境返回 true，否则 false；',
  '- covered_evidence：只记录教师已经明确说出的内容(可用任务卡证据点原文或其编号);首问必须为空 [];',
  '- question_strategy：仅供后台研究审计，不向教师展示。'
].join('\n');

function buildSystemPrompt(ev, taskCard) {
  // 系统提示词为静态访谈策略;个性化数据全部走 user 消息的「动态输入」。
  // taskCard 参数保留以兼容调用点(当前 system 段不再拼接任务卡明细)。
  return INTERVIEW_POLICY;
}

function fmtRemain(ms) {
  if (typeof ms !== 'number' || ms < 0) return '未知';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m + ' 分 ' + (ss < 10 ? '0' : '') + ss + ' 秒';
}

function buildUserPrompt(ev, taskCard) {
  const ctx = ev.itemContext || {};
  const opts = ctx.options
    ? Object.keys(ctx.options).map((k) => k + '：' + ctx.options[k]).join('\n')
    : '';
  const ranking = Array.isArray(ev.teacherRanking) ? ev.teacherRanking.join(' > ') : (ev.teacherRanking || '');

  const tap = (taskCard && taskCard.teacher_answer_profile) || {};
  const af = (taskCard && taskCard.ability_focus) || {};
  const kb = ev.kbSlice || {};

  // 教师初始排序与变化
  let initLine = '（无记录）';
  if (tap.teacherInitialOrder) {
    initLine = String(tap.teacherInitialOrder).split('').join(' > ')
      + (tap.orderChangeSummary ? '（' + tap.orderChangeSummary + '）' : (tap.orderChanged ? '（有调整）' : '（未调整）'));
  }

  // 任务卡候选素材(仅供产生候选问题)
  const focus = af.interview_main_focus || af.primary_ability_type || '（未指定）';
  const optText = (L) => (L && ctx.options && ctx.options[L]) ? ('做法' + L + '：' + ctx.options[L]) : (L ? ('做法' + L) : '');
  const prioOpt = tap.priorityOption ? optText(tap.priorityOption) : '（无）';
  const prioPair = tap.priorityPair
    ? String(tap.priorityPair).split(/[^A-D]/).filter(Boolean).map(optText).join('；')
    : '（无）';

  let hyp = (taskCard && taskCard.interview_hypotheses) || [];
  let probes = (taskCard && taskCard.recommended_probes) || [];
  let evtar = (taskCard && taskCard.must_obtain_evidence) || [];
  if (!taskCard) {
    // 兜底(老 session 无预生成任务卡):从 kbSlice 取脚本/证据点
    probes = (kb.scripts || []).map((s) => s.q).filter(Boolean).slice(0, 6);
    evtar = (kb.evidence || kb.evidence_points || [])
      .map((e) => (e.code ? e.code + ' ' : '') + (e.name || '')).filter((s) => s.trim());
  }
  const listBlock = (arr) => (arr && arr.length)
    ? arr.slice(0, 6).map((x, i) => '\n  ' + (i + 1) + '. ' + x).join('')
    : '（无）';

  const hist = (ev.history || [])
    .map((h) => (h.role === 'me' || h.role === 'teacher' ? '教师' : 'AI') + '：' + h.text)
    .join('\n');

  return [
    '【当前情境】' + (ctx.stem || ''),
    opts ? '【四个做法】\n' + opts : '',
    '【教师最终排序：最理想→最不理想】' + ranking,
    '【教师初始排序与变化，如有】' + initLine,
    '',
    '【个性化任务卡，仅供产生候选问题，不要求逐项覆盖，不要照读给教师】',
    '访谈焦点：' + focus,
    '值得关注的选项：' + prioOpt,
    '值得比较的选项对：' + prioPair,
    '可选待检验假设：' + listBlock(hyp),
    '可选参考问题：' + listBlock(probes),
    '可选证据线索：' + listBlock(evtar),
    (ev.processTags && ev.processTags.length) ? '过程标签（仅作追问线索，勿作评价）：' + ev.processTags.join('、') : '',
    '',
    hist ? '【完整对话历史】\n' + hist : '【尚未开始追问，请出首问(不得使用拓展)】',
    '【剩余时间】' + fmtRemain(ev.remainingMs),
    '请按 system 指定的严格 JSON 输出。'
  ].filter(Boolean).join('\n');
}

/* ------------------------------ LLM 调用 ------------------------------ */

function isWebGatewayCall(event) {
  const gateway = event && event.__gsygGateway;
  return Boolean(gateway && gateway.actor && String(gateway.actor).indexOf('web:') === 0);
}

function resolveLLMProfile(event) {
  const requested = String((event && event.llmProfile) || '').trim();
  const defaultForWeb = String(process.env.WEB_INTERVIEW_LLM_PROFILE || 'wxai').trim();
  const id = requested || (isWebGatewayCall(event) ? defaultForWeb : 'wxai');
  if (!LLM_PROFILES[id]) {
    throw new Error('unsupported_llm_profile:' + id);
  }
  const config = LLM_PROFILES[id];
  console.log('[llm_profile] selected', JSON.stringify({
    id,
    type: config.type,
    requested: requested || '',
    isWebGateway: isWebGatewayCall(event)
  }));
  return { id, config };
}

function llmResponseMeta(selected) {
  if (!selected || !selected.config) return { llmProfile: '', llmModel: '' };
  return {
    llmProfile: selected.id,
    llmModel: selected.config.type === 'wxai' ? DEFAULT_MODEL : (selected.config.model || '')
  };
}

function safeLLMResponseMeta(event) {
  try {
    return llmResponseMeta(resolveLLMProfile(event));
  } catch (e) {
    return { llmProfile: '', llmModel: '' };
  }
}

function endpointHost(endpoint) {
  try { return new URL(endpoint).host; } catch { return ''; }
}

async function callLLM(selected, system, user) {
  if (selected.config.type === 'wxai') {
    return callWxAI(system, user, selected.id);
  }
  if (selected.config.type === 'openai-compatible') {
    return callOpenAICompatible(selected.id, selected.config, system, user);
  }
  throw new Error('unsupported_llm_profile_type:' + selected.config.type);
}

// 微信云开发 AI（`cloud.extend.AI.createModel(...)`）主接口是 `streamText`（SSE）。
// 需要 wx-server-sdk ^3.0.0；package.json 已升级。
async function callWxAI(system, user, profileId) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
  console.log('[wxai] call', JSON.stringify({ profileId: profileId || 'wxai', model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER, timeoutMs: LLM_TIMEOUT_MS }));

  // wxai 在不同 wx-server-sdk 版本下暴露路径不同：
  //   4.x 稳定路径优先 cloud.extend.AI；老版本或某些运行时只注入 cloud.ai。两者 API 形状一致。
  // wx-server-sdk 4.x：cloud.ai 是工厂函数，需先实例化，再调实例上的 createModel(modelId)。
  //   兼容 cloud.extend.AI（若某版本注入）；否则走 cloud.ai()。
  let ai;
  if (cloud.extend && cloud.extend.AI && typeof cloud.extend.AI.createModel === 'function') {
    ai = cloud.extend.AI;
  } else if (typeof cloud.ai === 'function') {
    ai = cloud.ai();
  } else {
    throw new Error('wxai 缺失：cloud.ai / cloud.extend.AI 均不可用');
  }
  if (typeof ai.createModel !== 'function') {
    throw new Error('wxai 实例上无 createModel 方法');
  }
  // provider 先试 DEFAULT_PROVIDER，失败再回退传 model_id 本身（少数版本 createModel 直接吃 model_id）
  let model, providerUsed = DEFAULT_PROVIDER;
  try {
    model = ai.createModel(DEFAULT_PROVIDER);
  } catch (e) {
    try { model = ai.createModel(DEFAULT_MODEL); providerUsed = DEFAULT_MODEL; }
    catch (e2) { throw new Error('createModel 失败：' + ((e && e.message) || e) + ' / 回退亦失败：' + ((e2 && e2.message) || e2)); }
  }

  console.log('[wxai] model created', JSON.stringify({ providerUsed, model: DEFAULT_MODEL, hasGenerateText: typeof model.generateText === 'function', hasStreamText: typeof model.streamText === 'function' }));

  const t0 = Date.now();
  // 优先非流式，失败回落 streamText
  if (typeof model.generateText === 'function') {
    try {
      const res = await model.generateText({ model: DEFAULT_MODEL, messages: messages, data: { model: DEFAULT_MODEL, messages: messages } });
      const t = extractText(res);
      if (t) {
        console.log('[wxai] ok generateText', JSON.stringify({ model: DEFAULT_MODEL, providerUsed, ms: Date.now() - t0, chars: t.length }));
        return t;
      }
    } catch (e) {
      // 若是"model not found"意味着 createModel 传的应该就是 model_id 而非 provider，做二次尝试
      const msg = (e && (e.errMsg || e.message)) || '';
      console.warn('[wxai] generateText failed', JSON.stringify({ providerUsed, model: DEFAULT_MODEL, err: msg }));
      if (/MODEL_NOT_FOUND|not found/i.test(msg) && providerUsed !== DEFAULT_MODEL) {
        try {
          const m2 = ai.createModel(DEFAULT_MODEL);
          console.log('[wxai] retry with createModel(modelId)', JSON.stringify({ model: DEFAULT_MODEL }));
          if (typeof m2.generateText === 'function') {
            const r2 = await m2.generateText({ model: DEFAULT_MODEL, messages: messages, data: { model: DEFAULT_MODEL, messages: messages } });
            const t2 = extractText(r2);
            if (t2) {
              console.log('[wxai] ok generateText retry', JSON.stringify({ model: DEFAULT_MODEL, ms: Date.now() - t0, chars: t2.length }));
              return t2;
            }
          }
          if (typeof m2.streamText === 'function') {
            const out = await drainStream(await m2.streamText({ model: DEFAULT_MODEL, messages: messages, data: { model: DEFAULT_MODEL, messages: messages } }));
            console.log('[wxai] ok streamText retry', JSON.stringify({ model: DEFAULT_MODEL, ms: Date.now() - t0, chars: out.length }));
            return out;
          }
        } catch (e3) { /* 交给下面 streamText 兜底或最终抛错 */ }
      }
    }
  }

  if (typeof model.streamText !== 'function') {
    throw new Error('模型 ' + DEFAULT_MODEL + '(provider=' + providerUsed + ') 未提供 streamText/generateText');
  }
  const res = await model.streamText({ model: DEFAULT_MODEL, messages: messages, data: { model: DEFAULT_MODEL, messages: messages } });
  const out = await drainStream(res);
  console.log('[wxai] ok streamText', JSON.stringify({ model: DEFAULT_MODEL, providerUsed, ms: Date.now() - t0, chars: out.length }));
  return out;
}

async function callOpenAICompatible(profileId, profile, system, user) {
  if (!profile.endpoint) throw new Error('llm_profile_missing_endpoint:' + profileId);
  const apiKey = process.env[profile.apiKeyEnv];
  if (!apiKey) throw new Error('llm_profile_missing_api_key:' + profile.apiKeyEnv);
  if (!profile.model) throw new Error('llm_profile_missing_model:' + profileId);

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
  const payload = {
    model: profile.model,
    messages,
    temperature: profile.temperature,
    max_tokens: profile.maxTokens
  };
  console.log('[third_llm] call', JSON.stringify({
    profileId,
    model: profile.model,
    endpointHost: endpointHost(profile.endpoint),
    timeoutMs: LLM_TIMEOUT_MS
  }));

  const response = await fetch(profile.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
  if (!response.ok) {
    const msg = body && (body.error && (body.error.message || body.error.code) || body.message || body.text);
    throw new Error('third_llm_http_' + response.status + ':' + String(msg || '').slice(0, 200));
  }
  const text = extractText(body);
  if (!text) throw new Error('third_llm_empty_response:' + profileId);
  console.log('[third_llm] ok', JSON.stringify({ profileId, model: profile.model, chars: text.length }));
  return text;
}

// 兼容多种返回形态：dataStream/eventStream/textStream/AsyncIterable
async function drainStream(res) {
  if (!res) return '';
  // 直接是字符串
  if (typeof res === 'string') return res;
  // 直接给出 text（有些实现流式聚合后返回）
  if (typeof res.text === 'string') return res.text;

  // 优先 textStream（若存在，chunk 已是纯文本）
  if (res.textStream && typeof res.textStream[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const chunk of res.textStream) out += (typeof chunk === 'string' ? chunk : (chunk && chunk.content) || '');
    return out;
  }
  // eventStream：SSE 事件 { event, data }
  if (res.eventStream && typeof res.eventStream[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const ev of res.eventStream) out += extractDelta(ev && ev.data);
    return out;
  }
  // dataStream：yields raw data 行（"data: {json}" 或 直接 JSON 串）
  if (res.dataStream && typeof res.dataStream[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const line of res.dataStream) out += extractDelta(line);
    return out;
  }
  // 顶层可迭代
  if (typeof res[Symbol.asyncIterator] === 'function') {
    let out = '';
    for await (const chunk of res) out += extractDelta(chunk);
    return out;
  }
  return extractText(res);
}

// 解析 SSE 里的单行 data → 增量文本
function extractDelta(chunk) {
  if (chunk == null) return '';
  if (typeof chunk === 'string') {
    const s = chunk.replace(/^data:\s*/, '').trim();
    if (!s || s === '[DONE]') return '';
    try {
      const j = JSON.parse(s);
      return pickContent(j);
    } catch (e) {
      return s; // 非 JSON 就当纯文本
    }
  }
  if (typeof chunk === 'object') return pickContent(chunk);
  return '';
}

function pickContent(j) {
  if (!j) return '';
  if (typeof j === 'string') return j;
  const c = j.choices && j.choices[0];
  if (c) return (c.delta && c.delta.content) || (c.message && c.message.content) || c.text || '';
  return j.content || j.text || j.output || '';
}

function extractText(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (res.text) return res.text;
  if (res.output) return res.output;
  if (res.choices && res.choices[0]) {
    const c = res.choices[0];
    return (c.message && c.message.content) || c.text || '';
  }
  if (res.data && res.data.output) return res.data.output;
  return '';
}

// 12s 内 llm 未返回视为失败
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('LLM 超时 ' + ms + 'ms')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/* ------------------------------ JSON 解析 ------------------------------ */

// 模型偶尔会用 ```json 包裹或前后带闲话。做鲁棒抽取。
function parseModelJSON(text) {
  if (!text) return null;
  const raw = String(text).trim();
  // 去掉 ```json ... ``` 包裹
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const tryParse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  let obj = tryParse(stripped);
  if (obj) return obj;
  // 提取首个 {...}
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) obj = tryParse(m[0]);
  return obj;
}

function normalizeResult(obj, rawText) {
  const question = (obj && typeof obj.next_question === 'string' && obj.next_question.trim())
    ? obj.next_question.trim()
    : (rawText ? String(rawText).trim() : '');
  const done = !!(obj && obj.done === true);
  // 决策程序版:covered_evidence 记录「教师已明确说出的内容」,可能是任务卡证据点原文或其编号,
  // 不再强制 E1-E7;此处宽松保留非空字符串项(去空白、去重)。
  const covered = Array.isArray(obj && obj.covered_evidence)
    ? Array.from(new Set(obj.covered_evidence
        .filter((c) => typeof c === 'string' && c.trim())
        .map((c) => c.trim())))
    : [];
  const strategy = (obj && obj.question_strategy && typeof obj.question_strategy === 'object')
    ? obj.question_strategy
    : null;
  return { question, done, evidenceHint: covered, questionStrategy: strategy };
}

/* ------------------------------ 内容安全 ------------------------------ */

async function secCheck(text) {
  if (!SEC_CHECK_ON) return { pass: true };
  if (!text) return { pass: true };
  try {
    const openapi = cloud.openapi ? cloud.openapi({ env: cloud.DYNAMIC_CURRENT_ENV }) : null;
    if (!openapi || !openapi.security || !openapi.security.msgSecCheck) return { pass: true, note: 'openapi_unavailable' };
    // scene 4 = 资料；version 2 参见微信文档
    await openapi.security.msgSecCheck({ content: text, version: 2, scene: 4 });
    return { pass: true };
  } catch (e) {
    return { pass: false, error: (e && e.errMsg) || String(e) };
  }
}

/* ------------------------------ 主入口 ------------------------------ */

function normalizeClosingMessage(text) {
  const s = String(text || '').trim();
  // mp 在 done=true 时会立即隐藏输入框，因此收束文本不得再要求教师回答。
  const stillAsksForAnswer = /[?？]/.test(s)
    || /请(?:您)?(?:确认|修正|补充|说明|解释|选择|回答)/.test(s)
    || /(?:能否|是否).*(?:。|！|!)?$/.test(s);
  return (!s || stillAsksForAnswer) ? DEFAULT_CLOSING_MESSAGE : s;
}

exports.main = async (event) => {
  event = event || {};
  const rounds = (event.history || []).filter((h) => h.role === 'ai' || h.role === 'assistant').length;

  // 剩余 <60s：直接收束（红线）
  if (typeof event.remainingMs === 'number' && event.remainingMs < 60000) {
    const llmMeta = safeLLMResponseMeta(event);
    return {
      ok: true,
      done: true,
      question: DEFAULT_CLOSING_MESSAGE,
      evidenceHint: [],
      llmProfile: llmMeta.llmProfile,
      llmModel: llmMeta.llmModel
    };
  }

  // 最多让教师回答 6 个 AI 问题。第 6 次回答提交后直接显示陈述性收束语，
  // 不再像旧流程那样先生成第 7 个问题、再立即 done，造成问题可见却无法作答。
  if (rounds >= MAX_ANSWERABLE_AI_QUESTIONS) {
    const llmMeta = safeLLMResponseMeta(event);
    return {
      ok: true,
      done: true,
      question: DEFAULT_CLOSING_MESSAGE,
      evidenceHint: [],
      llmProfile: llmMeta.llmProfile,
      llmModel: llmMeta.llmModel,
      questionStrategy: {
        mode: 'closing',
        type: '收束',
        operator: 'CLOSE',
        anchor: '最大可回答轮数',
        relation_sought: '无，结束当前情境',
        advances_from: '教师已完成最多六个可回答问题'
      }
    };
  }

  try {
    // v2.1:优先使用 mp 传来的完整 task_card(gsyg_selectFinal 预生成,存于 session.selection.final[i].task_card);
    // mp 只传 taskCardSeed 时降级到现场组装;两者都缺则退到 v1 kbSlice 路径。
    const stage = STAGES.indexOf(event.stage) >= 0 ? event.stage : 'S1_CONTEXT';
    let taskCard = null;
    let taskCardSource = 'none';
    if (event.taskCard && event.taskCard.item_id) {
      // session 里已有完整任务卡:浅拷贝一份并覆盖 current_stage 相关字段(每轮阶段不同)
      taskCard = Object.assign({}, event.taskCard, {
        current_stage: stage,
        current_stage_focus: STAGE_LABEL[stage] || (event.taskCard.current_stage_focus || '')
      });
      taskCardSource = 'session';
    } else if (event.taskCardSeed) {
      taskCard = buildTaskCard(event.itemId, event.taskCardSeed, stage);
      taskCardSource = 'seed';
    }
    if (taskCard) console.log('[task_card] source=' + taskCardSource, JSON.stringify({ itemId: taskCard.item_id, stage, hypotheses: (taskCard.interview_hypotheses || []).length, evidence: (taskCard.must_obtain_evidence || []).length, probes: (taskCard.recommended_probes || []).length }));

    const system = buildSystemPrompt(event, taskCard);
    const user = buildUserPrompt(event, taskCard);
    const selectedLLM = resolveLLMProfile(event);
    llmMeta = llmResponseMeta(selectedLLM);
    const raw = await withTimeout(callLLM(selectedLLM, system, user), LLM_TIMEOUT_MS);
    if (!raw) throw new Error('LLM 空响应');

    const obj = parseModelJSON(raw);
    const norm = normalizeResult(obj, raw);
    if (!norm.question) throw new Error('LLM 未返回可用 next_question');

    // 模型可依据证据充分性提前收束；最大轮数由调用模型前的硬判断负责。
    const done = norm.done;
    const question = done ? normalizeClosingMessage(norm.question) : norm.question;
    // 阶段推进保留(决策程序版由模型自身管理问题类型,stage 仅供 mp 端记录,不再注入 prompt)
    const nextStage = decideNextStage(stage, norm.evidenceHint, rounds + 1);
    if (norm.questionStrategy) console.log('[strategy]', JSON.stringify(norm.questionStrategy));

    // 内容安全
    const sec = await secCheck(question);
    if (!sec.pass) return {
      ok: false,
      error: 'msgSecCheck_failed: ' + (sec.error || ''),
      llmProfile: llmMeta.llmProfile,
      llmModel: llmMeta.llmModel
    };

    return {
      ok: true,
      question: question,
      done: done,
      evidenceHint: norm.evidenceHint,
      llmProfile: llmMeta.llmProfile,
      llmModel: llmMeta.llmModel,
      questionStrategy: norm.questionStrategy || null, // 研究审计用,mp 端不展示
      stage: stage,           // 本轮实际使用的 stage(保留兼容)
      nextStage: nextStage    // 下一轮建议的 stage(保留兼容)
    };
  } catch (e) {
    return {
      ok: false,
      error: (e && e.message) || 'llm_error',
      llmProfile: llmMeta.llmProfile,
      llmModel: llmMeta.llmModel
    };
  }
};
