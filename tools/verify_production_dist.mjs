import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'web', 'dist')

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(target) : [target]
  })
}

if (!fs.existsSync(dist)) throw new Error('web/dist 不存在，请先运行生产构建')

const text = filesUnder(dist)
  .filter((file) => /\.(?:html|css|js|json|txt|map)$/i.test(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

const forbidden = [
  ['回环 IPv4 地址', /127\.0\.0\.1/i],
  ['本机 HTTP(S) 请求地址', /https?:\\?\/\\?\/(?:localhost|127(?:\.\d{1,3}){3})/i],
  ['本机运行数据路径', /\.runtime-data/i],
  ['本机模型配置接口', /\/v1\/model-config/i],
  ['服务端密钥变量名', /(?:KIMI|MOONSHOT|OPENAI)_API_KEY/i],
  ['不安全模型地址开关', /TCIM_DIALOGUE_ALLOW_UNSAFE_PROVIDER_URLS/i],
  ['CommonJS 模块残留', /module\.exports/i]
]

const failures = forbidden.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)
if (failures.length) {
  throw new Error(`生产构建扫描失败：${failures.join('、')}`)
}

const localhostLiterals = text.match(/localhost/gi) || []
if (localhostLiterals.length > 1 || (localhostLiterals.length === 1 && !text.includes('parseHost'))) {
  throw new Error(`生产构建出现 ${localhostLiterals.length} 个未解释的 localhost 常量`)
}

console.log('生产构建安全扫描通过：没有回环请求地址、本机配置接口、服务端密钥变量或 CommonJS 残留。')
if (localhostLiterals.length === 1) {
  console.log('说明：CloudBase 官方登录 SDK 的 URL 标准化器含 1 个 localhost 常量；它不是请求地址，浏览器网络验收仍须确认本机请求为 0。')
}
