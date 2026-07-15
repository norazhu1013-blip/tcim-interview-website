/**
 * Node.js 端口 —— 严格 1:1 移植 DOC/calculate_advisor_rpg_final_新题序新赋分.py 的算法逻辑。
 * 用途:①云函数 gsyg_selectFinal 的算法核心 ②对拍脚本 verify_align.js 的被测方。
 *
 * ★ 2026-07-15 恒等题号迁移(已落地,去掉 MP_TO_PY)
 *   内部题号 = 小程序题号(py Qn == mp Qn):SCORE_CSV 列 01..10、ABILITY_MAP、
 *   QUESTION_CONTENT、SCENARIO_FOLLOWUP_QUESTIONS 全部按小程序题序,由
 *   tools/_gen(python 载入新参考程序)提取生成。gsyg_selectFinal 直接喂 mp session、
 *   直接读 output item_id/questionIndex,**不再有任何翻译层**。
 *
 *   迁移方式:重排是**保值**的(赋分 new[mpQ]===old[MP_TO_PY[mpQ]] 全 240 处一致;
 *   能力类型 10/10 一致)。配套重生成:①45 教师模拟数据重贴标签为 mp 题序
 *   (tools/migrate_sim_to_mp_order.py → 模拟数据_45位教师_mp题序/);②advisor_norms.js
 *   Q 键改 mp 题号(version 2026-07-15-45sim-mporder);③tools/advisor_ref_output 由新
 *   参考程序在重贴标签数据上重生成。三份对拍(verify_align/norms_mode/cf_pipeline)
 *   对新参考 45/45·0 diff。
 *
 *   与迁移前(旧 py 题号 + MP_TO_PY)相比,45 位模拟教师中 43 位最终 3 题完全一致,
 *   2 位(sim_009、sim_043)因 R/P/G 排序里「同值并列按题号断」的 tie-break 在重排后
 *   断法不同而选出不同情境——这是采用研究团队新程序 tie-break 的预期结果,非缺陷;
 *   详见 tools/verify_migration_equivalence.js。
 *
 * 无外部依赖(不 require wx-server-sdk / xlsx / csv 库),Node ≥ 12 即可运行。
 */

'use strict';

/* =========================================================================
 * 一、常量与静态数据(逐字取自 Python)
 * ========================================================================= */

const IDLE_THRESHOLD_SECONDS = 120.0;
const HIGH_MEAN_THRESHOLD = 3.0;
const LOW_MEAN_THRESHOLD = 2.0;

const REQUIRED_RESULTS_COLUMNS = new Set(['participantName', 'userOpenid', 'answers']);
const REQUIRED_LOG_COLUMNS = new Set(['userOpenid', 'questionIndex', 'timestamp', 'action']);

const SCORE_CSV = `选项组合,01赋分,02赋分,03赋分,04赋分,05赋分,06赋分,07赋分,08赋分,09赋分,10赋分
ABCD,4,2,2,0,2,0,0,1,0,2
ABDC,3,2,4,2,2,0,1,2,3,2
ACBD,4,3,1,1,2,0,1,2,0,1
ACDB,2,4,1,1,1,0,1,2,1,1
ADBC,1,2,4,1,1,0,1,2,2,2
ADCB,1,3,3,2,0,1,3,3,1,1
BACD,2,2,2,1,3,0,0,1,2,2
BADC,1,1,2,4,3,0,2,1,2,3
BCAD,3,1,4,2,2,1,1,0,1,2
BCDA,1,1,4,3,1,3,1,1,0,2
BDAC,1,1,4,4,4,2,2,2,2,4
BDCA,0,0,2,4,3,3,0,1,1,3
CABD,4,2,3,1,1,1,2,1,0,1
CADB,2,3,1,1,0,1,4,2,1,0
CBAD,3,2,3,2,0,2,2,1,1,1
CBDA,1,1,1,1,1,4,2,1,0,2
CDAB,2,2,0,2,1,2,4,2,2,1
CDBA,1,2,0,4,1,3,1,2,2,1
DABC,1,2,3,1,2,3,2,3,1,2
DACB,0,2,3,1,2,2,3,4,2,2
DBAC,0,1,3,3,3,3,2,2,1,3
DBCA,0,1,3,3,1,4,1,2,2,2
DCAB,0,2,0,2,0,3,1,3,2,1
DCBA,0,1,2,3,2,4,1,2,4,2`;

const ABILITY_MAP = {
  "1": {
    "item_id": "Q1",
    "item_title": "篮球架玩水",
    "primary": "B 自主游戏与规则/安全/价值平衡",
    "secondary": "A 游戏意义理解"
  },
  "2": {
    "item_id": "Q2",
    "item_title": "频繁求助",
    "primary": "C 观察诊断与介入时机",
    "secondary": "D 支架策略"
  },
  "3": {
    "item_id": "Q3",
    "item_title": "区域停留短",
    "primary": "C 观察诊断与介入时机",
    "secondary": "A 儿童视角"
  },
  "4": {
    "item_id": "Q4",
    "item_title": "未参与小组建构",
    "primary": "D 支架策略与游戏推进",
    "secondary": "E 共同游戏组织"
  },
  "5": {
    "item_id": "Q5",
    "item_title": "消防员救火开心",
    "primary": "A 游戏意义理解与儿童视角",
    "secondary": "B 价值平衡"
  },
  "6": {
    "item_id": "Q6",
    "item_title": "材料选择无层次",
    "primary": "D 支架策略与游戏推进",
    "secondary": "C 观察诊断"
  },
  "7": {
    "item_id": "Q7",
    "item_title": "艾莎公主不运动",
    "primary": "D 支架策略与游戏推进",
    "secondary": "A 儿童视角/B 目标平衡"
  },
  "8": {
    "item_id": "Q8",
    "item_title": "引水难题未解",
    "primary": "C 观察诊断与介入时机",
    "secondary": "D 探究支架"
  },
  "9": {
    "item_id": "Q9",
    "item_title": "飞行棋各走各的",
    "primary": "E 共同游戏组织与规则共建",
    "secondary": "B 规则平衡"
  },
  "10": {
    "item_id": "Q10",
    "item_title": "跳绳秩序混乱",
    "primary": "E 共同游戏组织与规则共建",
    "secondary": "B 安全秩序"
  }
};

