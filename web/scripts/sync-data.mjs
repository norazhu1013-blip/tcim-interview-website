import { createRequire } from 'node:module'
import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const require = createRequire(import.meta.url)
const outDir = resolve(here, '../src/generated')
const publicDir = resolve(here, '../public/scenarios')

const questions = require(resolve(root, 'miniprogram/data/questions.js'))
const scoreTable = require(resolve(root, 'miniprogram/data/scoreTable.js'))
const indicatorMap = require(resolve(root, 'miniprogram/data/indicatorMap.js'))
const knowledge = require(resolve(root, 'miniprogram/data/knowledge.js'))

await mkdir(outDir, { recursive: true })
await mkdir(publicDir, { recursive: true })

const banner = '// 自动生成：唯一来源为 miniprogram/data/，请勿手工修改。\n'
const body = [
  `export const QUESTIONS_VERSION = ${JSON.stringify(questions.VERSION)};`,
  `export const ITEMS = ${JSON.stringify(questions.ITEMS)};`,
  `export const SCORE_VERSION = ${JSON.stringify(scoreTable.VERSION)};`,
  `export const SCORE_TABLE = ${JSON.stringify(scoreTable.SCORES)};`,
  `export const INDICATOR_VERSION = ${JSON.stringify(indicatorMap.VERSION)};`,
  `export const INDICATOR_MAP = ${JSON.stringify(indicatorMap.MAP)};`,
  `export const KNOWLEDGE_VERSION = ${JSON.stringify(knowledge.VERSION)};`,
  `export const E_NAME = ${JSON.stringify(knowledge.E_NAME)};`,
  `export const SELECTION_RULES = ${JSON.stringify(knowledge.SELECTION_RULES)};`,
  `export const KB = ${JSON.stringify(knowledge.KB)};`,
  ''
].join('\n')
await writeFile(resolve(outDir, 'data.js'), banner + body, 'utf8')

for (const item of questions.ITEMS) {
  await copyFile(
    resolve(root, `miniprogram/images/scenarios/${item.item_id}.jpg`),
    resolve(publicDir, `${item.item_id}.jpg`)
  )
}

console.log(`已同步 ${questions.ITEMS.length} 题、${Object.keys(scoreTable.SCORES).length} 题赋分表与情境图。`)
