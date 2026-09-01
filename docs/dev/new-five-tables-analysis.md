# TCIM 新五表唯一运行架构分析

日期：2026-08-29

范围：仅分析 outputs/TCIM_新五表唯一运行架构_V0.1_20260829/tables 下五个 V0.1 工作簿的 DATA、DICTIONARY、RUNTIME_CONTRACT、QUESTION_INDEX 与 QA_SUMMARY。

结论适用范围：当前五表全部标记为 SIMULATION_ACTIVE 与 AI_SIMULATED_REVIEW，不应据此宣称已经达到生产发布或人工专家审核状态。

## 1. 总结

五表已经形成一条可编译、可追溯的专业支持链：

1. 表1提供情境事实、未知项、条件变体和前测先验。
2. 表2提供全局能力透镜与同一能力的多条可接受路径。
3. 表3把可支持的理解写成证据命题，并限定证据来源、最低证据层级、反证、伪证据和最大结论。
4. 表4把开放探询、稀疏监督、硬边界和编译边界写成对话政策。
5. 表5限定综合结论、记忆写入和 TEVV 测试/发布门。

运行时不应把工作簿或整张 DATA 直接注入模型。当前比较版在启动时严格校验并编译为按题 RuntimeCard，建立稳定 ID 索引。Dialogue Agent 保留情境理解、对话方向、承接方式、措辞和表外开放线索的主导权；五表中的 AFFORDANCE/MONITOR 是专业视野与提醒，不是路线白名单。模型可以形成新假设和表外 open thread，但不能把表外内容伪装成规范 Evidence，也不能自行放宽证据门、提高结论强度、越权写记忆或绕过硬边界。

当前版本有三项会直接影响编译正确性的高优先级问题：表2 parent_concept_ids 中存在 59 个无法解析为正式能力 ID 的值；表3 path_refs 全列为空但 QA 仍显示通过；表4 policy_type 与 runtime_use 存在系统性错配。Q08 还暴露出“跨情境倾向”未要求跨情境证据、记忆政策没有显式证据命题、硬边界的拒绝权限字段相互冲突等语义问题。

## 2. 数据规模与每题记录数

| 表 | DATA 记录数 | ALL | Q01 | Q02 | Q03 | Q04 | Q05 | Q06 | Q07 | Q08 | Q09 | Q10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 表1 情境深描与条件边界 | 150 | 0 | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 |
| 表2 教师游戏支持能力多路径 Ontology | 146 | 12 | 10 | 12 | 13 | 12 | 12 | 15 | 15 | 15 | 15 | 15 |
| 表3 证据命题、来源等级与反事实判据 | 55 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| 表4 开放探询可供性与稀疏监督 | 68 | 18 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |
| 表5 综合判断、记忆写入与 TEVV | 68 | 18 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 |

按运行用途计数：

| 表 | runtime_use 分布 |
|---|---|
| 表1 | SCENARIO_BRIEF 100；PRETEST_PRIOR 50 |
| 表2 | GLOBAL_LENS 12；SCENARIO_LENS 134 |
| 表3 | ORIGIN_POLICY 5；EVIDENCE_ANCHOR 50 |
| 表4 | AFFORDANCE_CARD 35；MONITOR_CARD 12；HARD_BOUNDARY 14；COMPILER_BOUNDARY 7 |
| 表5 | SYNTHESIS_POLICY 31；MEMORY_POLICY 17；TEVV_CASE 20 |

## 3. 运行时小卡片编译方案

### 3.1 卡片类型

