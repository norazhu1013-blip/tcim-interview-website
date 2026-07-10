/**
 * 把 tools/ 下的共享源文件同步到各云函数目录。
 * 云函数上传时只打包自身目录,共享文件必须物理拷贝,不能相对 require。
 *
 * 分配:
 *   gsyg_selectFinal: advisor_port.js + advisor_norms.js + task_card_builder.js + knowledge.json
 *   gsyg_interviewChat: task_card_builder.js + knowledge.json
 *
 * 运行:node tools/sync_cf.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TOOLS = __dirname;
const CF_ROOT = path.join(__dirname, '..', 'cloudfunctions');

const PLAN = {
  gsyg_selectFinal: ['advisor_port.js', 'advisor_norms.js', 'task_card_builder.js', 'knowledge.json'],
  gsyg_interviewChat: ['task_card_builder.js', 'knowledge.json']
};

for (const [cf, files] of Object.entries(PLAN)) {
  const cfDir = path.join(CF_ROOT, cf);
  if (!fs.existsSync(cfDir)) { console.warn('  skip: no such cloud function dir', cfDir); continue; }
  console.log('→ ' + cf);
  for (const f of files) {
    const src = path.join(TOOLS, f);
    if (!fs.existsSync(src)) { console.warn('    missing source:', src); continue; }
    const dst = path.join(cfDir, f);
    fs.copyFileSync(src, dst);
    const kb = (fs.statSync(dst).size / 1024).toFixed(1);
    console.log('    ' + f + ' → ' + dst + ' (' + kb + ' KB)');
  }
}
console.log('\ndone. 记得在开发者工具里右键各云函数 → 上传并部署 → 云端安装依赖。');
