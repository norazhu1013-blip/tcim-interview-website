$ErrorActionPreference = 'Stop'

$tcimRoot = $PSScriptRoot
$pidFile = Join-Path $tcimRoot '.local-runtime\processes.json'
if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
  Write-Host '没有找到由本项目记录的运行进程。'
  exit 0
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

function Test-OwnsPort([int]$processId, [int]$port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $processId })
}

$record = Get-Content -Raw -Encoding UTF8 -LiteralPath $pidFile | ConvertFrom-Json
$targets = @(
  [pscustomobject]@{ Role = 'server'; ProcessId = [int]($record.serverPid); Port = 8787; ExpectedPath = [string]($record.serverScript) },
  [pscustomobject]@{ Role = 'web'; ProcessId = [int]($record.webPid); Port = 5173; ExpectedPath = [string]($record.viteEntry) }
)
$unverified = @()
foreach ($target in $targets) {
  if (-not $target.ProcessId) { continue }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($target.ProcessId)" -ErrorAction SilentlyContinue
  if (-not $process) { continue }
  $pathMatches = $target.ExpectedPath -and $process.CommandLine -like "*$($target.ExpectedPath)*"
  $legacyServerMatches = $target.Role -eq 'server' -and (Test-OwnsPort $target.ProcessId $target.Port) -and (Test-DialogueService)
  $legacyWebMatches = $target.Role -eq 'web' -and (Test-OwnsPort $target.ProcessId $target.Port) -and (Test-WebService)
  if (-not ($pathMatches -or $legacyServerMatches -or $legacyWebMatches)) {
    $unverified += "$($target.Role):$($target.ProcessId)"
    continue
  }
  Stop-Process -Id $target.ProcessId -ErrorAction Stop
}

if ($unverified.Count) {
  throw "以下记录无法确认属于本项目，未停止且保留 PID 文件：$($unverified -join ', ')"
}
Remove-Item -LiteralPath $pidFile -Force
Write-Host 'TCIM 本机比较版已停止。' -ForegroundColor Green
