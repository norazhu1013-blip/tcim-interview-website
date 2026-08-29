# 新五表唯一运行源

`source/` 中的五个 Excel 是本机比较版所依据的原始配置副本。应用运行时不直接读取 Excel，而读取：

`web/src/generated/tcim-new-five-tables.runtime.v0.1.json`

JSON 的 `sources[]` 保存每个 Excel 的 SHA-256；五个值已与本目录文件逐一核对一致。`configFingerprint` 标识整套编译结果。

工程规则：

- 不加载旧五表；
- 不在缺失或校验失败时回退旧配置；
- Excel 修改后必须重新编译、运行 `web/scripts/verify-new-five-runtime.mjs`、重新执行全部 Fixture，并生成新的配置指纹；
- 当前 `releaseScope=SIMULATION_ACTIVE`，仅用于研究比较，不得标记为真人专家审定或生产发布。