const QUESTION_CONTENT = {
  "1": {
    "scenario": "操场上新安装了一些篮球架，幼儿经常在这里投篮。某天户外活动时，几名幼儿带着画笔和水桶来到这里，他们先是快乐地粉刷篮球架，之后开始往篮框里灌水，有的从上面灌，有的在下面接，忙的不亦乐乎，俨然这里成为了玩水的场地。",
    "options": {
      "A": "看到幼儿玩得很开心，不干预他们的玩水行为，待兴趣减弱后再讨论玩水的适宜性。",
      "B": "表扬幼儿的新发现，并询问在篮球架旁玩水是否合适，提议幼儿可以换个地方玩水。",
      "C": "参与到幼儿的“粉刷”游戏中，逐步引导幼儿到适宜玩水的地方继续开展游戏。",
      "D": "提醒幼儿篮球架是用于开展运动的，与其他幼儿一起召唤他们打篮球，转移他们的关注点。"
    }
  },
  "4": {
    "scenario": "大班建构活动中，睿睿和其他幼儿计划一起搭积木大桥，他们讨论了搭建方法，并进入区域开始搭建。就在其他幼儿在认真搭建时，睿睿发现了一块长条木板，他一会儿在地上推着走，一会儿当枪使，没有再参与小组的搭建。",
    "options": {
      "A": "继续观察，后续分享中支持睿睿思考如何把长条木板融入小组的建构中。",
      "B": "肯定睿睿的创造性玩法，询问他长条板能否当桥面，引导他参与到搭桥任务中。",
      "C": "引导睿睿回顾计划，建议他先完成共同任务，长条木板可以等自由游戏时再玩。",
      "D": "看到睿睿玩得开心，暂不介入，等下一次活动时再提醒他根据计划开展游戏。"
    }
  },
  "6": {
    "scenario": "大班上学期，张老师在建构区投放了按图搭建的游戏材料，并提供了不同星级难度的任务卡供幼儿选择，但有的幼儿一上来就选择高难度的三星级任务卡，结果不能顺利完成任务；而有的幼儿始终选择低难度的一星级任务卡。这天，浩浩又连续选择了几张一星级任务卡，很快就完成了任务。",
    "options": {
      "A": "调整任务卡提供方式，在游戏开始前根据幼儿的能力水平有针对性地发放任务卡。",
      "B": "暂不介入，尊重幼儿的自主选择和游戏体验，只要完成任务就是一种经验积累。",
      "C": "调整任务卡呈现方式，如增加“我想挑战”等提示，鼓励幼儿选择不同星级的挑战。",
      "D": "和浩浩回顾已完成的任务，比较不同星级的难度，邀请他选择稍有挑战的任务。"
    }
  },
  "2": {
    "scenario": "中班区域活动时，小明选择了建构区。玩了一会儿，他跑到老师面前说“老师，我不会搭……帮帮我吧”，教师问他需要什么帮助时，他一边说我不会搭，一边却很快地将房子从一层积木加高到了两层。看小明专注搭建后，老师就离开建构区了。可是没一会，小明又找了老师好几次，说“老师，帮帮我吧，我不会搭”。",
    "options": {
      "A": "鼓励小明独立搭建，引导他思考接下来如何搭建，及时表扬他的努力。",
      "B": "先示范搭建关键部分，请小明观察方法，再鼓励他照着继续搭建。",
      "C": "在旁观察小明的搭建过程，并适时反馈，帮助他理清搭建步骤。",
      "D": "帮小明回顾已搭建完成的部分，指导他设定小目标，尝试自己实现。"
    }
  },
  "5": {
    "scenario": "近几天，中班的幼儿十分热衷于在区域游戏时间玩“消防员救火”的游戏。游戏结束后的交流活动中，老师问幼儿最想分享什么时，阳阳说“娃娃家着火了，好开心啊！”。",
    "options": {
      "A": "抓住教育契机，向幼儿耐心解释真实的火灾会造成物品损失和人员伤亡。",
      "B": "询问幼儿开心的是“着火”本身，还是消防员成功救火、娃娃家的人得救？",
      "C": "引导幼儿思考“娃娃家着火”值不值得开心，帮助他们认识真实火灾是危险的。",
      "D": "请阳阳讲讲娃娃家着火后发生了什么、为什么开心，借此理解幼儿的游戏体验。"
    }
  },
  "3": {
    "scenario": "小班幼儿瑶瑶在区域活动时，一会儿在娃娃家切切菜，一会儿到美工区搓搓橡皮泥，一会儿又开心地跑到其它区域游戏，在任何一个区域停留时间都不超过三分钟。",
    "options": {
      "A": "提议瑶瑶完成某项游戏任务，如在娃娃家做菜，请他活动小结时分享。",
      "B": "游戏前提醒区域活动规则，活动结束后表扬区域游戏规则遵守得好的小朋友。",
      "C": "仔细观察瑶瑶在不同区域的游戏情况，分析他发生迅速转移的原因。",
      "D": "以同伴的身份陪伴瑶瑶在某一区域游戏，待他专注游戏后再离开。"
    }
  },
  "9": {
    "scenario": "大班区域游戏中，轩轩和小宇一起玩飞行棋，他们将棋子摆好后，各自拿了一个骰子开始投，小宇说：“该我走。”轩轩说：“明明该我走！”相持不下，于是两人各拿一个骰子，自顾自地走自己的棋。",
    "options": {
      "A": "耐心讲解共同游戏的规则，再以“棋手”身份加入游戏进行示范引导。",
      "B": "暂不介入，继续观察游戏进展，待区域小结时请幼儿分享游戏中的体验和问题。",
      "C": "拿走一个骰子，请幼儿商量只有一个骰子的共同游戏规则，达成一致后再开始游戏。",
      "D": "待幼儿体验一轮各走各的游戏后，询问幼儿的游戏体验，提示共同游戏规则的作用。"
    }
  },
  "10": {
    "scenario": "周三下午，大五班的幼儿正自发进行跳绳游戏。李老师观察后发现，挤在一起跳绳的幼儿人数较多，整个场面十分混乱，幼儿很容易出现碰撞现象。此外，由于当“柱子”的幼儿很久才能轮上跳绳，因此也显得很不耐烦。",
    "options": {
      "A": "请幼儿暂停游戏，将幼儿分成多个小组并引导他们以小组为单位分区域开展游戏。",
      "B": "请幼儿说一说跳绳活动中存在的问题，并邀请幼儿一起设置跳绳的规则。",
      "C": "提供更多数量和不同种类的跳绳，并言语引导幼儿分组分区同时进行跳绳游戏。",
      "D": "暂不介入，活动分享时通过照片或视频回放引导幼儿发现问题并商议解决办法。"
    }
  },
  "7": {
    "scenario": "小班的一次户外运动，有几个女孩子从一开始就没有选择任何体育活动项目，而是聚在一起坐在地上玩“艾莎公主”的游戏，比一比谁的鞋子最漂亮，谁的魔法最厉害。",
    "options": {
      "A": "询问幼儿没有参与运动的原因，提供丰富的活动材料吸引幼儿参与运动活动。",
      "B": "提醒幼儿现在是运动时间，请他们等自由游戏时间再一起玩“艾莎公主”的游戏。",
      "C": "利用艾莎公主的鞋子设计走、跑、跳等活动，并以参与者的身份邀请幼儿一起参与运动。",
      "D": "肯定幼儿自主游戏的行为，言语引导幼儿穿着“漂亮的鞋子”参与运动。"
    }
  },
  "8": {
    "scenario": "中班上学期，幼儿在“引水游戏”中遇到了难题——水无法被引到竹片管道上。他们不断调整竹片拼接的方式，却始终没能成功，即竹片一头高于出水管道，阻碍了引流。渐渐地幼儿的探索兴趣也减弱了，有的开始玩水，有的甚至离开了水池。",
    "options": {
      "A": "示范正确的引水方法，请幼儿注意观察并说说引水的要领，再自己试一试。",
      "B": "加入幼儿的探索，引导他们观察水流受阻的位置，一起尝试调整竹片的摆放方式。",
      "C": "组织幼儿就游戏困难进行讨论，寻找解决问题的方案，引导幼儿再次尝试。",
      "D": "投放更多辅助引水的材料，重新激起幼儿的探索兴趣，继续观察游戏进展。"
    }
  }
};

const SCENARIO_FOLLOWUP_QUESTIONS = {
  "1": [
    "这个情境里，孩子把篮球架变成玩水场地，你当时更关注他们的游戏兴趣、器械用途，还是安全与场地适宜性？",
    "如果既想保护孩子的探索兴趣，又要回应篮球架原本的运动功能，你觉得教师可以怎样衔接？"
  ],
  "4": [
    "睿睿离开了原来的搭桥计划去玩长条木板，你当时怎样理解他的行为：是偏离共同任务，还是出现了新的游戏线索？",
    "面对共同建构计划和幼儿临时兴趣之间的变化，你觉得教师什么时候应该介入，什么时候可以继续观察？"
  ],
  "6": [
    "浩浩反复选择一星任务卡时，你当时更想尊重他的自主选择，还是推动他尝试更有挑战的任务？",
    "你觉得教师应该怎样判断幼儿是需要安全感、缺少挑战意识，还是任务卡呈现方式本身需要调整？"
  ],
  "2": [
    "小明一边说不会搭，一边又能继续加高房子，你当时怎样判断他真正需要的帮助是什么？",
    "面对幼儿反复求助，你觉得教师怎样支持，既不替代幼儿完成，又能帮助他继续推进游戏？"
  ],
  "5": [
    "阳阳说娃娃家着火了很开心时，你当时更关注真实火灾的危险教育，还是先理解他在游戏里的开心来自哪里？",
    "你觉得教师怎样回应，既不否定幼儿的游戏体验，又能引导他们理解真实火灾的意义？"
  ],
  "3": [
    "瑶瑶在多个区域快速转换时，你当时会先把它看作注意力不集中、规则问题，还是一种探索不同材料的方式？",
    "如果你在现场，你会先观察哪些信息来判断是否需要介入？"
  ],
  "9": [
    "两个孩子各走各的棋时，你当时更关注共同游戏规则的建立，还是先让他们体验这种玩法会带来什么问题？",
    "你觉得教师怎样帮助幼儿从各玩各的，过渡到真正的共同游戏？"
  ],
  "10": [
    "跳绳现场混乱且可能碰撞时，你当时更倾向于立即组织秩序，还是先让幼儿自己发现问题？",
    "在安全风险和幼儿自主制定规则之间，你觉得教师应该怎样把握介入时机？"
  ],
  "7": [
    "几个女孩在户外运动时间玩艾莎公主时，你当时更关注运动目标，还是关注她们正在生成的角色游戏兴趣？",
    "如果要把艾莎公主游戏和运动活动连接起来，你觉得教师可以怎样做才不显得生硬？"
  ],
  "8": [
    "孩子们引水失败、兴趣减弱时，你当时更倾向于直接示范方法，还是继续支持他们自己发现水流受阻的原因？",
    "你觉得教师怎样提供支架，既能帮助问题解决，又保留幼儿继续探究的空间？"
  ]
};

const OUTPUT_WARNING = '访谈提醒:本程序用于筛选值得访谈的情境题,不用于向教师反馈测评成绩。后续AI访谈或人工访谈时,不得向教师透露得分、排名、R/P/G分、IIV或任何评价性结果。';
const SAFE_OUTPUT_WARNING = '访谈提醒:本表仅供生成中性访谈提问。访谈时不得向教师透露任何内部计算指标、得分、排名、题目入选原因或评价性判断。';

/* =========================================================================
 * 二、通用工具
 * ========================================================================= */

