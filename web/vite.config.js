import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // engine.js 以 ESM 命名空间导入仓库 tcim/modules/*.js，这些是 CJS 源码。
    // 必须让 @rollup/plugin-commonjs 对它们做 CJS→ESM 转换，否则 browser 会遇到
    // "module is not defined"（module.exports 残留）。用 include 显式覆盖。
    commonjsOptions: {
      include: [/tcim\/modules\//, /node_modules/]
    }
  }
})
