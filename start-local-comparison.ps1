$ErrorActionPreference = 'Stop'

$tcimRoot = $PSScriptRoot
$serverDir = Join-Path $tcimRoot 'local-dialogue-server'
$serverScript = Join-Path $serverDir 'server.js'
$webDir = Join-Path $tcimRoot 'web'
$runtimeDir = Join-Path $tcimRoot '.local-runtime'
$bundledRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $bundledRoot 'node\bin\node.exe' }
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$pnpmExe = if ($pnpmCommand) { $pnpmCommand.Source } else { Join-Path $bundledRoot 'bin\fallback\pnpm.cmd' }

if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
  throw '未找到 Node.js。请安装 Node.js 18.15 或更高版本，或在 Codex 中再次运行本项目。'
}
try {
  $nodeVersionText = (& $nodeExe --version).Trim().TrimStart('v')
  $nodeVersion = [version]$nodeVersionText
} catch {
  throw '无法读取 Node.js 版本。'
}
if ($nodeVersion -lt [version]'18.15.0') {
  throw "Node.js 版本过低（当前 $nodeVersionText）；本项目至少需要 18.15.0。"
}
if (-not (Test-Path -LiteralPath $pnpmExe -PathType Leaf)) {
  throw '未找到 pnpm，无法准备网页依赖。'
}

$env:Path = "$(Split-Path -Parent $nodeExe);$(Split-Path -Parent $pnpmExe);$env:Path"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$viteEntry = Join-Path $webDir 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteEntry -PathType Leaf)) {
  Write-Host '首次启动：正在按锁定版本准备网页运行组件，请稍候……'
  & $pnpmExe install --dir $webDir --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw '网页运行组件安装失败；请确认 web\pnpm-lock.yaml 与 package.json 一致。' }
}

& $nodeExe (Join-Path $webDir 'scripts\sync-data.mjs')
if ($LASTEXITCODE -ne 0) { throw '题目与情境图片同步失败。' }

function Get-ListeningProcessId([int]$port) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { return [int]$listener.OwningProcess }
  return 0
}

function Test-DialogueService {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 1
    return $health.ok -eq $true -and $health.service -eq 'tcim-local-dialogue-agent' -and $health.schema_version -eq 'dialogue-turn-v2'
  } catch { return $false }
}

function Test-WebService {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300 -and $response.Content -match 'id=["'']app["'']'
  } catch { return $false }
}

$serverPid = Get-ListeningProcessId 8787
if (-not (Test-DialogueService)) {
  if ($serverPid) { throw "端口 8787 已被其他程序占用（PID $serverPid）。" }
  $serverProcess = Start-Process -FilePath $nodeExe -ArgumentList @($serverScript) -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'dialogue-server.log') -RedirectStandardError (Join-Path $runtimeDir 'dialogue-server-error.log') -PassThru
  $serverPid = $serverProcess.Id
}

$webPid = Get-ListeningProcessId 5173
if (-not (Test-WebService)) {
  if ($webPid) { throw "端口 5173 已被其他程序占用（PID $webPid）。" }
  $webProcess = Start-Process -FilePath $nodeExe -ArgumentList @($viteEntry, '--mode', 'comparison', '--host', '127.0.0.1', '--port', '5173') -WorkingDirectory $webDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'web.log') -RedirectStandardError (Join-Path $runtimeDir 'web-error.log') -PassThru
  $webPid = $webProcess.Id
}

for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  if ((Test-DialogueService) -and (Test-WebService)) { break }
  Start-Sleep -Milliseconds 300
}

if (-not (Test-DialogueService)) { throw 'Dialogue Agent 本机服务启动失败，请查看 .local-runtime\dialogue-server-error.log。' }
if (-not (Test-WebService)) { throw '网页启动失败，请查看 .local-runtime\web-error.log。' }

$serverPid = Get-ListeningProcessId 8787
$webPid = Get-ListeningProcessId 5173
if (-not $serverPid -or -not $webPid) { throw '服务已响应，但无法确认监听进程。' }
$record = [ordered]@{
  serverPid = $serverPid
  webPid = $webPid
  serverScript = $serverScript
  viteEntry = $viteEntry
  startedAt = (Get-Date).ToString('o')
  root = $tcimRoot
}
[System.IO.File]::WriteAllText((Join-Path $runtimeDir 'processes.json'), ($record | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))

if ($env:TCIM_NO_BROWSER -ne '1') { Start-Process 'http://127.0.0.1:5173' }
Write-Host 'TCIM 本机比较版已启动：http://127.0.0.1:5173' -ForegroundColor Green
Write-Host '进入访谈情境后可直接选择 Kimi 或 OpenAI；首次使用时在本机页面填写相应 API 密钥，无需重启。'
