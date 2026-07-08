# gsyg_selectFinal · R/P/G 遴选云函数

对应设计文档 §5 的服务端遴选实现。Python advisor 的 Node.js 端口 + 常模化,让端上单教师也能算跨教师百分位。

## 输入 / 输出

**入参**:`{ sessionId }`

**出参**:
```json
{ "ok": true,
  "selection": {
    "final": [{ "id": "Q3", "py_item_id": "Q3", "final_rank": 1, "sources": ["R分·结果偏离","P分·过程异常","G分·结果×过程"], "FES": 96, "RS": 93.3, ... }, ... 3 条 ],
    "routes": { "R": [...], "P": [...], "G": [...] },
    "algo": "advisor_v1",
    "normsVersion": "2026-07-08-45sim",
    "generatedAt": 1782893550555
  },
  "cached": false
}
```

失败:`{ ok:false, error, message }`。错误码:
- `missing_sessionId` / `session_not_found` / `forbidden`(openid 不匹配)
- `incomplete_answers`(缺题)/ `algo_failed` / `algo_incomplete` / `db_read_failed`

## 幂等

同 sessionId 若 `session.selection.algo === 'advisor_v1'` 且 `normsVersion` 匹配当前常模,直接返回缓存。**换常模必须换 version 号,否则老 session 不会重跑。**

## 部署

首次上传:
1. 本机跑 `node tools/sync_cf.js`(把 `tools/advisor_port.js` + `tools/advisor_norms.js` 拷进本目录;每次 `tools/` 改动后都要跑)
2. 微信开发者工具 → 项目根打开 → 右键 `cloudfunctions/gsyg_selectFinal/` → **上传并部署 → 云端安装依赖**
3. 首次调用会因为 `advisor_v1` 缓存机制返回 fresh 结果并写回 `gsyg_sessions.selection`

## 刷新常模

真实数据积累到一定量后重跑:
```
python "DOC/calculate_advisor_rpg_final(1).py" <新导出的 exam_results.csv> <新 logs.csv> -o tools/advisor_ref_output --legacy-csv
node tools/build_norms.js         # 重新生成 tools/advisor_norms.js
node tools/verify_norms_mode.js   # 单教师+常模模式验证
node tools/sync_cf.js             # 同步到本目录
# 修改 tools/build_norms.js 里 norms.version 字符串,让老 session 失效重跑
```
然后微信开发者工具重新上传。

## 题号映射(硬约束)

Python advisor 的 SCORE_CSV/ABILITY_MAP/QUESTION_CONTENT 都用**它自己的题号**,与小程序题号不同(自对合映射):

| 情境 | mp Q# | py Q# |
|---|---|---|
| 篮球架玩水 | 1 | 1 |
| 幼儿频繁求助 | 2 | 4 |
| 区域停留短 | 3 | 6 |
| 未参与小组建构 | 4 | 2 |
| 消防员救火 | 5 | 5 |
| 材料选择无层次 | 6 | 3 |
| 艾莎公主不运动 | 7 | 9 |
| 引水难题未解 | 8 | 10 |
| 飞行棋各走各的 | 9 | 7 |
| 跳绳秩序混乱 | 10 | 8 |

`index.js` 里的 `MP_TO_PY` / `PY_TO_MP` 是唯一映射源。`advisor_port.js` 内部题号保持 Python 语义,不动。

## 对拍(改动后必跑)

```
node tools/verify_align.js          # 批量模式 vs Python 参考输出(6 张表逐位)
node tools/verify_norms_mode.js     # 单教师+常模模式 vs Python
node tools/verify_cf_pipeline.js    # mp session 翻译层 vs Python
```
三个都 exit 0 才能部署。三份都过 = 45 位教师 × 全指标 全部对齐。

## 文件

- `index.js` — wx-server-sdk 入口 + mp↔py 题号翻译 + advisor 调用 + 幂等 + 落库
- `advisor_port.js` — Python advisor 1:1 Node.js 端口(sync 自 `tools/`)
- `advisor_norms.js` — 冷启动常模,当前版本 `2026-07-08-45sim`(sync 自 `tools/`)
- `package.json` — 依赖 wx-server-sdk latest