| 来源 | 小卡片 | 主体字段 | 运行时作用 |
|---|---|---|---|
| 表1 | ScenarioBriefCard | 情境事实、未知项、条件变体、禁止假设、判别观察 | 给出当前题可使用的事实边界；事实、未知与假设必须保留不同认识论标签 |
| 表1 | PretestPriorCard | input_binding、option_code、assessment_relation、排序规则 | 只形成可撤销先验，不直接成为结论或停止理由 |
| 表2 | GlobalCapabilityLensCard | 全局能力概念及父子关系 | 提供跨题共享的观察透镜 |
| 表2 | ScenarioCapabilityPathCard | 能力概念、路径、适用/排除条件、权衡、机会与指标 | 允许同一能力通过多条路径呈现；禁止把“没有某一路径”当成“没有能力” |
| 表3 | ResponseOriginPolicyCard | allowed_response_origins、独立性、教师确认、原文跨度 | 规定什么来源的回答可进入证据池 |
| 表3 | EvidenceAnchorCard | 命题模板、最低证据层级、支持锚点、反证、伪证据、结论上限 | Evidence Validator 的判定合同 |
| 表4 | DialogueAffordanceCard | trigger、posture、freedom_scope、allowed_actions、probe_intents | 给 Dialogue Agent 可选择的专业探询启示，不构成固定路线 |
| 表4 | RRMCMonitorCard | 事件触发、周期、过期轮次、关系质量与认知负荷信号 | 低频监测是否继续、减载或修复 |
| 表4 | HardBoundaryCard | prohibited_actions、constraint_level、safety_gate_required | 不可被模型自由裁量覆盖的安全/权限/证据边界 |
| 表4 | CompilerBoundaryCard | 编译范围和开放性基线 | 限定哪些字段可进入提示词及何时加载 |
| 表5 | SynthesisPolicyCard | 所需证据/能力、来源多样性、反证、确认、置信区间和最大结论 | 限制 Synthesis 的可输出结论 |
| 表5 | MemoryPolicyCard | memory_type、写入/过期/纠正规则 | 由 Memory Governor 决定是否写入、何时失效和如何纠正 |
| 表5 | TEVVCaseCard | case、level、method、slice、release_gate | 测试与发布门，不应成为对话内容 |

### 3.2 推荐加载流程

启动编译期：

- 只读取五个唯一运行版文件；找不到、版本不符、重复 ID、引用断裂或枚举非法时应失败关闭，不回退旧表。
- 按字段名解析，不能依赖 Excel 列序；布尔值、整数、枚举、多值列表和 support_anchors 的结构化文本必须类型化。
- 建立 byQuestion、byScenario、conceptById、pathById、understandingById、claimById、policiesByTargetUnderstanding、synthesisByClaim 等索引。
- 公共的版本、来源、审核、发布范围等字段编译成 GovernanceEnvelope，避免每轮重复注入模型，但不能丢失审计信息。

题目会话开始：

- 加载表1该题 ScenarioBriefCard 与 PretestPriorCard。
- 加载表2 ALL 的 GlobalCapabilityLensCard 和该题的 ScenarioCapabilityPathCard。
- 加载表3 ALL 的 ResponseOriginPolicyCard 和该题 EvidenceAnchorCard。
- 加载表4 ALL 的全局边界/监测卡及该题政策；硬边界优先级高于可供性。
- 加载表5该题综合/记忆政策；TEVV 卡留在测试与门禁侧，不进入普通对话上下文。

每轮：

- 先由确定性路由器根据 question_id、scenario_id、事件信号、target_understanding_ids 与 target_capability_ids 选卡。
- Dialogue Agent 自主决定承接、澄清、深化、转向或收束，并可创建表外开放线索；卡片只扩大专业视野、提供可供性和低频提醒。
- Evidence Validator 按表3裁决模型提出的证据候选；模型不能直接决定 canonical Evidence 等级。表5在当前比较版中提供综合上限和完成建议，其中完成建议是 advisory，不强制 Dialogue Agent 走固定路线。
- 本比较版暂不接入 RRMC。后续版本的 RRMC 只应在事件触发或低频周期触发；Safety/Permission Gate 与 Memory Governor 是独立门，不由 Dialogue Agent 自行批准。

## 4. 五张 DATA 页字段全量映射

以下字段名称按工作簿原样保留。每个字段均应按名称映射，不应按列号读取。

### 4.1 表1：情境深描与条件边界（33 字段）

| 字段组 | 全部字段 | 编译含义 |
|---|---|---|
| 身份与路由 | schema_version；record_id；question_id；scenario_id；context_variant_id | 版本、唯一行 ID、题目/情境路由和条件变体定位 |
| 内容与认识论 | item_type；epistemic_status；actor；time_order；content | 区分情境叙事、专业焦点、选项、先验规则、事实与重要未知；标明内容的认识论地位、行动者和顺序 |
| 前测绑定 | input_binding；option_code；assessment_relation | 把选项与输入控件、选项码和 PRIOR_ONLY/NOT_APPLICABLE 关系绑定 |
| 条件解释 | applicability_condition；changes_judgment_when；plausible_interpretation；alternative_explanation；missing_information；discriminating_observation | 规定何时适用、什么条件会改变判断、可行解释、替代解释、缺失信息和能区分解释的观察 |
| 关联与约束 | related_capability_ids；do_not_assume；privacy_class；runtime_use | 关联表2能力；显式列出禁止假定；隐私等级；决定编译为场景卡还是前测先验卡 |
| 来源 | source_kind；source_ref | 来源类型与可审计引用 |
| 共同治理 | active_in_simulation；review_status；content_confidence；release_scope；simulated_reviewer_roles；decision_basis；uncertainty_note；version | 模拟启用、审核/置信/发布状态、模拟审阅角色、决策依据、不确定性和记录版本 |

