import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const webDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(webDir, '..')

function gitCommit() {
  if (process.env.VITE_TCIM_GIT_COMMIT) return process.env.VITE_TCIM_GIT_COMMIT
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return 'unrecorded'
  }
}

export default defineConfig(() => ({
  plugins: [vue()],
  base: './',
  define: {
    __TCIM_GIT_COMMIT__: JSON.stringify(gitCommit()),
    __TCIM_BUILT_AT__: JSON.stringify(process.env.VITE_TCIM_BUILT_AT || new Date().toISOString())
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // engine.js 以 ESM 命名空间导入仓库 tcim/modules/*.js 以及它们 require 的 tcim/core/*.js
    // （如 core/contracts.js：STATE_OWNERS/TABLE_ALIGNMENT 等）。这些全是 CJS 源码。
    // 必须让 @rollup/plugin-commonjs 对**整个 tcim/ 树**做 CJS→ESM 转换，否则 browser 会遇到
    // "module is not defined"（module.exports 残留）。用 include 覆盖 core + modules 两棵子树。
    commonjsOptions: {
      include: [/tcim\/[a-z]+\//, /node_modules/]
    }
  }
}))
