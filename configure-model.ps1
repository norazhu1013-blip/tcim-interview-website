$ErrorActionPreference = 'Stop'

$tcimRoot = $PSScriptRoot
$envPath = Join-Path $tcimRoot 'local-dialogue-server\.env'

function Read-EnvMap([string]$path) {
  $result = [ordered]@{}
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $result }
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line -split '=', 2
    $result[$parts[0].Trim()] = $parts[1]
  }
  return $result
}

function Read-SecretText([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Ensure-Default([System.Collections.IDictionary]$map, [string]$name, [string]$value) {
  if (-not $map.Contains($name)) { $map[$name] = $value }
}

$settings = Read-EnvMap $envPath
Ensure-Default $settings 'TCIM_DIALOGUE_PROVIDER' ''
Ensure-Default $settings 'TCIM_DIALOGUE_HOST' '127.0.0.1'
Ensure-Default $settings 'TCIM_DIALOGUE_PORT' '8787'
Ensure-Default $settings 'TCIM_DIALOGUE_TIMEOUT_MS' '45000'
Ensure-Default $settings 'TCIM_DIALOGUE_MAX_HISTORY_TURNS' '40'
Ensure-Default $settings 'KIMI_API_KEY' ''
Ensure-Default $settings 'MOONSHOT_API_KEY' ''
Ensure-Default $settings 'KIMI_BASE_URL' 'https://api.moonshot.cn/v1'
Ensure-Default $settings 'KIMI_MODEL' 'kimi-k3'
Ensure-Default $settings 'KIMI_REASONING_EFFORT' 'high'
Ensure-Default $settings 'KIMI_MAX_COMPLETION_TOKENS' '4000'
Ensure-Default $settings 'OPENAI_API_KEY' ''
Ensure-Default $settings 'OPENAI_BASE_URL' 'https://api.openai.com/v1'
Ensure-Default $settings 'OPENAI_MODEL' 'gpt-5.6-sol'
Ensure-Default $settings 'OPENAI_REASONING_EFFORT' 'high'
Ensure-Default $settings 'OPENAI_MAX_OUTPUT_TOKENS' '4000'

Write-Host ''
Write-Host 'TCIM 本机比较版：选择 Dialogue Agent 模型' -ForegroundColor Cyan
Write-Host '1. Kimi K3（兼容第一版 MOONSHOT_API_KEY）'
Write-Host '2. OpenAI'
Write-Host '3. 自动选择（有 Kimi 密钥先用 Kimi，否则用 OpenAI）'
Write-Host '4. 仅工程演示（mock；不能计入正式比较数据）'
Write-Host '5. 取消'
$choice = (Read-Host '请输入 1—5').Trim()

switch ($choice) {
  '1' {
    $secret = Read-SecretText '请粘贴 Kimi API 密钥（输入过程不会显示）'
    if (-not $secret) { throw 'Kimi API 密钥不能为空。' }
    $settings['MOONSHOT_API_KEY'] = $secret
    $settings['TCIM_DIALOGUE_PROVIDER'] = 'kimi'
  }
  '2' {
    $secret = Read-SecretText '请粘贴 OpenAI API 密钥（输入过程不会显示）'
    if (-not $secret) { throw 'OpenAI API 密钥不能为空。' }
    $settings['OPENAI_API_KEY'] = $secret
    $settings['TCIM_DIALOGUE_PROVIDER'] = 'openai'
  }
  '3' { $settings['TCIM_DIALOGUE_PROVIDER'] = '' }
  '4' { $settings['TCIM_DIALOGUE_PROVIDER'] = 'mock' }
  '5' {
    Write-Host '已取消，原配置没有改变。'
    exit 0
  }
  default { throw '选择无效。' }
}

$orderedKeys = @(
  'TCIM_DIALOGUE_PROVIDER',
  'TCIM_DIALOGUE_HOST', 'TCIM_DIALOGUE_PORT', 'TCIM_DIALOGUE_TIMEOUT_MS',
  'TCIM_DIALOGUE_MAX_HISTORY_TURNS',
  'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_BASE_URL', 'KIMI_MODEL',
  'KIMI_REASONING_EFFORT', 'KIMI_MAX_COMPLETION_TOKENS',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL',
  'OPENAI_REASONING_EFFORT', 'OPENAI_MAX_OUTPUT_TOKENS'
)
$lines = foreach ($key in $orderedKeys) { "$key=$($settings[$key])" }
$lines += foreach ($key in $settings.Keys) {
  if ($orderedKeys -notcontains $key) { "$key=$($settings[$key])" }
}
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $envPath)) | Out-Null
[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))

Write-Host ''
Write-Host '模型配置已安全保存到本机；密钥不会进入网页或 Git。' -ForegroundColor Green
Write-Host '请双击“停止本机比较版”，再双击“启动本机比较版”使配置生效。'