主要枚举分布：item_type 为 SCENARIO_NARRATIVE 10、PROFESSIONAL_FOCUS 10、PRETEST_OPTION 40、PRETEST_PRIOR_RULE 10、SCENARIO_FACT 53、IMPORTANT_UNKNOWN 27；epistemic_status 为 SCENARIO_FACT 37、ASSESSMENT_SPEC 60、UNKNOWN 19、HUMAN_HYPOTHESIS 17、CONTEXT_VARIANT 15、AI_HYPOTHESIS 2。

### 4.2 表2：教师游戏支持能力多路径 Ontology（34 字段）

| 字段组 | 全部字段 | 编译含义 |
|---|---|---|
| 身份与路由 | schema_version；record_id；question_id；scenario_id | 版本、唯一行 ID、全局或题目/情境路由 |
| 能力概念节点 | capability_concept_id；parent_concept_ids；domain_id；capability_name；capability_definition | 定义能力概念、父概念、领域、名称和边界 |
| 多路径节点 | path_id；path_name；path_description；applicability_conditions；exclusion_conditions；tradeoffs；observable_opportunities；observable_indicators；alternative_path_ids | 定义同一能力的不同实现路径、适用/排除条件、权衡、可观察机会与指标，以及同等可接受的替代路径 |
| 跨表关联与负面约束 | related_context_ids；not_equivalent_to；absence_not_interpretable_when；prohibited_inference；model_autonomy_note；runtime_use | 回指表1情境记录；防止概念偷换、缺失即否定和越权推断；限定模型自主；选择全局或情境透镜卡 |
| 来源 | source_kind；source_ref | 来源类型与引用 |
| 共同治理 | active_in_simulation；review_status；content_confidence；release_scope；simulated_reviewer_roles；decision_basis；uncertainty_note；version | 模拟启用、审核/置信/发布状态与审计元数据 |

### 4.3 表3：证据命题、来源等级与反事实判据（40 字段）

| 字段组 | 全部字段 | 编译含义 |
|---|---|---|
| 身份与路由 | schema_version；record_id；question_id；scenario_id；understanding_id | 版本、唯一行 ID、题目/情境和目标理解定位 |
| 命题与 Ontology 关联 | evidence_claim_id；claim_type；capability_refs；path_refs；claim_template | 定义证据命题类型、关联能力/路径和可支持命题模板 |
| 证据准入 | applicability_conditions；support_anchors；allowed_response_origins；independence_requirement；teacher_confirmation_required；source_span_required；min_evidence_level | 规定适用条件、L0-L3 支持锚点、允许的来源、独立性、教师确认、原文跨度和最低层级 |
| 反证与冲突 | counterevidence；pseudo_evidence；alternative_explanation；discriminating_observation；contradiction_rule；context_boundary | 规定反证、伪证据、替代解释、区分观察、冲突处理和情境边界 |
| 结论、公平与记忆 | max_supported_conclusion；prohibited_conclusion；cross_context_requirement；fairness_note；memory_candidate_allowed；canonical_write_owner | 限定最大结论、禁止结论、跨情境要求、公平说明、是否可成为记忆候选以及唯一写入责任方 |
| 编译 | runtime_use | 选择来源政策卡或证据锚点卡 |
| 来源 | source_kind；source_ref | 来源类型与引用 |
| 共同治理 | active_in_simulation；review_status；content_confidence；release_scope；simulated_reviewer_roles；decision_basis；uncertainty_note；version | 模拟启用、审核/置信/发布状态与审计元数据 |

