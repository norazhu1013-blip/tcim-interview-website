#!/usr/bin/env node
/**
 * 把 tcim/professional_data/game_support 的 JSON 打包成网页可用的 ES module。
 * 输出：web/src/generated/tcim-data.js（ESM，含 10 题完整专业数据 + common）。
 * 由 `web/scripts/sync-data.mjs` 在构建前调用，或单独运行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')
const srcBase = path.join(repoRoot, 'tcim', 'professional_data', 'game_support')
const outFile = path.join(repoRoot, 'web', 'src', 'generated', 'tcim-data.js')

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function load() {
  const registry = readJson(path.join(srcBase, 'common', 'item_registry.json'))
  const common = {
    ability_framework: readJson(path.join(srcBase, 'common', 'ability_framework.json')),
    item_capability_mapping: readJson(path.join(srcBase, 'common', 'item_capability_mapping.json')),
    empirical_scoring_rules: readJson(path.join(srcBase, 'common', 'empirical_scoring_rules.json'))
  }
  const items = {}
  for (const item of registry.items) {
    const qid = item.item_id
    const dir = path.join(srcBase, 'questions', `q${String(parseInt(qid.slice(1), 10)).padStart(2, '0')}`)
    items[qid] = {
      item_id: qid,
      title: item.title,
      ontology: readJson(path.join(dir, 'ontology.json')),
      anchors: readJson(path.join(dir, 'evidence_anchors.json')),
      priority: readJson(path.join(dir, 'priority_rules.json')),
      probe: readJson(path.join(dir, 'probe_rules.json')),
      stop: readJson(path.join(dir, 'stop_rules.json')),
      metadata: readJson(path.join(dir, 'metadata.json'))
    }
  }
  return { version: registry.version, common, items }
}

const data = load()
const body = `// 本文件由 tools/build_tcim_web_data.mjs 从 tcim/professional_data/game_support 生成。
// 数据源：DOC/数据表 5个.zip（AI 前置打样 V0.1）。请勿手改。
export const TCIM_DATA = ${JSON.stringify(data, null, 2)}
`
fs.writeFileSync(outFile, body, 'utf8')
console.log(`已生成 ${path.relative(repoRoot, outFile)}（${data.items ? Object.keys(data.items).length : 0} 题）`)
