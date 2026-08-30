$ErrorActionPreference = 'Stop'

$tcimRoot = $PSScriptRoot
$webDir = Join-Path $tcimRoot 'web'
$releaseDir = Join-Path $tcimRoot '.local-release'
$bundledRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $bundledRoot 'node\bin\node.exe' }
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$pnpmExe = if ($pnpmCommand) { $pnpmCommand.Source } else { Join-Path $bundledRoot 'bin\fallback\pnpm.cmd' }

if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { throw 'Node.js was not found.' }
if (-not (Test-Path -LiteralPath $pnpmExe -PathType Leaf)) { throw 'pnpm was not found.' }
$env:Path = "$(Split-Path -Parent $nodeExe);$(Split-Path -Parent $pnpmExe);$env:Path"

$viteEntry = Join-Path $webDir 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteEntry -PathType Leaf)) {
  Write-Host 'Preparing locked web dependencies for the first local release...'
  & $pnpmExe install --dir $webDir --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Web dependency installation failed.' }
}

Write-Host 'Running the complete pre-release verification...'
& $pnpmExe --dir $webDir run verify
if ($LASTEXITCODE -ne 0) { throw 'Pre-release verification failed; the current release was not replaced.' }

Write-Host 'Building the local production web release...'
& $pnpmExe --dir $webDir run build:comparison
if ($LASTEXITCODE -ne 0) { throw 'Local production build failed.' }

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$runtime = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $webDir 'src\generated\tcim-new-five-tables.runtime.v0.2.json') | ConvertFrom-Json
$commit = (& git -C $tcimRoot rev-parse --short HEAD 2>$null)
if (-not $commit) { $commit = 'unavailable' }
$manifest = [ordered]@{
  product = 'TCIM Dialogue Agent Comparison - Local Release'
  releaseMode = 'LOCAL_RESEARCH_COMPARISON'
  builtAt = (Get-Date).ToString('o')
  gitCommit = $commit.Trim()
  runtimeDatasetId = $runtime.datasetId
  runtimeSchemaVersion = $runtime.schemaVersion
  configFingerprint = $runtime.configFingerprint
  webRoot = (Join-Path $webDir 'dist')
  dialogueService = 'http://127.0.0.1:8787'
  webUrl = 'http://127.0.0.1:5173'
}
[System.IO.File]::WriteAllText((Join-Path $releaseDir 'release.json'), ($manifest | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
Write-Host 'TCIM local release created.' -ForegroundColor Green
Write-Host "Git commit: $($manifest.gitCommit)"
Write-Host "Config fingerprint: $($manifest.configFingerprint)"
