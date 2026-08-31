// 把 web 端 TCIM 确定性访谈引擎打包成小程序可用的自包含 CJS 模块。
// 产物：miniprogram/utils/tcim/engine.js —— 内联 engine + tcim/core + tcim/modules + tcim-data，
//      让小程序本机跑与 web 完全相同的确定性访谈（语义层在 wx 下自动降级为 bigram 证据）。
// 单一真源：从 web/src/core/tcim/engine.js + tcim/ 生成，不改任何共享源码，只做构建。
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const entry = path.resolve(repoRoot, 'web/src/core/tcim/engine.js')
const outfile = path.resolve(repoRoot, 'miniprogram/utils/tcim/engine.js')
const esbuild = path.resolve(repoRoot, 'web/node_modules/.bin/esbuild')

if (!existsSync(esbuild)) {
  console.error('缺少 esbuild：先 `cd web && npm install`')
  process.exit(1)
}

console.log('[build_miniprogram_tcim] bundling TCIM engine →', path.relative(repoRoot, outfile))
execFileSync(esbuild, [
  entry,
  '--bundle',
  '--format=cjs',
  '--platform=neutral',
  '--outfile=' + outfile
], { stdio: 'inherit' })
console.log('[build_miniprogram_tcim] done.')