表3的 allowed_response_origins 使用 RO0-RO4 来源层级组合：RO0 是教师未经提示主动提出；RO1 是开放问题后独立提出；RO2 是澄清追问后补充；RO3 是 AI 给出选项后选择或认可；RO4 是 AI 讲解后复述或迁移。RO3/RO4 只能支持识别、认可或学习候选，不能回溯证明教师在对话前已具备该能力。最低证据层级分布为 L0 3、L1 2、L2 50；所有题目证据命题当前最低要求均为 L2。

### 4.4 表4：开放探询可供性与稀疏监督（40 字段）

| 字段组 | 全部字段 | 编译含义 |
|---|---|---|
| 身份与路由 | schema_version；record_id；dialogue_policy_id；question_id；scenario_id | 版本、唯一行 ID、政策 ID 和题目/情境路由 |
| 政策定义与目标 | policy_type；policy_name；target_understanding_ids；target_capability_ids | 政策类型/名称以及目标理解和能力 |
| 对话自由度 | mission_relation；trigger_conditions；posture_options；freedom_scope；allowed_actions；probe_intents；optional_fixture_examples | 任务关系、触发条件、可选姿态、自由边界、允许动作、探询意图和非运行示例 |
| 禁止与强度 | prohibited_actions；negative_examples；constraint_level；rrmc_signal | 禁止动作、负例、ADVISORY/SOFT/HARD 强度和继续/暂停修复信号 |
| 监测与拒绝 | event_triggers；periodic_interval；expiration_turns；agent_may_decline；decline_reason_codes；relationship_quality_signals；cognitive_load_signals | 事件/周期/过期、代理能否拒绝及理由、关系质量和认知负荷信号 |
| 门、责任与编译 | safety_gate_required；owner；runtime_use | 是否必须通过安全门、责任方和卡片类型 |
| 来源 | source_kind；source_ref | 来源类型与引用 |
| 共同治理 | active_in_simulation；review_status；content_confidence；release_scope；simulated_reviewer_roles；decision_basis；uncertainty_note；version | 模拟启用、审核/置信/发布状态与审计元数据 |

policy_type 分布为 AFFORDANCE 26、MONITOR 21、HARD_BOUNDARY 14、COMPILATION_BOUNDARY 7；constraint_level 为 ADVISORY 30、SOFT 18、HARD 20；rrmc_signal 为 CONTINUE 54、PAUSE_REPAIR 14。optional_fixture_examples 当前 68 行全部为空，符合“示例不进入运行时”的设计，但意味着工作簿本身没有提供可直接运行的正例夹具。

### 4.5 表5：综合判断、记忆写入与 TEVV（40 字段）

| 字段组 | 全部字段 | 编译含义 |
|---|---|---|
| 身份与路由 | schema_version；record_id；synthesis_policy_id；question_id；scenario_id | 版本、唯一行 ID、政策 ID 和题目/情境路由 |
| 政策定义 | policy_type；policy_name | 综合、记忆、公平或 TEVV 政策类型与名称 |
| 触发与证据依赖 | trigger_conditions；required_evidence_claim_ids；required_capability_ids；min_source_diversity；counterevidence_required | 触发条件、所需表3命题、所需表2能力、最低来源多样性和是否必须处理反证 |
| 确认与结论边界 | teacher_confirmation_required；context_boundary；confidence_band_allowed；max_permitted_claim；prohibited_claim | 教师确认、情境边界、允许置信区间、最大结论和禁止结论 |
| 记忆治理 | memory_type；memory_write_rule；memory_expiry_rule；correction_rule | NONE/EPISODIC 等记忆类型，以及写入、过期和纠正规则 |
| 停止治理 | stop_recommendation；prohibited_stop_condition | 可推荐停止的条件与绝对不可停止的条件 |
| TEVV | tev_case_id；tev_level；tev_method；slice_dimensions；release_gate | 测试用例、层级、方法、切片和发布门 |
| 责任与编译 | owner；runtime_use | 责任方和综合/记忆/TEVV 卡片类型 |
| 来源 | source_kind；source_ref | 来源类型与引用 |
| 共同治理 | active_in_simulation；review_status；content_confidence；release_scope；simulated_reviewer_roles；decision_basis；uncertainty_note；version | 模拟启用、审核/置信/发布状态与审计元数据 |

policy_type 分布为 SYNTHESIS 31、MEMORY_WRITE 17、TEVV 19、FAIRNESS 1；memory_type 为 NONE 51、EPISODIC 17；tev_level 为 L2 49、L3 19。stop_recommendation 当前 68 行全部为空，因此本表只提供“禁止因覆盖完成等理由停止”的负向约束，没有任何正向停止建议。

