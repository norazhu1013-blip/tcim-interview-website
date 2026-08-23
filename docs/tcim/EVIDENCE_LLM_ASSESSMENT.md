# Evidence 判断改 LLM —— 评估与落地（Step 1：LLM 语义预筛 + 确定性裁决）

> 依据：`DOC/AI应用质疑及说明.zip` 内《TCIM_AI调用与工程责任表_V0.1.docx》(A01/A02 调用点)
> 与《TCIM中的AI作用…》(AI 核心智能定性)。
> 状态：**Step 1 已实现并验证**；**真实 LLM provider 已接好**（含网关+云函数+离线兜底）；
> Step 2/3 待研究团队确认边界后启动。
> 日期：2026-08-23。

---

## 一、问题定性

材料把 TCIM 重新定义成「AI 驱动的专业谈话智能系统」，而非「规则系统外挂大模型」。
其中**最有争议、也最触及现有红线**的一处是**证据判断由谁主导**：

- 现状：`evidence_updater.js` 用**确定性 bigram 覆盖率匹配**(RATE_MIN=0.15 / HITS_MIN=3)，
  从教师原话里直接判出 level / confidence。
- 责任表 A01+A02：**LLM 语义理解 → EvidenceAnalysisProposal → Validator 裁决 → 写 Evidence**。
  A01 被定位为「证明 AI 参与专业判断的核心调用」。

这决定了两者方向不同：现行是「确定性引擎优先、AI 只做表达」，材料是「AI 优先、确定性只做校验」。

## 二、现状盘点（与 A01/A02 的差距）

| 维度 | 现状(规则版) | A01/A02 主张 | 结论 |
|---|---|---|---|
| 判定方式 | 确定性 bigram 覆盖 | LLM 语义抽取→Proposal | **主要差距** |
| 谁理解教师话 | 同义词表+停用词表 | LLM 语义理解 | 差距 |
| 产出 | 直接写 level/confidence | candidate_spans/candidate_slots/conflict_candidates | 需新增 Proposal 层 |
| 冲突判定 | bigram 撞 conflict_evidence 文本 | conflict_candidates 语义判断 | 差距 |
| **状态写入者** | Ontology owner | Ontology owner | ✅ **已符合** |
| 升级必回指 span | ✅ | ✅ (G04) | ✅ |
| 前测只作 prior 不填等级 | ✅ | ✅ | ✅ |
| 允许 NO_CHANGE | ✅ | ✅ | ✅ |
| 不推断能力/动机(G05) | ✅(规则天然做不到) | 需硬性拦截 | ✅ 结构上已防 |

**关键结论**：当前**权属红线(「Ontology 才写 Evidence」「AI 不参与打分」)已严格守住**。
缺的只是**「用 LLM 做语义层」**,而**不是**「用 LLM 写状态」。这一步是同向增量,不是推倒重写。

## 三、Step 1(已实现):LLM 做预测,确定性引擎仍裁决

### 设计边界
- **LLM 只出 Proposal**：`candidate_spans`(回指原话) / `candidate_slots` / `conflict_candidates` /
  `no_change_reasons` / `uncertainty`。**不含** level/confidence 的最终裁决。
- **确定性引擎仍持有裁决权(A02)**：`EvidenceUpdater` 锚点命中 + span 回指 + G04/G05 硬门槛
  照旧。语义信号只作为「观察/线索」透传(`diagnostics` / `replay`),**不改 evidence_state 的 level**。
- **默认离线**：不注入 provider 时,`analyze()` 返回空 Proposal,**行为与未接入完全一致、字节级不变**。
  因此三条确定性基线(720 轮升级=6 / 低能力教师绝不误升 / 冲突检出=0)完整保留。

### 新增/改动文件
| 文件 | 改动 | 说明 |
|---|---|---|
| `tcim/modules/evidence_semantic/evidence_semantic.js` | **新增** | A01 纯函数:`setProvider/analyze/validateProposal/normalizeProposal`。Schema 门(G03)+ G04/G05 拦截。 |
| `tcim/modules/ontology/game_support_ontology.js` | 改动 | `process` 后接 `analyze()`;语义信号并入 `diagnostics`,`decision_summary` 记 `semantic=<provider>`;version → `v0.1.1`。 |
| `web/src/core/tcim/engine.js` | 改动 | 复刻同一 `setSemanticProvider/analyzeSemantic/normalizeSemanticProposal`;语义事件记入 `replay`(SemanticEvent);`processTeacherTurn` 改 async。 |
| `tcim/tests/evidence_semantic.test.js` | **新增** | 离线空 Proposal / Schema 门 / 合法信号透传不改 level / 幻觉 provider 不得抬升低教师。 |
| `web/src/views/InterviewView.vue` | 改动 | `tcimFirstQuestion/tcimNext` 改 async 并 `await processTeacherTurn`。 |
| `web/src/core/tcim/engine.test.mjs` | 改动 | 顶层循环包成 async `run()`,`await processTeacherTurn`。 |

### 真实 LLM provider 落地(Step 1b)
| 文件 | 改动 | 说明 |
|---|---|---|
| `cloudfunctions/gsyg_semanticProbe/` | **新增** | A01 LLM 语义端点:独立云函数。严格 JSON `EvidenceAnalysisProposal`;`LLM_PROFILES`(wxai/openai-compatible);服务端再拦 G04(spans 回指原话)/G05(能力/人格/动机判定词);失败/低置信 → 空 proposal(不丢、不猜)。环境变量集中配置。 |
| `cloudfunctions/gsyg_webGateway/index.js` | 改动 | `ACTIONS` 增 `semanticProbe: 'gsyg_semanticProbe'`。 |
| `web/src/services/semanticLLM.js` | **新增** | `makeSemanticProvider()`:经 `callGateway('semanticProbe',...)` 调云端;任一失败回退空 Proposal(永不抛错);`registerSemanticProvider()` 静态注入引擎(`setSemanticProvider`)。 |
| `web/src/core/tcim/semantic.test.mjs` | **新增** | 离线无 SemanticEvent / 合法 provider 入 replay 不改 level / 幻觉 span 不入 replay / provider 抛错回退。 |

