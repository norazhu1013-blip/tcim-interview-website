'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'local-dialogue-server', 'src');
const targetDir = path.join(root, 'cloudfunctions', 'gsyg_dialogueAgent', 'src');
const files = ['dialogue-agent.js', 'prompts.js', 'providers.js', 'schema.js'];
const checkOnly = process.argv.includes('--check');

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

fs.mkdirSync(targetDir, { recursive: true });
let stale = false;
for (const name of files) {
  const source = path.join(sourceDir, name);
  const target = path.join(targetDir, name);
  if (checkOnly) {
    if (!fs.existsSync(target) || hash(source) !== hash(target)) {
      console.error(`[dialogue-sync] stale: ${name}`);
      stale = true;
    }
  } else {
    fs.copyFileSync(source, target);
    console.log(`[dialogue-sync] copied: ${name}`);
  }
}

if (stale) process.exitCode = 1;
else if (checkOnly) console.log('[dialogue-sync] cloud copy matches frozen local core');