## 5. 跨表引用关系与实测完整性

| 来源字段 | 目标 | 引用次数 / 不同目标数 | 缺失 | 结论 |
|---|---|---:|---:|---|
| 表1 related_capability_ids | 表2 capability_concept_id | 510 / 11 | 0 | 可解析 |
| 表2 alternative_path_ids | 表2 path_id | 212 / 134 | 0 | 可解析 |
| 表2 related_context_ids | 表1 record_id | 311 / 25 | 0 | 可解析，但不少路径只粗粒度指向场景叙事 |
| 表2 parent_concept_ids | 表2 capability_concept_id | 59 个未解析值 | 59 | 不可直接构图；值混入中文标签而非正式 ID |
| 表3 capability_refs | 表2 capability_concept_id | 83 / 37 | 0 | 可解析 |
| 表3 path_refs | 表2 path_id | 0 / 0 | 0（空集） | 全列为空；所谓通过只是空集真值，未真正校验路径关联 |
| 表4 target_understanding_ids | 表3 understanding_id | 90 / 50 | 0 | 可解析 |
| 表4 target_capability_ids | 表2 capability_concept_id | 105 / 29 | 0 | 可解析 |
| 表5 required_evidence_claim_ids | 表3 evidence_claim_id | 75 / 30 | 0 | 已填写部分可解析 |
| 表5 required_capability_ids | 表2 capability_concept_id | 250 / 35 | 0 | 可解析 |

主链应按以下稳定引用运行：

表1情境记录 → 表2能力概念/路径 → 表3理解与证据命题 → 表4目标理解/能力政策 → 表5证据/能力门禁。

所有 record_id、path_id、understanding_id、evidence_claim_id、dialogue_policy_id、synthesis_policy_id 在各自命名空间内均未发现重复。需要注意，表2的 capability_concept_id 有三套风格：全局 C01-C12、Q01-Q05 的语义化 ID、Q06-Q10 的 CAP-Qxx-nnn。编译器可以把它们当作不透明稳定 ID，但父节点字段必须先统一为同一命名空间，不能靠字符串前缀猜测。

## 6. Q08 端到端具体例子

### 6.1 表1：情境与条件边界

Q08 有 15 条记录：

- T1-Q08-001：场景叙事。
- T1-Q08-002：专业判断焦点。
- T1-Q08-003 至 006：四个前测选项 A-D。
- T1-Q08-007：前测可撤销先验；4 分排序 BCDA，3 分排序 BCAD、BDCA、CBAD、CBDA，B 稳定靠前且 A 多数靠后。
- T1-Q08-008：目标事实——把水引到竹片管道。
- T1-Q08-009：事实——一端高于出水位置，阻碍水流。
- T1-Q08-010：事实——儿童反复调整但未成功；替代解释包括没有观察坡度、只改了连接处等。
- T1-Q08-011：事实——部分儿童兴趣下降、玩水或离开；不能直接解释成能力不足。
- T1-Q08-012：重要未知——教师或儿童是否已经观察到阻塞、坡度和水流。
- T1-Q08-013：条件变体——若出现即时水域/积水安全风险，应先减员、划区或暂停。
- T1-Q08-014：条件变体——若活动即将结束，局部演示、共同完成或约定续玩均可能合理。
- T1-Q08-015：条件变体——若同伴已发现坡度，可优先让同伴解释并由小组验证。

这些记录共同编译成一张 ScenarioBriefCard 和一张 PretestPriorCard。关键点是 T1-Q08-012 的未知项不能被模型自动补全，T1-Q08-013 的安全变体必须能提升硬边界优先级。

### 6.2 表2：五个能力概念、十五条可接受路径

Q08 有 5 个情境能力概念，每个 3 条路径：

1. CAP-Q08-001 把困难机制转为可观察现象：追踪水流；比较坡度/高低；同伴解释并由他人验证。
2. CAP-Q08-002 基于已有尝试和状态判断介入时机：观察下一次调整；轻提示；先处理非认知限制。
3. CAP-Q08-003 最小必要、可升级可退出的分级支架：指出阻塞点；搭建对比装置；局部演示后交还控制权。
4. CAP-Q08-004 观察—假设—单变量尝试—再观察：一次只改一个因素；预测后测试；小组比较方案。
5. CAP-Q08-005 功能性材料与挑战调节：增加支撑/透明连接/高度标记；缩小到一个可见子问题；调整人数、角色和同伴资源。