### 真实 LLM provider 请求链路(已验证 build + 逻辑,未实调云端)
```
教师原话 → engine.analyzeSemantic → semanticLLM.makeSemanticProvider
         → callGateway('semanticProbe', { itemId, teacherTurn, anchors, evidenceSummary, questionTitle })
         → gsyg_webGateway /call (已验证会话 Cookie + __gsygGateway 注入)
         → gsyg_semanticProbe.main → 解析严格 JSON → validate(G04/G05) → 空/合法 proposal
         → 回传 → engine 归一化 → SemanticEvent 入 replay → 确定性 EvidenceUpdater 裁决 level
```
**红线不变**:语义 provider 永不写 evidence_state、永不判 level;level 只由 `updateEvidence` 锚点命中决定。
**未实调云端的原因**:本开发环境无 LLM API Key,且网关需上传部署。逻辑经 web build + `semantic.test.mjs` 验证;
真实调用需配置 `DEEPSEEK_API_KEY`/`WXAI_*` 等环境变量并部署 `gsyg_semanticProbe` + 网关。

### 关键红线守护(G04/G05 在语义层强制)
- `validateProposal`/`normalizeSemanticProposal` 要求每条 `candidate_spans[].text` **必须回指教师原话**,
  否则整条 Proposal 降级为空(不信任越界内容)。
- 正则拦截 `能力/人格/动机/心理/性格/智力水平/属于高(中|低)能力` 判定词,命中即降级。
- **即便 provider 确实输出合法 span,确定性 `assessSlot` 的锚点命中才是升级的充分条件**;
  语义信号永远**不能**单独抬高 level。测试 5 用「幻觉 provider」验证低能力教师绝不误升。

### 语义信号去哪里了(不产生状态回路)
- Node:`result.diagnostics` 追加 `{ reason: 'semantic_span'|'semantic_conflict_candidate'|'semantic_no_change', ... }`,
  前缀不命中 stress 的 `anchor_level_/conflict` 统计。
- Web:`session.replay` 追加 `SemanticEvent`(type span/conflict_candidate/no_change/invalid),供审计。
- **均不写** `ontology_state` / `core.action_plan` / `prdm.dialogue_state` —— 所有权矩阵不变。

## 四、验证结果(全部通过)
```
ontology:        Task 3 passed
stress_regression: 升级=6 冲突=0 泄露=0 过早Stop=0  low教师=0   (基线未变)
orchestration:   Task 4 passed
contracts:       Task 0 passed
rag:             Task 5 passed
evidence_semantic: passed (离线空/ Schema门/ 透传不改level/ 幻觉不抬低教师)
web engine smoke:  10/10 题通过
web semantic.test: passed (离线无事件/ 合法入replay不改level/ 幻觉不入replay/ 抛错回退)
web build:         OK (Vite)
```

## 五、从 Step 1 到完整 A01/A02 的路线(供团队拍板)

- **Step 1(已完成)**:LLM 语义预筛(Proposal)+ 确定性裁决。低风险,红线不破。
- **Step 2(可选)**:把 `assessSlot` 升级为「bigram 覆盖 + LLM 语义置信度」合成指标,输出完整
  `EvidenceUpdateProposal`(Schema),写权仍在 Ontology,G04 硬门槛不变。此时`升级=6`变为`6+c(语义增益)`。
- **Step 3(最重,需研究团队确认)**:完整迁移 A01/A02 语义主导 + A09 语义约束复核。**会重定义
  「计分与筛题是确定性程序、AI 不参与打分」这条红线与 `scoring.js` 的关系**,必须先对齐边界。

### Step 2/3 前置条件(阻塞,本阶段已解 Step 1b,仍待团队确认边界)
> Step 1b 已把真实 LLM provider 接好:`gsyg_semanticProbe`(后端端点)+ `semanticLLM.js`(前端注入)
> + 网关白名单。**但只在逻辑/构建层验证过,尚未实调云端**——本开发环境无 LLM API Key,云函数
> 也需上传部署。真正生效还需:
> 1. 配置语义端点环境变量:`SEMANTIC_PROFILE`/`DEEPSEEK_API_KEY`/`WXAI_*` 视所选 provider 而定;网关配 `GSYG_WEB_GATEWAY_TOKEN`、`GSYG_WEB_SESSION_SECRET`。
> 2. 部署 `gsyg_semanticProbe`(云端安装依赖)+ 重传 `gsyg_webGateway`(白名单)+ 重建网页。
> 3. 内容安全审核(合规硬门槛③)——语义层默认关闭 `SEC_CHECK`,仅传回 span 文本,如需可开。

## 六、待办 / 未决
- [ ] 研究团队确认 Step 1 边界是否符合预期(推理层 AI、材料层确定性)。若接受,保持现状。
- [ ] 是否推进 Step 2(合成评级)或直接 Step 3(语义主导)——需先明确是否松动「AI 不参与打分」红线。
- [ ] 若接真实 LLM:补给 `gsyg_webGateway` 语义端点 + 权限门 + 审计(G02)。
