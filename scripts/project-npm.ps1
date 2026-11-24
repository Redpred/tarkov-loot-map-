# Use the project runtime even when an older system Node precedes it in PATH.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root 'work/runtimes/node-v24.22.1-win-x64'
$node = Join-Path $runtime 'node.exe'
if (!(Test-Path -LiteralPath $node)) { throw '缺少项目 Node.js 24.22.1，请按 README.md 将官方 Windows x64 发行包解压至 work/runtimes/node-v24.22.1-win-x64/。' }
$previousPath = $env:PATH
try {
    $env:PATH = $runtime + [IO.Path]::PathSeparator + $env:PATH
    Push-Location -LiteralPath $root
    try { & $node (Join-Path $runtime 'node_modules/npm/bin/npm-cli.js') @args; $code = $LASTEXITCODE }
    finally { Pop-Location }
} finally { $env:PATH = $previousPath }
exit $code