这 15 行应编译为 15 张 ScenarioCapabilityPathCard，不能合并成唯一标准答案。当前每条路径的 related_context_ids 都只指向 T1-Q08-001，未直接指向 008-015 的具体事实、未知和变体，因此路径条件与细粒度情境之间仍依赖文本匹配或人工规则。

### 6.3 表3：五个理解/证据命题

Q08 的五个命题分别要求教师能够：

1. UND-Q08-001 / Q08-T3-001：识别高度、坡度、阻塞，并转化成可观察线索。
2. UND-Q08-002 / Q08-T3-002：结合既有尝试、兴趣状态和可观察状态决定何时帮助。
3. UND-Q08-003 / Q08-T3-003：采用可升级、可退出的分级支架。
4. UND-Q08-004 / Q08-T3-004：形成观察—假设—单变量改变—比较—修正闭环。
5. UND-Q08-005 / Q08-T3-005：解释材料如何服务支撑、连接、比较和观察，并据此调整。

五条均要求最低 L2，允许 RO0-RO4，最大只支持 SITUATION_SPECIFIC_PATTERN。它们会编译为五张 EvidenceAnchorCard。问题是 path_refs 全为空，Evidence Validator 只能确认“能力概念层面”的证据，不能证明教师的回答究竟体现了表2的哪条路径。

### 6.4 表4：对话政策

Q08 的五条政策是：

- Q08-T4-001：围绕障碍、儿童状态和现实条件的开放探询，目标为 UND-Q08-001/002。
- Q08-T4-002：比较支架剂量和适用条件，目标为 UND-Q08-002/003。
- Q08-T4-003：针对 UND-Q08-003/004 的稀疏探询监测。
- Q08-T4-004：水安全、直接给答案和证据来源的硬边界，目标为 UND-Q08-004/005；需安全门并发出 PAUSE_REPAIR。
- Q08-T4-005：开放性编译基线，目标为 UND-Q08-005。

具体运行例：教师说“我会直接告诉他们把这一端垫高”。Dialogue Agent 可以先使用 Q08-T4-002 比较“轻提示—对比装置—局部演示”三种剂量，并用表1未知项询问教师是否已经观察过儿童的尝试；Evidence Validator 只在教师给出可定位的观察和理由后提升 UND-Q08-002/003 的证据状态。若同时出现积水安全风险，则 Q08-T4-004 和 T1-Q08-013 优先，先处理安全，不能为了保持开放对话继续探询。

### 6.5 表5：综合、记忆与 TEVV

Q08 五条政策为：

- Q08-T5-001：形成单题机制/支架结论，需要 Q08-T3-001 至 003、至少两类来源、反证处理和教师确认；结论上限为情境特定线索。
- Q08-T5-002：名称写“跨情境倾向”，但实际 context_boundary 仍限定本题和本次教师解释，所需证据也与单题政策相同。
- Q08-T5-003：情节记忆写入，要求教师确认、来源跨度和验证，但 required_evidence_claim_ids 为空。
- Q08-T5-004 与 005：两个 TEVV_CASE，ID 不同，但触发、方法和结论文本高度相似，缺少清晰不同的夹具与预期断言。

因此，当前 Q08 的安全可输出结论应类似：“在该引水情境中，教师能够基于坡度/阻塞的可观察线索，选择可升级且可退出的支架。”不能升级为稳定人格或普遍能力断言，也不能因为五个理解都被触及就停止。

## 7. 风险清单与建议

### P0：发布前必须保持失败关闭

1. 全部记录仍是 AI_SIMULATED_REVIEW / SIMULATION_ACTIVE。运行加载器必须拒绝把它们当作生产生效配置；release_scope 与 release_gate 要成为机器可执行门，而不只是元数据。
2. 唯一运行版缺失、版本不匹配或校验失败时不得回退旧五表，否则“唯一运行架构”的决策权会被隐式兼容逻辑破坏。

### P1：会造成错误路由或越权结论