function parseIntSafe(v, def = null) {
  if (v == null || v === '') return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function parseFloatSafe(v, def = null) {
  if (v == null || v === '') return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function cleanSortValue(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/^["']|["']$/g, '');
  if (!s || s.toLowerCase() === 'nan') return null;
  const letters = (s.toUpperCase().match(/[ABCD]/g) || []).join('');
  return letters.length === 4 ? letters : null;
}

function timestampSeconds(v) {
  const t = parseFloatSafe(v);
  if (t == null) return null;
  return t > 1e10 ? t / 1000.0 : t;
}

/** 元组字典序比较(用于稳定的 Python-style 排序键)。 */
function cmpTuple(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let av = a[i];
    let bv = b[i];
    if (typeof av === 'boolean') av = av ? 1 : 0;
    if (typeof bv === 'boolean') bv = bv ? 1 : 0;
    if (av == null && bv == null) continue;
    if (av == null) return -1;
    if (bv == null) return 1;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}
function sortBy(arr, keyFn, reverse = false) {
  const sign = reverse ? -1 : 1;
  return arr.slice().sort((a, b) => sign * cmpTuple(keyFn(a), keyFn(b)));
}
function maxBy(arr, keyFn) {
  return arr.reduce((best, x) => (best == null || cmpTuple(keyFn(x), keyFn(best)) > 0 ? x : best), null);
}
function minBy(arr, keyFn) {
  return arr.reduce((best, x) => (best == null || cmpTuple(keyFn(x), keyFn(best)) < 0 ? x : best), null);
}

function percentileRank(value, values) {
  const clean = values.filter((v) => v != null && !Number.isNaN(v));
  if (value == null || !clean.length) return 50.0;
  if (clean.length === 1) return 50.0;
  let less = 0, equal = 0;
  for (const v of clean) {
    if (v < value) less++;
    else if (v === value) equal++;
  }
  return 100.0 * (less + 0.5 * equal) / clean.length;
}

function minmaxNorm(value, values) {
  const clean = values.filter((v) => v != null && !Number.isNaN(v));
  if (value == null || !clean.length) return 50.0;
  const lo = Math.min(...clean), hi = Math.max(...clean);
  if (hi === lo) return 50.0;
  return 100.0 * (value - lo) / (hi - lo);
}

function sampleStd(values) {
  const clean = values.filter((v) => v != null && !Number.isNaN(v));
  if (clean.length < 2) return 0.0;
  const m = clean.reduce((a, b) => a + b, 0) / clean.length;
  const varr = clean.reduce((a, b) => a + (b - m) ** 2, 0) / (clean.length - 1);
  return Math.sqrt(varr);
}

function safeLogSeconds(v) {
  const n = parseFloatSafe(v);
  if (n == null || Number.isNaN(n)) return null;
  return Math.log(Math.max(0.001, n));
}

function clip01(v) {
  if (v == null) return 0.0;
  return Math.max(0.0, Math.min(1.0, Number(v)));
}

function classifyTeacher(mean) {
  if (mean >= HIGH_MEAN_THRESHOLD) return '总体偏高';
  if (mean < LOW_MEAN_THRESHOLD) return '总体偏低';
  return '总体中等';
}

function deviationStrength(absRd) {
  if (absRd >= 1.5) return '强偏离';
  if (absRd >= 1.0) return '中等偏离';
  if (absRd >= 0.5) return '弱偏离';
  return '偏离不明显';
}

/** 与 Python round(x, 6) 尽量一致(数值 CSV 输出前使用)。 */
function round6(v) {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Math.round(v * 1e6) / 1e6;
  }
  return v;
}

function stripTrailingPunctuation(text) {
  return (text || '').replace(/[。!?;;,.,、\s]+$/g, '');
}

function optionText(q, opt, stripEnd = false) {
  const o = (opt || '').trim().toUpperCase();
  if (!'ABCD'.includes(o)) return '';
  const opts = (QUESTION_CONTENT[Number(q)] || {}).options || {};
  let t = opts[o] || '';
  if (stripEnd) t = stripTrailingPunctuation(t);
  return t ? `教师${o}:${t}` : `教师${o}`;
}

function pairText(q, pair, stripEnd = false) {
  if (!pair) return '';
  const opts = (String(pair).toUpperCase().match(/[ABCD]/g) || []);
  return opts.map((o) => optionText(q, o, stripEnd)).join(';');
}

function itemMeta(q) {
  const meta = ABILITY_MAP[Number(q)] || {};
  const content = QUESTION_CONTENT[Number(q)] || {};
  const options = content.options || {};
  return {
    item_id: meta.item_id || `Q${Number(q)}`,
    item_title: meta.item_title || `第${Number(q)}题`,
    primary: meta.primary || '',
    secondary: meta.secondary || '',
    scenarioText: content.scenario || '',
    optionA: options.A || '',
    optionB: options.B || '',
    optionC: options.C || '',
    optionD: options.D || ''
  };
}

function metaOutputFields(meta) {
  return {
    scenarioText: meta.scenarioText || '',
    optionA: meta.optionA || '',
    optionB: meta.optionB || '',
    optionC: meta.optionC || '',
    optionD: meta.optionD || ''
  };
}

/* =========================================================================
 * 三、赋分表 + 结果解析
 * ========================================================================= */

function buildScoreDict() {
  const dict = {};
  const lines = SCORE_CSV.trim().split('\n');
  const headers = lines[0].split(',');
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const comb = cells[0].trim();
    for (let q = 1; q <= 10; q++) {
      const col = headers.indexOf(`${String(q).padStart(2, '0')}赋分`);
      dict[`${q}|${comb}`] = parseInt(cells[col], 10);
    }
  }
  return dict;
}

function scoreOf(dict, q, comb) {
  if (!comb) return null;
  const v = dict[`${q}|${comb}`];
  return v == null ? null : v;
}

/**
 * @param {Array<{participantName, userOpenid, answers}>} rows  answers 已是对象或 JSON 字符串
 */
function parseResults(rows, scoreDict) {
  const idxToChar = { 0: 'A', 1: 'B', 2: 'C', 3: 'D' };
  const parsed = [];
  rows.forEach((row, rowIdx) => {
    const participant = row.participantName || '';
    const user = row.userOpenid || '';
    let answers;
    try {
      answers = typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers;
    } catch (e) {
      throw new Error(`结果数据第 ${rowIdx + 2} 行 answers 不是合法 JSON。`);
    }
    for (const key of Object.keys(answers)) {
      const q = parseInt(key, 10) + 1;
      const idxs = answers[key];
      let comb;
      try {
        comb = idxs.map((x) => idxToChar[parseInt(x, 10)]).join('');
      } catch (e) {
        throw new Error(`结果数据第 ${rowIdx + 2} 行第 ${q} 题答案格式异常:${idxs}`);
      }
      parsed.push({
        participantName: participant,
        userOpenid: user,
        questionIndex: q,
        chosen_comb: comb,
        S_final: scoreOf(scoreDict, q, comb) || 0
      });
    }
  });
  return parsed;
}

/* =========================================================================
 * 四、日志分组
 * ========================================================================= */

function inferLogQuestionBase(logRows) {
  const raw = [];
  for (const r of logRows) {
    const q = parseIntSafe(r.questionIndex);
    if (q != null && q !== -1) raw.push(q);
  }
  const set = new Set(raw);
  if (!set.size) return [1, '未在日志中发现有效questionIndex,默认按1-10处理'];
  if (set.has(0)) return [0, '日志questionIndex包含0,已按0-9处理并转换为1-10'];
  if (set.has(10)) return [1, '日志questionIndex包含10,已按1-10处理'];
  return [1, '日志questionIndex只出现1-9,无法完全判断基准;默认按1-10处理,如发现错位请用 --log-question-base 0'];
}

function groupLogEvents(logRows, logQuestionBase = 'auto') {
  let base, note;
  if (String(logQuestionBase) === 'auto') {
    [base, note] = inferLogQuestionBase(logRows);
  } else {
    base = parseInt(logQuestionBase, 10);
    if (base !== 0 && base !== 1) throw new Error('--log-question-base 只能是 auto、0 或 1。');
    note = `用户手动指定日志questionIndex按${base === 0 ? '0-9' : '1-10'}处理`;
  }
  const grouped = new Map();
  for (const row of logRows) {
    const user = row.userOpenid || '';
    const rawQ = parseIntSafe(row.questionIndex);
    const t = parseFloatSafe(row.timestamp);
    if (rawQ == null || rawQ === -1 || t == null) continue;
    const q = base === 0 ? rawQ + 1 : rawQ;
    if (q < 1 || q > 10) continue;
    const ev = Object.assign({}, row);
    ev._timestamp = t;
    ev._raw_questionIndex = rawQ;
    ev._questionIndex = q;
    const key = user + '|' + q;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(ev);
  }
  for (const list of grouped.values()) list.sort((a, b) => a._timestamp - b._timestamp);
  return { grouped, base, note };
}

/* =========================================================================
 * 五、轨迹 / 过程特征
 * ========================================================================= */

function buildTrajectory(events, finalComb) {
  const trajectory = [];
  const movedOptions = [];
  const transitions = [];
  const drags = events.filter((e) => e.action === 'change_sorting_option');
  for (const ev of drags) {
    const prev = cleanSortValue(ev.previousValue);
    const cur = cleanSortValue(ev.currentValue);
    let moved = cleanSortValue(ev.answer);
    if (moved && moved.length === 1) {
      movedOptions.push(moved);
    } else if (ev.answer) {
      const at = String(ev.answer).trim().toUpperCase();
      if ('ABCD'.includes(at) && at.length === 1) movedOptions.push(at);
    }
    if (prev && !trajectory.length) trajectory.push(prev);
    if (cur) {
      if (!trajectory.length || trajectory[trajectory.length - 1] !== cur) {
        if (trajectory.length) transitions.push([trajectory[trajectory.length - 1], cur]);
        trajectory.push(cur);
      }
    }
  }
  if (finalComb && (!trajectory.length || trajectory[trajectory.length - 1] !== finalComb)) {
    if (trajectory.length) transitions.push([trajectory[trajectory.length - 1], finalComb]);
    trajectory.push(finalComb);
  }
  if (!trajectory.length && finalComb) trajectory.push(finalComb);
  return { trajectory, movedOptions, transitions };
}

function countTopBottomChanges(trajectory) {
  let top = 0, bot = 0;
  for (let i = 1; i < trajectory.length; i++) {
    const p = trajectory[i - 1], c = trajectory[i];
    if (p && c && p[0] !== c[0]) top++;
    if (p && c && p[p.length - 1] !== c[c.length - 1]) bot++;
  }
  return [top, bot];
}

function topBottomSwapCount(transitions) {
  let count = 0;
  for (const [p, c] of transitions) {
    if (!p || !c) continue;
    if (p[0] === c[c.length - 1] || p[p.length - 1] === c[0]) count++;
  }
  return count;
}

function stateCounts(trajectory) {
  const counts = new Map();
  for (const s of trajectory) counts.set(s, (counts.get(s) || 0) + 1);
  let repeated = 0;
  for (const c of counts.values()) repeated += Math.max(0, c - 1);
  const seen = new Set();
  let backtracking = 0;
  for (const s of trajectory) {
    if (seen.has(s)) backtracking++;
    seen.add(s);
  }
  let oscillation = 0;
  for (let i = 2; i < trajectory.length; i++) {
    const a = trajectory[i - 2], b = trajectory[i - 1], c = trajectory[i];
    if (a === c && a !== b) oscillation++;
  }
  return [counts.size, repeated, backtracking, oscillation];
}

function calcIdleCorrection(events) {
  const times = events.map((e) => timestampSeconds(e.timestamp)).filter((t) => t != null);
  if (times.length < 2) return { gaps: [], maxGap: 0.0, removed: 0.0, flag: 0 };
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(Math.max(0.0, times[i] - times[i - 1]));
  const maxGap = gaps.length ? Math.max(...gaps) : 0.0;
  const removed = gaps.reduce((s, g) => s + Math.max(0.0, g - IDLE_THRESHOLD_SECONDS), 0);
  const flag = maxGap >= IDLE_THRESHOLD_SECONDS ? 1 : 0;
  return { gaps, maxGap, removed, flag };
}

function correctionBetween(events, startTime, endTime) {
  if (startTime == null || endTime == null || endTime <= startTime) return 0.0;
  const times = events
    .map((e) => timestampSeconds(e.timestamp))
    .filter((t) => t != null && t >= startTime && t <= endTime);
  if (times.length < 2) return 0.0;
  let sum = 0;
  for (let i = 1; i < times.length; i++) {
    sum += Math.max(0.0, Math.max(0.0, times[i] - times[i - 1]) - IDLE_THRESHOLD_SECONDS);
  }
  return sum;
}

function optionFocusFromTrajectory(q, trajectory, movedOptions, transitions) {
  let priorityOption = '';
  let bestScore = 0;
  if (trajectory.length) {
    const initial = trajectory[0];
    const finalC = trajectory[trajectory.length - 1];
    const moveCounts = {};
    for (const m of movedOptions) moveCounts[m] = (moveCounts[m] || 0) + 1;
    for (const opt of 'ABCD') {
      if (!initial.includes(opt) || !finalC.includes(opt)) continue;
      const shift = Math.abs((initial.indexOf(opt) + 1) - (finalC.indexOf(opt) + 1));
      const score = (moveCounts[opt] || 0) * 10 + shift;
      if (score > bestScore) {
        priorityOption = opt;
        bestScore = score;
      }
    }
  }
  const pairCounter = {};
  for (const [prev, cur] of transitions) {
    if (!prev || !cur) continue;
    const changed = [];
    for (const opt of 'ABCD') {
      if (prev.includes(opt) && cur.includes(opt) && prev.indexOf(opt) !== cur.indexOf(opt)) changed.push(opt);
    }
    for (let i = 0; i < changed.length; i++) {
      for (let j = i + 1; j < changed.length; j++) {
        const key = [changed[i], changed[j]].sort().join('/');
        pairCounter[key] = (pairCounter[key] || 0) + 1;
      }
    }
  }
  let priorityPair = '';
  let maxCount = 0;
  for (const [k, v] of Object.entries(pairCounter)) {
    if (v > maxCount) { priorityPair = k; maxCount = v; }
  }
  return { priorityOption, priorityPair };
}

function extractProcessFeatures(results, logEvents) {
  const rows = [];
  for (const result of results) {
    const user = result.userOpenid;
    const q = result.questionIndex;
    const events = logEvents.get(user + '|' + q) || [];
    const enter = events.filter((e) => e.action === 'enter_question').map((e) => timestampSeconds(e.timestamp));
    const leave = events.filter((e) => e.action === 'leave_question').map((e) => timestampSeconds(e.timestamp));
    const drags = events.filter((e) => e.action === 'change_sorting_option');
    const dragTimes = drags.map((e) => timestampSeconds(e.timestamp));

    const tEnter = enter.length ? enter[0] : (events.length ? timestampSeconds(events[0].timestamp) : null);
    const tLeave = leave.length ? leave[leave.length - 1] : (events.length ? timestampSeconds(events[events.length - 1].timestamp) : null);
    const tFirstDrag = dragTimes.length ? dragTimes[0] : null;

    const rawTotal = tEnter != null && tLeave != null ? tLeave - tEnter : null;
    const rawFirst = tEnter != null && tFirstDrag != null ? tFirstDrag - tEnter : null;
    const rawPost = tLeave != null && tFirstDrag != null ? tLeave - tFirstDrag : null;

    const { maxGap, removed: removedTotal, flag: interruptionFlag } = calcIdleCorrection(events);
    const removedFirst = correctionBetween(events, tEnter, tFirstDrag);
    const removedPost = correctionBetween(events, tFirstDrag, tLeave);

    const effTotal = rawTotal != null ? Math.max(0.0, rawTotal - removedTotal) : null;
    const effFirst = rawFirst != null ? Math.max(0.0, rawFirst - removedFirst) : null;
    const effPost = rawPost != null ? Math.max(0.0, rawPost - removedPost) : null;

    const { trajectory, movedOptions, transitions } = buildTrajectory(events, result.chosen_comb || '');
    const [topChange, bottomChange] = countTopBottomChanges(trajectory);
    const topBottomSwaps = topBottomSwapCount(transitions);
    const [uniqueStates, repeatedStates, backtracking, oscillation] = stateCounts(trajectory);
    const { priorityOption, priorityPair } = optionFocusFromTrajectory(q, trajectory, movedOptions, transitions);

    const actionCount = drags.length;
    const revisionCount = Math.max(0, trajectory.length - 1);
    const meta = itemMeta(q);
    rows.push(Object.assign({
      participantName: result.participantName || '',
      userOpenid: user,
      questionIndex: q,
      item_id: meta.item_id,
      item_title: meta.item_title
    }, metaOutputFields(meta), {
      raw_item_time_sec: rawTotal,
      effective_item_time_sec: effTotal,
      effective_first_response_time_sec: effFirst,
      effective_post_first_time_sec: effPost,
      revision_count: revisionCount,
      action_count: actionCount,
      first_position_change_count: topChange,
      last_position_change_count: bottomChange,
      top_bottom_swap_count: topBottomSwaps,
      unique_state_count: uniqueStates,
      repeated_state_count: repeatedStates,
      backtracking_count: backtracking,
      oscillation_count: oscillation,
      priorityOption,
      priorityPair,
      priorityOptionText: optionText(q, priorityOption),
      priorityPairText: pairText(q, priorityPair),
      max_idle_gap_sec: maxGap,
      time_removed_sec: removedTotal,
      interruption_flag: interruptionFlag
    }));
  }
  return rows;
}

/* =========================================================================
 * 六、P-IVI 分数 + 过程标签
 * ========================================================================= */

/**
 * @param {Array} processRows 过程明细行
 * @param {object} [norms] 可选常模表 { Q: { [q]: { metric: [...] } } }。传入则用常模算百分位,
 *   否则用 processRows 同批次内(经典 Python advisor 研究场景)算。端上单教师场景必传 norms。
 */
function addPScores(processRows, norms) {
  const byQ = new Map();
  for (const r of processRows) {
    if (!byQ.has(r.questionIndex)) byQ.set(r.questionIndex, []);
    byQ.get(r.questionIndex).push(r);
  }
  const useNorms = norms && norms.Q;
  for (const [q, rows] of byQ) {
    const qNorm = useNorms ? norms.Q[q] : null;
    const vals = qNorm ? {
      first: qNorm.effective_first_response_time_sec,
      post: qNorm.effective_post_first_time_sec,
      revision: qNorm.revision_count,
      action: qNorm.action_count,
      unique: qNorm.unique_state_count,
      repeat: qNorm.repeated_state_count,
      back: qNorm.backtracking_count,
      osc: qNorm.oscillation_count
    } : {
      first: rows.map((r) => r.effective_first_response_time_sec),
      post: rows.map((r) => r.effective_post_first_time_sec),
      revision: rows.map((r) => r.revision_count),
      action: rows.map((r) => r.action_count),
      unique: rows.map((r) => r.unique_state_count),
      repeat: rows.map((r) => r.repeated_state_count),
      back: rows.map((r) => r.backtracking_count),
      osc: rows.map((r) => r.oscillation_count)
    };
    for (const row of rows) {
      const pFirst = percentileRank(row.effective_first_response_time_sec, vals.first);
      const pPost = percentileRank(row.effective_post_first_time_sec, vals.post);
      const pRevision = percentileRank(row.revision_count, vals.revision);
      const pAction = percentileRank(row.action_count, vals.action);
      const pUnique = percentileRank(row.unique_state_count, vals.unique);
      const pRepeat = percentileRank(row.repeated_state_count, vals.repeat);
      const pBack = percentileRank(row.backtracking_count, vals.back);
      const pOsc = percentileRank(row.oscillation_count, vals.osc);

      const fScore = 2.0 * Math.abs(pFirst - 50.0);
      const mScore = 0.40 * pPost + 0.35 * pRevision + 0.25 * pAction;
      const bScore = Math.min(
        100.0,
        30.0 * (row.first_position_change_count >= 1 ? 1 : 0)
        + 20.0 * (row.first_position_change_count >= 2 ? 1 : 0)
        + 30.0 * (row.last_position_change_count >= 1 ? 1 : 0)
        + 20.0 * (row.last_position_change_count >= 2 ? 1 : 0)
        + 30.0 * (row.top_bottom_swap_count >= 1 ? 1 : 0)
      );
      const oScore = 0.20 * pUnique + 0.25 * pRepeat + 0.25 * pBack + 0.30 * pOsc;
      const pIvi = 0.20 * fScore + 0.30 * mScore + 0.35 * bScore + 0.15 * oScore;

      row.F_score = fScore;
      row.M_score = mScore;
      row.B_score = bScore;
      row.O_score = oScore;
      row.P_IVI = pIvi;

      const mainlyTime = (
        row.interruption_flag === 1
        && bScore === 0
        && row.revision_count <= 1
        && row.backtracking_count === 0
        && fScore >= Math.max(mScore, bScore, oScore)
      );
      row.selection_status = mainlyTime ? 'delay_or_exclude' : 'eligible';
    }
  }
  // 按 user 分类过程类型 + 标签
  const byUser = new Map();
  for (const r of processRows) {
    if (!byUser.has(r.userOpenid)) byUser.set(r.userOpenid, []);
    byUser.get(r.userOpenid).push(r);
  }
  for (const rows of byUser.values()) {
    const sortedP = rows.slice().sort((a, b) => b.P_IVI - a.P_IVI);
    const top3 = new Set(sortedP.slice(0, 3).map((r) => r.questionIndex));
    const bottom3 = new Set(sortedP.slice(-3).map((r) => r.questionIndex));
    for (const row of rows) {
      if (top3.has(row.questionIndex) || row.P_IVI >= 70) row.process_type = '过程复杂';
      else if (bottom3.has(row.questionIndex) || row.P_IVI <= 30) row.process_type = '过程简单';
      else row.process_type = '过程中等';
      const { labels, focus } = processLabels(row);
      row.process_labels = labels.join(';');
      row.suggested_interview_focus = focus.join(';');
    }
  }
  return processRows;
}

function processLabels(row) {
  const labels = [];
  const focus = [];
  if (row.F_score >= 60) {
    labels.push('首反应异常');
    focus.push('请教师回忆读到情境后最先注意到什么、是否很快形成判断或感到难判断');
  }
  if (row.M_score >= 60) {
    labels.push('高修正投入');
    focus.push('追问后续主要在比较哪些做法、为什么调整');
  }
  if (row.revision_count >= 3) labels.push('多次调整');
  if (row.B_score >= 50) {
    labels.push('首末位摇摆');
    focus.push('追问最理想或最不理想做法的判断为什么发生变化');
  }
  if (row.top_bottom_swap_count > 0) {
    labels.push('优劣方向冲突');
    focus.push('追问是否曾把某做法从合适改判为不合适,或相反');
  }
  if (row.O_score >= 60) {
    labels.push('路径振荡');
    focus.push('追问当时是否在几个判断标准之间反复权衡');
  }
  if (row.interruption_flag) {
    labels.push('疑似外部中断');
    focus.push('若访谈涉及此题,需先确认中途停顿是否来自外部干扰');
  }
  if (!labels.length) {
    labels.push('过程相对平稳');
    focus.push('追问教师当时主要依据什么形成排序');
  }
  return { labels, focus };
}

function mainProcessTrigger(row) {
  const scores = { 首反应异常: row.F_score, 修正投入: row.M_score, 首末位摇摆: row.B_score, 路径振荡: row.O_score };
  let best = null, bestName = '';
  for (const [n, v] of Object.entries(scores)) {
    if (best == null || v > best) { best = v; bestName = n; }
  }
  return bestName;
}

/* =========================================================================
 * 七、R/P/G 候选
 * ========================================================================= */

function selectPCandidates(processRows) {
  const selected = [];
  const byUser = new Map();
  for (const r of processRows) {
    if (!byUser.has(r.userOpenid)) byUser.set(r.userOpenid, []);
    byUser.get(r.userOpenid).push(r);
  }
  for (const rows of byUser.values()) {
    const sorted = rows.slice().sort((a, b) => cmpTuple(
      [b.selection_status === 'eligible' ? 1 : 0, b.P_IVI, b.B_score, b.M_score, b.O_score, b.F_score, -b.interruption_flag],
      [a.selection_status === 'eligible' ? 1 : 0, a.P_IVI, a.B_score, a.M_score, a.O_score, a.F_score, -a.interruption_flag]
    ));
    let rank = 1;
    for (const row of sorted) {
      const out = Object.assign({}, row);
      out.candidate_rank = rank;
      out.main_process_trigger = mainProcessTrigger(row);
      out.time_correction_note = row.time_removed_sec
        ? `疑似中断,剔除${Math.round(row.time_removed_sec * 100) / 100}秒超长无操作时间`
        : '未进行时间剔除';
      selected.push(out);
      rank++;
      if (rank > 2) break;
    }
  }
  return selected;
}

function addResultContext(results) {
  const byUser = new Map();
  for (const r of results) {
    if (!byUser.has(r.userOpenid)) byUser.set(r.userOpenid, []);
    byUser.get(r.userOpenid).push(r);
  }
  for (const rows of byUser.values()) {
    const mean = rows.reduce((s, r) => s + r.S_final, 0) / rows.length;
    const total = rows.reduce((s, r) => s + r.S_final, 0);
    const level = classifyTeacher(mean);
    for (const r of rows) {
      r.mean_score = mean;
      r.total_score = total;
      r.RD = r.S_final - mean;
      r.abs_RD = Math.abs(r.RD);
      r.teacher_level = level;
    }
  }
  return results;
}

function selectRCandidates(results, pByKey) {
  const selected = [];
  const byUser = new Map();
  for (const r of results) {
    if (!byUser.has(r.userOpenid)) byUser.set(r.userOpenid, []);
    byUser.get(r.userOpenid).push(r);
  }
  for (const [user, rows] of byUser) {
    const level = rows[0].teacher_level;
    const pivi = (q) => (pByKey.get(user + '|' + q) || {}).P_IVI || 0;
    let picks, types, orientation, reason;
    if (level === '总体偏高') {
      const ordered = rows.slice().sort((a, b) => cmpTuple(
        [a.RD, -pivi(a.questionIndex), a.questionIndex],
        [b.RD, -pivi(b.questionIndex), b.questionIndex]
      ));
      picks = ordered.slice(0, 2);
      types = ['最负偏离题', '最负偏离题'];
      orientation = '局部短板解释';
      reason = '总体偏高教师中低于个人平均最多';
    } else if (level === '总体偏低') {
      const ordered = rows.slice().sort((a, b) => cmpTuple(
        [b.RD, pivi(b.questionIndex), -b.questionIndex],
        [a.RD, pivi(a.questionIndex), -a.questionIndex]
      ));
      picks = ordered.slice(0, 2);
      types = ['最正偏离题', '最正偏离题'];
      orientation = '相对优势和可激活能力解释';
      reason = '总体偏低教师中高于个人平均最多';
    } else {
      const pos = maxBy(rows, (r) => [r.RD, pivi(r.questionIndex)]);
      const neg = minBy(rows, (r) => [r.RD, -pivi(r.questionIndex)]);
      picks = pos.questionIndex !== neg.questionIndex ? [pos, neg]
        : rows.slice().sort((a, b) => b.abs_RD - a.abs_RD).slice(0, 2);
      types = ['最正偏离题', '最负偏离题'];
      orientation = '能力分化画像';
      reason = '总体中等教师中一正一负偏离端点';
    }
    picks.forEach((row, i) => {
      const meta = itemMeta(row.questionIndex);
      selected.push(Object.assign({
        participantName: row.participantName || '',
        userOpenid: user,
        teacher_level: level,
        mean_score: row.mean_score,
        candidate_rank: i + 1,
        item_id: meta.item_id,
        questionIndex: row.questionIndex,
        item_title: meta.item_title
      }, metaOutputFields(meta), {
        item_score: row.S_final,
        RD: row.RD,
        abs_RD: row.abs_RD,
        candidate_type: types[i],
        deviation_strength: deviationStrength(row.abs_RD),
        selection_reason: reason,
        tie_break_reason: '并列时优先参考P-IVI、再按题号',
        interview_orientation: orientation
      }));
    });
  }
  return selected;
}

function rankScoreByDirection(rows, direction) {
  const ordered = direction === 'low'
    ? rows.slice().sort((a, b) => cmpTuple([a.RD, a.questionIndex], [b.RD, b.questionIndex]))
    : rows.slice().sort((a, b) => cmpTuple([b.RD, -b.questionIndex], [a.RD, -a.questionIndex]));
  const scores = [60, 50, 40, 30];
  const map = {};
  ordered.forEach((r, i) => { map[r.questionIndex] = i < scores.length ? scores[i] : 20; });
  return map;
}

function selectGCandidates(results, pByKey) {
  const selected = [];
  const gAllScores = new Map();
  const byUser = new Map();
  for (const r of results) {
    if (!byUser.has(r.userOpenid)) byUser.set(r.userOpenid, []);
    byUser.get(r.userOpenid).push(r);
  }
  for (const [user, rows] of byUser) {
    const level = rows[0].teacher_level;
    const pivi = {};
    const ptype = {};
    for (const r of rows) {
      const p = pByKey.get(user + '|' + r.questionIndex) || {};
      pivi[r.questionIndex] = p.P_IVI || 0.0;
      ptype[r.questionIndex] = p.process_type || '过程中等';
    }
    let picks = [];
    if (level === '总体偏高') {
      let lowRows = rows.filter((r) => r.RD < 0);
      if (!lowRows.length) lowRows = rows.slice().sort((a, b) => a.RD - b.RD).slice(0, 2);
      const lowRank = rankScoreByDirection(lowRows, 'low');
      for (const r of rows) {
        const base = lowRank[r.questionIndex] || 20;
        gAllScores.set(user + '|' + r.questionIndex, Math.max(base + 0.4 * pivi[r.questionIndex], base + 0.4 * (100 - pivi[r.questionIndex])));
      }
      const complexPick = maxBy(lowRows, (r) => [(lowRank[r.questionIndex] || 20) + 0.4 * pivi[r.questionIndex], -r.RD]);
      let remaining = lowRows.filter((r) => r.questionIndex !== complexPick.questionIndex);
      if (!remaining.length) remaining = rows.filter((r) => r.questionIndex !== complexPick.questionIndex);
      const simplePick = maxBy(remaining, (r) => [(lowRank[r.questionIndex] || 20) + 0.4 * (100 - pivi[r.questionIndex]), -Math.abs(r.RD)]);
      picks = [
        [complexPick, '结果低 + 过程复杂', (lowRank[complexPick.questionIndex] || 20) + 0.4 * pivi[complexPick.questionIndex]],
        [simplePick, '结果低 + 过程简单', (lowRank[simplePick.questionIndex] || 20) + 0.4 * (100 - pivi[simplePick.questionIndex])]
      ];
    } else if (level === '总体偏低') {
      let highRows = rows.filter((r) => r.RD > 0);
      if (!highRows.length) highRows = rows.slice().sort((a, b) => b.RD - a.RD).slice(0, 2);
      const highRank = rankScoreByDirection(highRows, 'high');
      for (const r of rows) {
        const base = highRank[r.questionIndex] || 20;
        gAllScores.set(user + '|' + r.questionIndex, Math.max(base + 0.4 * pivi[r.questionIndex], base + 0.4 * (100 - pivi[r.questionIndex])));
      }
      const complexPick = maxBy(highRows, (r) => [(highRank[r.questionIndex] || 20) + 0.4 * pivi[r.questionIndex], r.RD]);
      let remaining = highRows.filter((r) => r.questionIndex !== complexPick.questionIndex);
      if (!remaining.length) remaining = rows.filter((r) => r.questionIndex !== complexPick.questionIndex);
      const simplePick = maxBy(remaining, (r) => [(highRank[r.questionIndex] || 20) + 0.4 * (100 - pivi[r.questionIndex]), Math.abs(r.RD)]);
      picks = [
        [complexPick, '结果高 + 过程复杂', (highRank[complexPick.questionIndex] || 20) + 0.4 * pivi[complexPick.questionIndex]],
        [simplePick, '结果高 + 过程简单', (highRank[simplePick.questionIndex] || 20) + 0.4 * (100 - pivi[simplePick.questionIndex])]
      ];
    } else {
      const absRds = rows.map((r) => r.abs_RD);
      for (const r of rows) {
        gAllScores.set(user + '|' + r.questionIndex, minmaxNorm(r.abs_RD, absRds) * 0.6 + 0.4 * pivi[r.questionIndex]);
      }
      const high = maxBy(rows, (r) => [r.RD, pivi[r.questionIndex]]);
      const low = minBy(rows, (r) => [r.RD, -pivi[r.questionIndex]]);
      if (high.questionIndex === low.questionIndex) {
        const top2 = rows.slice().sort((a, b) => pivi[b.questionIndex] - pivi[a.questionIndex]).slice(0, 2);
        picks = [
          [top2[0], 'P分替补:过程最高题', pivi[top2[0].questionIndex]],
          [top2[1], 'P分替补:过程第二高题', pivi[top2[1].questionIndex]]
        ];
      } else {
        picks = [[high, '最高结果端', high.abs_RD * 100], [low, '最低结果端', low.abs_RD * 100]];
      }
    }
    picks.forEach(([row, relation, gscore], i) => {
      const meta = itemMeta(row.questionIndex);
      selected.push(Object.assign({
        participantName: row.participantName || '',
        userOpenid: user,
        teacher_level: level,
        candidate_rank: i + 1,
        item_id: meta.item_id,
        questionIndex: row.questionIndex,
        item_title: meta.item_title
      }, metaOutputFields(meta), {
        item_score: row.S_final,
        mean_score: row.mean_score,
        RD: row.RD,
        P_IVI: pivi[row.questionIndex],
        process_type: ptype[row.questionIndex],
        relation_type: relation,
        G_candidate_score: gscore,
        selection_reason: gSelectionReason(level, relation),
        interview_focus: gInterviewFocus(level, relation)
      }));
    });
  }
  return { selected, gAllScores };
}

function gSelectionReason(level, relation) {
  if (level === '总体偏高') return '总体偏高教师优先解释相对低点,并区分过程复杂和平稳低点';
  if (level === '总体偏低') return '总体偏低教师优先解释相对高点,并区分过程复杂和平稳高点';
  return '总体中等教师优先解释结果偏离两端形成的能力分化';
}

function gInterviewFocus(level, relation) {
  const map = {
    '结果低 + 过程复杂': '解释为什么投入较多比较和修正后仍形成相对低结果,关注专业标准冲突或误区',
    '结果低 + 过程简单': '解释为什么快速稳定形成相对低判断,关注经验惯性、隐性盲点或直觉偏差',
    '结果高 + 过程复杂': '解释如何通过比较、修正或重新权衡形成相对较好判断,关注可激活能力',
    '结果高 + 过程简单': '解释为什么能快速稳定形成较好判断,关注已有经验或优势图式',
    '最高结果端': '解释相对优势端如何形成',
    '最低结果端': '解释相对薄弱端如何形成'
  };
  return map[relation] || '解释该题的结果与过程关系';
}

/* =========================================================================
 * 八、IIV 综合明细
 * ========================================================================= */

function buildIivDetail(results, pDetail, logEvents, scoreDict) {
  const pByKey = new Map();
  for (const r of pDetail) pByKey.set(r.userOpenid + '|' + r.questionIndex, r);
  const detailRows = [];
  for (const result of results) {
    const user = result.userOpenid;
    const q = result.questionIndex;
    const process = pByKey.get(user + '|' + q) || {};
    const events = logEvents.get(user + '|' + q) || [];
    const { trajectory } = buildTrajectory(events, result.chosen_comb || '');
    const scoresArr = trajectory.map((c) => scoreOf(scoreDict, q, c)).filter((s) => s != null);

    const sFinal = result.S_final || 0;
    const sInitial = scoresArr.length ? scoresArr[0] : sFinal;
    const withFinal = scoresArr.concat([sFinal]);
    const sMax = scoresArr.length ? Math.max(...withFinal) : sFinal;
    const sMin = scoresArr.length ? Math.min(...withFinal) : sFinal;

    const gain = sFinal - sInitial;
    const volatility = (sMax - sMin) / 4.0;
    const deterioration = Math.max(0.0, (sMax - sFinal) / 4.0);
    const recovery = Math.max(0.0, (sFinal - sMin) / 4.0);
    const revisionSignal = Math.max(deterioration, recovery);

    const actionCount = process.action_count || 0;
    const opComplexity = actionCount <= 1 ? 0.0 : 1.0 - (1.0 / actionCount);
    const topChange = process.first_position_change_count || 0;
    const bottomChange = process.last_position_change_count || 0;
    const optionFocus = Math.min(1.0, (topChange + bottomChange) / 4.0);
    const processConflict = Math.max(opComplexity, volatility);

    const resultRisk = (4.0 - sFinal) / 4.0;
    const relativeDeviation = Math.abs(result.RD || 0.0) / 4.0;
    const pIvi = process.P_IVI || 0.0;
    const pIviNorm = clip01(pIvi / 100.0);

    const meta = itemMeta(q);
    detailRows.push(Object.assign({
      participantName: result.participantName || '',
      userOpenid: user,
      teacher_level: result.teacher_level || '',
      mean_score: result.mean_score,
      total_score: result.total_score,
      item_id: meta.item_id,
      questionIndex: q,
      item_title: meta.item_title
    }, metaOutputFields(meta), {
      primary_ability_type: meta.primary,
      secondary_ability_type: meta.secondary,
      chosen_comb: result.chosen_comb || '',
      S_initial: sInitial,
      S_final: sFinal,
      S_max: sMax,
      S_min: sMin,
      ResultRisk: resultRisk,
      RelativeDeviation: relativeDeviation,
      RD: result.RD || 0.0,
      abs_RD: result.abs_RD || 0.0,
      Gain: gain,
      Volatility: volatility,
      Deterioration: deterioration,
      Recovery: recovery,
      RevisionSignal: revisionSignal,
      ProcessConflict: processConflict,
      OptionFocus: optionFocus,
      P_IVI: pIvi,
      P_IVI_norm: pIviNorm,
      effective_first_response_time_sec: process.effective_first_response_time_sec,
      effective_post_first_time_sec: process.effective_post_first_time_sec,
      effective_item_time_sec: process.effective_item_time_sec,
      ln_first: safeLogSeconds(process.effective_first_response_time_sec),
      ln_post: safeLogSeconds(process.effective_post_first_time_sec),
      action_count: actionCount,
      revision_count: process.revision_count || 0,
      first_position_change_count: topChange,
      last_position_change_count: bottomChange,
      top_bottom_swap_count: process.top_bottom_swap_count || 0,
      unique_state_count: process.unique_state_count || 0,
      repeated_state_count: process.repeated_state_count || 0,
      backtracking_count: process.backtracking_count || 0,
      oscillation_count: process.oscillation_count || 0,
      max_idle_gap_sec: process.max_idle_gap_sec || 0,
      time_removed_sec: process.time_removed_sec || 0,
      interruption_flag: process.interruption_flag || 0,
      priorityOption: process.priorityOption || '',
      priorityPair: process.priorityPair || '',
      priorityOptionText: process.priorityOptionText || '',
      priorityPairText: process.priorityPairText || '',
      process_type: process.process_type || '过程中等',
      process_labels: process.process_labels || '',
      suggested_interview_focus: process.suggested_interview_focus || ''
    }));
  }

  // 计算 z-score(个人内 ln 时间)
  const byUserFirst = new Map(), byUserPost = new Map();
  for (const row of detailRows) {
    if (row.ln_first != null) {
      if (!byUserFirst.has(row.userOpenid)) byUserFirst.set(row.userOpenid, []);
      byUserFirst.get(row.userOpenid).push(row.ln_first);
    }
    if (row.ln_post != null) {
      if (!byUserPost.has(row.userOpenid)) byUserPost.set(row.userOpenid, []);
      byUserPost.get(row.userOpenid).push(row.ln_post);
    }
  }
  const stats = {};
  const users = new Set(detailRows.map((r) => r.userOpenid));
  for (const u of users) {
    const first = byUserFirst.get(u) || [];
    const post = byUserPost.get(u) || [];
    stats[u] = {
      firstMean: first.length ? first.reduce((a, b) => a + b, 0) / first.length : null,
      firstStd: sampleStd(first),
      postMean: post.length ? post.reduce((a, b) => a + b, 0) / post.length : null,
      postStd: sampleStd(post)
    };
  }
  for (const row of detailRows) {
    const st = stats[row.userOpenid];
    const zFirst = row.ln_first != null && st.firstMean != null && st.firstStd > 0
      ? (row.ln_first - st.firstMean) / st.firstStd : 0.0;
    const zPost = row.ln_post != null && st.postMean != null && st.postStd > 0
      ? (row.ln_post - st.postMean) / st.postStd : 0.0;
    const timeRawZ = Math.max(0.0, zFirst, zPost);
    const timeSignal = Math.min(1.0, timeRawZ / 2.0);
    const iivClassic = 0.40 * row.ResultRisk + 0.20 * row.ProcessConflict + 0.20 * row.RevisionSignal + 0.10 * timeSignal + 0.10 * row.OptionFocus;
    const iivHybrid = 0.30 * row.ResultRisk + 0.15 * row.RelativeDeviation + 0.15 * row.ProcessConflict + 0.15 * row.RevisionSignal + 0.10 * timeSignal + 0.10 * row.OptionFocus + 0.05 * row.P_IVI_norm;
    row.Z_First = zFirst;
    row.Z_Post = zPost;
    row.TimeSignal_raw_z = timeRawZ;
    row.TimeSignal = timeSignal;
    row.IIV_classic = iivClassic;
    row.IIV_hybrid = iivHybrid;
    row.IIV_interpretation = iivInterpretation(row);
  }
  return detailRows;
}

function iivInterpretation(row) {
  const parts = [];
  const comps = [
    ['结果风险', row.ResultRisk || 0],
    ['个人内相对偏离', row.RelativeDeviation || 0],
    ['过程冲突', row.ProcessConflict || 0],
    ['修正信号', row.RevisionSignal || 0],
    ['相对时间信号', row.TimeSignal || 0],
    ['选项焦点变化', row.OptionFocus || 0],
    ['同题过程信息量', row.P_IVI_norm || 0]
  ];
  const top = comps.slice().sort((a, b) => b[1] - a[1]).slice(0, 3).filter((x) => x[1] > 0).map((x) => x[0]);
  if (top.length) parts.push('主要IIV信号:' + top.join('、'));
  if (row.priorityPair) parts.push('可追问选项比较:' + pairText(row.questionIndex, row.priorityPair));
  else if (row.priorityOption) parts.push('可追问重点选项:' + optionText(row.questionIndex, row.priorityOption));
  return parts.length ? parts.join(';') : 'IIV信号不突出,可作为备用参考';
}

/* =========================================================================
 * 九、最终 3 题整合
 * ========================================================================= */

function addSourceCandidates(pool, rows, source) {
  // pool 必须为 Map(而非普通对象),保 Python dict 的插入顺序;JS 对象数字键会被强制升序迭代,
  // 会破坏后续 stable sort 的 tie-break 结果。
  for (const row of rows) {
    const q = row.questionIndex;
    const meta = itemMeta(q);
    if (!pool.has(q)) {
      pool.set(q, Object.assign({
        participantName: row.participantName || '',
        userOpenid: row.userOpenid || '',
        questionIndex: q,
        item_id: meta.item_id,
        item_title: meta.item_title
      }, metaOutputFields(meta), {
        primary_ability_type: meta.primary,
        secondary_ability_type: meta.secondary,
        sources: [],
        R_rank: '', P_rank: '', G_rank: '',
        replacement_note: ''
      }));
    }
    const cand = pool.get(q);
    cand.sources.push(source);
    cand[source + '_rank'] = row.candidate_rank || '';
    cand.source_count = new Set(cand.sources).size;
  }
}

function fes(cand) {
  let s = 0;
  if (cand.sources.includes('R')) s += 20 + (cand.R_rank === 1 ? 8 : 4);
  if (cand.sources.includes('P')) s += 20 + (cand.P_rank === 1 ? 8 : 4);
  if (cand.sources.includes('G')) s += 30 + (cand.G_rank === 1 ? 10 : 5);
  return s;
}

function reserveScore(user, q, rows, pByKey, gAllScores) {
  const rValues = rows.map((r) => r.abs_RD);
  const row = rows.find((r) => r.questionIndex === q);
  const rNorm = minmaxNorm(row.abs_RD, rValues);
  const pNorm = (pByKey.get(user + '|' + q) || {}).P_IVI || 0.0;
  const gValues = rows.map((r) => gAllScores.get(user + '|' + r.questionIndex) || 0.0);
  const gNorm = minmaxNorm(gAllScores.get(user + '|' + q) || 0.0, gValues);
  return 0.45 * gNorm + 0.30 * pNorm + 0.25 * rNorm;
}

function coverageRepair(chosen, allCandidates, rows) {
  let note = '';
  const primarySet = (items) => new Set(items.map((c) => c.primary_ability_type).filter(Boolean));
  if (chosen.length < 3) return { chosen, note };
  const counts = {};
  for (const c of chosen) counts[c.primary_ability_type] = (counts[c.primary_ability_type] || 0) + 1;
  const maxCount = Math.max(...Object.values(counts));
  if (primarySet(chosen).size >= 2 && maxCount <= 2) return { chosen, note };

  const chosenQ = new Set(chosen.map((c) => c.questionIndex));
  const repeatedTypes = counts;
  const replaceCandidates = chosen.slice().sort((a, b) => cmpTuple(
    [repeatedTypes[b.primary_ability_type] || 0, -(b.FES || 0)],
    [repeatedTypes[a.primary_ability_type] || 0, -(a.FES || 0)]
  ));
  const currentTypes = primarySet(chosen);
  const alternatives = Array.from(allCandidates)
    .filter((c) => !chosenQ.has(c.questionIndex) && !currentTypes.has(c.primary_ability_type))
    .sort((a, b) => cmpTuple([b.FES || 0, b.RS || 0], [a.FES || 0, a.RS || 0]));
  if (alternatives.length) {
    const toRemove = minBy(replaceCandidates, (c) => [c.FES || 0, c.RS || 0]);
    let out = chosen.filter((c) => c.questionIndex !== toRemove.questionIndex);
    const alt = alternatives[0];
    alt.replacement_note = '为避免最终3题能力类型过度集中,按覆盖规则补入';
    out.push(alt);
    chosen = out;
    note = '触发能力覆盖修正';
  }
  return { chosen, note };
}

function finalReason(cand, iiv) {
  iiv = iiv || {};
  const iivNote = iiv.IIV_interpretation ? ';IIV规范化信号:' + iiv.IIV_interpretation : '';
  if ((cand.source_count || 0) >= 2) return 'R/P/G多源证据重复入选,系统解释强度较高' + iivNote;
  if (cand.sources && cand.sources.includes('G')) return '来自G分候选,具有结果-过程关系解释价值' + iivNote;
  if (cand.sources && cand.sources.includes('P')) return '来自P分候选,作答过程具有访谈解释价值' + iivNote;
  if (cand.sources && cand.sources.includes('R')) return '来自R分候选,相对个人整体表现具有结果偏离解释价值' + iivNote;
  return '候选不足时按备用综合分补入' + iivNote;
}

function coverageRole(cand) {
  return `覆盖能力类型:${cand.primary_ability_type || ''}`;
}

function finalFocus(cand, rRows, pRows, gRows) {
  const q = cand.questionIndex;
  const focuses = [];
  for (const g of gRows) if (g.questionIndex === q) focuses.push(g.interview_focus || '');
  for (const p of pRows) if (p.questionIndex === q) focuses.push(p.suggested_interview_focus || '');
  for (const r of rRows) if (r.questionIndex === q) focuses.push(r.interview_orientation || '');
  const clean = focuses.filter(Boolean);
  return clean.length ? clean.join(';') : '围绕该情境理解、选项比较和判断依据进行访谈';
}

function buildSafeInterviewPrompt(row) {
  const q = row.questionIndex;
  const scenarioQs = SCENARIO_FOLLOWUP_QUESTIONS[Number(q)] || [];
  const parts = [
    `请回忆第${q}题这个情境。`,
    `当时的情境是:${row.scenarioText || ''}`,
    '当时提供的做法包括:' + 'ABCD'.split('').map((opt) => optionText(q, opt, true)).join(';') + '。'
  ];
  if (scenarioQs.length) parts.push('可以先从这个情境本身追问:' + scenarioQs.join(';') + '。');
  if (row.priorityPair) {
    parts.push('然后可围绕其作答过程中的重点比较追问:你当时是怎样比较以下两种做法的:' + pairText(q, row.priorityPair, true) + '?');
  } else if (row.priorityOption) {
    parts.push('然后可围绕其作答过程中的重点选项追问:你当时对这一做法(' + optionText(q, row.priorityOption, true) + ')的考虑是什么?');
  } else {
    parts.push('然后可追问:你当时主要依据什么来排列这些做法?');
  }
  parts.push('如果教师提到调整过顺序,再追问:是什么信息或想法让你改变了当时的排序?');
  parts.push('请只围绕情境理解、判断依据和选项比较提问,不要提及任何内部计算指标、得分、排名、入选原因或评价性判断。');
  return parts.join('');
}

function buildFinalSelection(results, rSelected, pSelected, gSelected, pByKey, gAllScores, iivByKey) {
  iivByKey = iivByKey || new Map();
  const byUserResults = new Map();
  for (const r of results) {
    if (!byUserResults.has(r.userOpenid)) byUserResults.set(r.userOpenid, []);
    byUserResults.get(r.userOpenid).push(r);
  }
  const groupBy = (arr) => {
    const m = new Map();
    for (const x of arr) {
      if (!m.has(x.userOpenid)) m.set(x.userOpenid, []);
      m.get(x.userOpenid).push(x);
    }
    return m;
  };
  const rByUser = groupBy(rSelected);
  const pByUser = groupBy(pSelected);
  const gByUser = groupBy(gSelected);

  const finalRows = [];
  for (const [user, rows] of byUserResults) {
    const participant = rows[0].participantName || '';
    const pool = new Map();
    addSourceCandidates(pool, rByUser.get(user) || [], 'R');
    addSourceCandidates(pool, pByUser.get(user) || [], 'P');
    addSourceCandidates(pool, gByUser.get(user) || [], 'G');
    for (const [q, cand] of pool) {
      cand.FES = fes(cand);
      cand.RS = reserveScore(user, q, rows, pByKey, gAllScores);
    }

    let chosen, note = '';
    const poolArr = Array.from(pool.values());
    if (poolArr.length >= 3) {
      chosen = poolArr.slice().sort((a, b) => cmpTuple(
        [b.FES, b.source_count, b.G_rank !== '' ? 1 : 0],
        [a.FES, a.source_count, a.G_rank !== '' ? 1 : 0]
      )).slice(0, 3);
      const rep = coverageRepair(chosen, poolArr, rows);
      chosen = rep.chosen; note = rep.note;
    } else {
      chosen = poolArr.slice();
      const needed = 3 - chosen.length;
      const usedQ = new Set(chosen.map((c) => c.questionIndex));
      const reserves = [];
      for (const r of rows) {
        if (usedQ.has(r.questionIndex)) continue;
        const meta = itemMeta(r.questionIndex);
        reserves.push(Object.assign({
          participantName: participant,
          userOpenid: user,
          questionIndex: r.questionIndex,
          item_id: meta.item_id,
          item_title: meta.item_title
        }, metaOutputFields(meta), {
          primary_ability_type: meta.primary,
          secondary_ability_type: meta.secondary,
          sources: [], source_count: 0,
          R_rank: '', P_rank: '', G_rank: '',
          FES: 0,
          RS: reserveScore(user, r.questionIndex, rows, pByKey, gAllScores),
          replacement_note: '候选池不足3题,按备用综合分补入'
        }));
      }
      chosen = chosen.concat(reserves.slice().sort((a, b) => b.RS - a.RS).slice(0, needed));
      const rep = coverageRepair(chosen, poolArr.concat(reserves), rows);
      chosen = rep.chosen; note = rep.note;
    }

    chosen = chosen.slice().sort((a, b) => cmpTuple([b.FES, b.RS], [a.FES, a.RS])).slice(0, 3);
    chosen.forEach((cand, i) => {
      const rank = i + 1;
      const micro = pByKey.get(user + '|' + cand.questionIndex) || {};
      const iiv = iivByKey.get(user + '|' + cand.questionIndex) || {};
      const priorityOption = micro.priorityOption || '';
      const priorityPair = micro.priorityPair || '';
      const rowOut = {
        participantName: participant,
        userOpenid: user,
        final_rank: rank,
        final_item_id: cand.item_id,
        questionIndex: cand.questionIndex,
        item_title: cand.item_title,
        scenarioText: cand.scenarioText || '',
        optionA: cand.optionA || '',
        optionB: cand.optionB || '',
        optionC: cand.optionC || '',
        optionD: cand.optionD || '',
        primary_ability_type: cand.primary_ability_type,
        secondary_ability_type: cand.secondary_ability_type,
        source_summary: (cand.sources || []).join('/') || '备用补入',
        source_count: cand.source_count || 0,
        R_rank: cand.R_rank || '',
        P_rank: cand.P_rank || '',
        G_rank: cand.G_rank || '',
        ResultRisk: iiv.ResultRisk != null ? iiv.ResultRisk : '',
        RelativeDeviation: iiv.RelativeDeviation != null ? iiv.RelativeDeviation : '',
        ProcessConflict: iiv.ProcessConflict != null ? iiv.ProcessConflict : '',
        RevisionSignal: iiv.RevisionSignal != null ? iiv.RevisionSignal : '',
        TimeSignal: iiv.TimeSignal != null ? iiv.TimeSignal : '',
        OptionFocus: iiv.OptionFocus != null ? iiv.OptionFocus : '',
        P_IVI_norm: iiv.P_IVI_norm != null ? iiv.P_IVI_norm : '',
        IIV_classic: iiv.IIV_classic != null ? iiv.IIV_classic : '',
        IIV_hybrid: iiv.IIV_hybrid != null ? iiv.IIV_hybrid : '',
        FES: cand.FES || 0,
        RS: cand.RS || 0,
        selection_reason: finalReason(cand, iiv),
        coverage_role: coverageRole(cand),
        interview_focus: finalFocus(cand, rByUser.get(user) || [], pByUser.get(user) || [], gByUser.get(user) || []),
        priorityOption,
        priorityPair,
        priorityOptionText: optionText(cand.questionIndex, priorityOption),
        priorityPairText: pairText(cand.questionIndex, priorityPair),
        replacement_note: cand.replacement_note || note,
        forbiddenDisclosureReminder: OUTPUT_WARNING
      };
      rowOut.safeInterviewPrompt = buildSafeInterviewPrompt(rowOut);
      finalRows.push(rowOut);
    });
  }
  return finalRows;
}

/* =========================================================================
 * 十、对外 API
 * ========================================================================= */

/**
 * 主入口。
 * @param {Array} resultsRows CSV/DB 记录:[{participantName, userOpenid, answers(str|obj)}]
 * @param {Array} logRows CSV/DB 记录:[{userOpenid, questionIndex, timestamp, action, previousValue?, currentValue?, answer?}]
 * @param {object} options { logQuestionBase: 'auto'|0|1 }
 * @returns {{rSelected, pDetail, pSelected, gSelected, iivDetail, finalSelected, logBaseNote}}
 */
function calculate(resultsRows, logRows, options) {
  options = options || {};
  const logQuestionBase = options.logQuestionBase == null ? 'auto' : options.logQuestionBase;

  // 校验
  if (!resultsRows.length) throw new Error('结果数据为空,无法计算。');
  const rHead = new Set(Object.keys(resultsRows[0]));
  for (const c of REQUIRED_RESULTS_COLUMNS) if (!rHead.has(c)) throw new Error(`结果数据缺少必要列:${c}`);
  if (!logRows.length) throw new Error('过程日志为空,无法计算。');
  const lHead = new Set(Object.keys(logRows[0]));
  for (const c of REQUIRED_LOG_COLUMNS) if (!lHead.has(c)) throw new Error(`过程日志缺少必要列:${c}`);

  const scoreDict = buildScoreDict();
  let results = parseResults(resultsRows, scoreDict);
  results = addResultContext(results);
  const { grouped: logEvents, note: logBaseNote } = groupLogEvents(logRows, logQuestionBase);

  let pDetail = extractProcessFeatures(results, logEvents);
  pDetail = addPScores(pDetail, options.norms);
  const pByKey = new Map();
  for (const r of pDetail) pByKey.set(r.userOpenid + '|' + r.questionIndex, r);

  const pSelected = selectPCandidates(pDetail);
  const rSelected = selectRCandidates(results, pByKey);
  const { selected: gSelected, gAllScores } = selectGCandidates(results, pByKey);
  const iivDetail = buildIivDetail(results, pDetail, logEvents, scoreDict);
  const iivByKey = new Map();
  for (const r of iivDetail) iivByKey.set(r.userOpenid + '|' + r.questionIndex, r);

  const finalSelected = buildFinalSelection(results, rSelected, pSelected, gSelected, pByKey, gAllScores, iivByKey);

  return { rSelected, pDetail, pSelected, gSelected, iivDetail, finalSelected, logBaseNote };
}

module.exports = {
  calculate,
  // 导出所有子函数以便对拍单测
  buildScoreDict, parseResults, addResultContext,
  groupLogEvents, extractProcessFeatures, addPScores,
  selectPCandidates, selectRCandidates, selectGCandidates,
  buildIivDetail, buildFinalSelection,
  itemMeta, round6,
  ABILITY_MAP, QUESTION_CONTENT
};
