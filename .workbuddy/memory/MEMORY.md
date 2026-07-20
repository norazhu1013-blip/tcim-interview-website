# 项目长期笔记 · Situational-AI

## 赋分表（测验 24排列×10题查表）修改文件链
改赋分不是改一个文件，是「改源 → 重生成 → 同步 → 校验 → 部署」一条链。

**权威源（改哪一处）**
- `DOC/calculate_advisor_rpg_final_新题序新赋分.py` 的 `SCORE_CSV` —— 当前权威（2026-07-15 恒等题号迁移后保值重排，py Qn == mp Qn）。
- 旧 `calculate_advisor_rpg_final(1).py` 仅作历史 provenance，勿再作为生成源。

**必须同步/重生成的文件**
1. `tools/advisor_port.js` 的 `SCORE_CSV` 常量（硬编码，被 sync_cf 拷到 `cloudfunctions/gsyg_selectFinal/advisor_port.js`）。
2. `miniprogram/data/scoreTable.js` —— 端上查表（scoring.js 用），由脚本生成。
3. `cloudfunctions/gsyg_selectFinal/advisor_port.js` —— `node tools/sync_cf.js` 从 tools/ 拷贝（勿手改）。
4. `tools/advisor_norms.js` + 云函数副本 —— 常模依赖赋分，需 build_norms.js 重算 + version bump（否则老 session 缓存不重跑）。
5. `tools/advisor_ref_output/` —— 用新 py 重生成参考输出；三份对拍（verify_align / verify_norms_mode / verify_cf_pipeline）必须 exit 0 才能部署。
6. `demo/2_score_table.demo.json` + `demo/demo.html` —— 建议换真实值。
7. `DOC/AI 测评 访谈及报告流程/000 10题赋分.xlsx` —— 若以 py 为源，需回写 xlsx 保证 DOC 四处一致。
8. `数据导入规范.md` / `设计文档.md` / `prototype.html` —— 涉及赋分处同步。

**⚠️ 两个坑（2026-07-15 现状）**
- CLAUDE.md 提到的 `tools/_gen` 生成脚本**此前不存在**；现已补上 `tools/gen_advisor_constants.py`（从新 py 提取 4 常量写回 advisor_port.js）。
- `tools/build_scoreTable_from_py.py` 曾指向**旧的** `(1).py` 且 MAP 为旧错位映射；现已修正指向「新题序新赋分.py」且 MAP 改为恒等(1:1..10:10)。

**另：访谈评分锚点（knowledge.js anchors 5 档）** 是另一条链（build_knowledge.js 生成 knowledge.js → sync 到云函数 knowledge.json），不是测验查表赋分，别混。

## 发布体验版自助程序（2026-07-15 新增）
- 目标：赋分/提示词多次微调后，让学生（非开发者）自助发布小程序**体验版**。
- 核心：`tools/release_experience.js` 一键完成 构建+校验+sync：
  ① `tools/gen_advisor_constants.py` 从 `DOC/calculate_advisor_rpg_final_新题序新赋分.py` 提取 4 常量写回 `tools/advisor_port.js`（补上 CLAUDE.md 所述缺失的 _gen）
  ② 生成 `miniprogram/data/scoreTable.js`（`build_scoreTable_from_py.py`）
  ③ 重算 `tools/advisor_norms.js`（改赋分需加 `--bump-norms`）
  ④ `node tools/sync_cf.js`
  ⑤ 跑三份 verify（必须全过）。
- 学生侧剩余动作（见 `发布体验版SOP.md`）：微信开发者工具上传改动过的云函数 + 上传小程序设为体验版 + 发二维码；回滚用公众平台版本管理。
- 改赋分后 verify 报与 `tools/advisor_ref_output` 不一致时，需开发者先用 Python 参考程序重导参考输出再重跑。