1. 表2 parent_concept_ids 有 59 个未解析值，常见形式如 C02_理解游戏意图与进程、C11_现实压力与价值张力，而正式全局 ID 是 C02、C11。必须归一化并在 QA 中验证父引用。
2. 表3 path_refs 55 行全部为空。现有“引用存在性”检查对空集返回通过，形成假阳性。应要求情境证据命题至少关联一个 path_id，或显式声明 capability_only=true 并给出理由。
3. 表4 policy_type 与 runtime_use 不一致：15 条 MONITOR 被编译为 AFFORDANCE_CARD，另有 6 条 AFFORDANCE 被编译为 MONITOR_CARD。若 runtime_use 是真实编译路由，这会改变监督频率和权限；应建立允许映射矩阵并逐行校验。
4. Q08-T5-002 标称跨情境倾向，却没有第二情境证据要求；不得产出跨情境结论。应加入 cross-context 的独立 evidence_claim/source 要求，或把政策改名为单情境候选倾向。
5. Q08-T5-003 的 required_evidence_claim_ids 为空。即使 memory_write_rule 提到验证，也可能被实现为无锚点写入；应显式绑定允许进入记忆的表3命题。

### P2：语义一致性和测试覆盖不足

1. Q08 硬边界的 freedom_scope 表述包含可延后/拒绝，而 agent_may_decline=false；且 safety_gate_required=true 的政策 owner 仍是 DIALOGUE_AGENT。需要定义“对建议的拒绝”和“对安全边界的强制执行”是否是不同权限，并明确最终门控责任方。
2. 表2 Q08 的 15 条路径仅回指场景叙事 T1-Q08-001，没有指向具体事实、未知和条件变体。建议增加细粒度 related_context_ids，避免靠文本相似度选路径。
3. Q08 两个 TEVV 用例语义高度重复，且表4 optional_fixture_examples 全空。应为每个 TEVV case 增加独立输入夹具、期望状态变化、禁止输出和断言，否则 ID 不同不等于覆盖不同风险。
4. 表5 stop_recommendation 全空。若设计是永不由表内推荐停止，应把这个合同写成显式枚举；若需要正向停止条件，应补充证据饱和、教师意愿、风险和未解决反证等条件，不能只依赖禁止停止。
5. support_anchors 是结构化内容，multi-ID 字段使用分隔列表。编译器需要严格解析、去空格、去重和保序；解析失败不得把整段文本静默交给模型猜测。
6. source_ref 多为内部模拟来源标识，不能等同于外部文献证据或真实教师原话。产品界面与日志应保留来源层级，避免“配置来源”被误呈现为“事实来源”。
7. 当前 QA 未覆盖 parent_concept_ids、path_refs 非空性、policy_type/runtime_use 映射、跨情境政策的最小证据集合，以及记忆政策必须绑定证据命题。这五项应加入确定性校验。

## 8. 建议的编译验收条件

- 五个文件名、schema_version=0.1.0 和表结构必须精确匹配。
- 只加载 active_in_simulation=true 且 release_scope 与目标环境匹配的记录。
- 所有主键唯一；所有非空跨表引用存在；强制引用字段不得以空集逃过校验。
- question_id 与 scenario_id 一致；ALL 只用于全局政策，不得错误落入单题事实卡。
- policy_type、runtime_use、owner、constraint_level、rrmc_signal 通过允许矩阵验证。
- HARD 边界先于 AFFORDANCE；Safety/Permission Gate、Evidence Validator、Memory Governor 和 Synthesis 的权限不可由 Dialogue Agent 提示词覆盖。
- 前测只能影响初始探询顺序或关注点，必须可被后续证据撤销，不能直接写入结论或记忆。
- 对每次卡片选择记录 source record_id、触发原因、版本和最终采用/拒绝结果，支持回放。
- Q08 至少增加以下回归测试：未知信息不可补全；积水风险触发安全优先；同伴已发现坡度时允许同伴解释路径；没有观察到某条路径不能判定能力缺失；单题证据不能升级为跨情境倾向；未绑定证据命题不得写记忆。

## 9. 结论

五表的核心价值不是向 LLM 提供更多文字，也不是预先规定“可谈什么”，而是为自由对话提供情境事实、专业透镜、证据合同、探询可供性和综合边界。当前比较版明确把方向与可见语言交给 Dialogue Agent，把 Evidence 写入与等级上限交给模型外校验器。父概念引用、证据到路径的缺链和政策类型/编译类型错配仍须修复；这些缺口当前只作为验证警告，不能被编译器猜测成新的硬约束。
