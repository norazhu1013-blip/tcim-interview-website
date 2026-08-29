'use strict';

const fs = require('fs');

/** 读取本机 .env；只补充尚未存在的进程变量，绝不输出密钥内容。 */
function loadEnvFile(filePath, target = process.env) {
  if (!fs.existsSync(filePath)) return { loaded: false, keys: [] };
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const keys = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (target[key] === undefined || target[key] === '') {
      target[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, keys };
}

module.exports = { loadEnvFile };
