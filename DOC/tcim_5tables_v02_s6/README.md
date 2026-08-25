# TCIM 5 表源(V0.2 S6 补齐) — 数据生成源

> 本目录是 `tcim/professional_data/game_support/` 的**权威数据源**。
> `python tools/build_tcim_data.py 本目录 tcim/professional_data/game_support` 可复现生成。

## 组成与来源

| 文件 | 角色 | 来源 |
|---|---|---|
| `01_...题目专业本体表...xlsx` | 表1 ontology(含 Qx-S6, 标记 `可选`) | 旧 `DOC/数据表 5个.zip` 原样 |
| `02_...EvidenceSlot证据锚点表...xlsx` | **表2** 锚点 | **S6 补齐 V0.2**(新交付) |
| `03_...前测资料到访谈优先级规则表...xlsx` | 表3 priority | 旧 zip 原样 |
| `04_...谈话动作与限制表...xlsx` | **表4** 谈话动作 | **S6 补齐 V0.2**(新交付) |
| `05_...剪枝与结束规则表...xlsx` | **表5** 剪枝/停止 | **S6 补齐 V0.2**(新交付) |

## 为什么这里混合新旧

研究团队 2026-08-25 交付`S6 补齐`:**表2/表4/表5 替换为 V0.2 版本**(关闭 S6 跨表悬空引用);
表1/表3 未改。本目录把三者混装重命名为生成器期望文件名,使 `build_tcim_data.py` 无需改 `XLSX_FILES`。

## 生成器兼容点

新交付的 xlsx 使用 **sharedStrings(`t="s"`) + 默认命名空间**,与旧表(内联字面量 + `x:` 命名空间)不同。
`build_tcim_data.py` 的 `extract_sheets` 已改为**命名空间无关 + 解析 sharedStrings**,可同时读新旧两版。

## 复现命令

```bash
python tools/build_tcim_data.py DOC/tcim_5tables_v02_s6 tcim/professional_data/game_support
node tools/build_tcim_web_data.mjs   # 重建 web/src/generated/tcim-data.js
```

## S6 语义(V0.2)

- S6 在表1 标记为 **`可选`**(非核心),运行时 `core:false` → **不进入整题最低停止门槛**。
- 表5 为每题的 S6 建显式分支 + 可选停止语义;Q10 的 `Q10-S5~S6` 组合已拆成 S5/S6 两行。
- 表2/表4 各为每题的 S6 建 0-3 级锚点 + 非诱导问法 + 禁用边界。
- 30 个 S6 跨表闭环:表1 的 Qx-S6 能 Join 到表2/4/5,每张目标表恰好 1 条。
