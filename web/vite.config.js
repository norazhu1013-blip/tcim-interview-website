import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
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
})
