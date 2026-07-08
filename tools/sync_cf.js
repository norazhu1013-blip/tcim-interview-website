/**
 * 把 tools/advisor_port.js + tools/advisor_norms.js 同步到云函数目录。
 * 云函数上传时只打包自身目录,共享文件必须物理拷贝,不能相对 require。
 * 运行:node tools/sync_cf.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRCS = ['advisor_port.js', 'advisor_norms.js'];
const CF_DIR = path.join(__dirname, '..', 'cloudfunctions', 'gsyg_selectFinal');

for (const f of SRCS) {
  const src = path.join(__dirname, f);
  const dst = path.join(CF_DIR, f);
  fs.copyFileSync(src, dst);
  const kb = (fs.statSync(dst).size / 1024).toFixed(1);
  console.log(`  ${f} → ${dst} (${kb} KB)`);
}
console.log('done. 记得在开发者工具里右键 gsyg_selectFinal → 上传并部署 → 云端安装依赖。');
