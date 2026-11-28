# Run npm and its child scripts with the supported Node from the system PATH.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = & (Join-Path $PSScriptRoot 'resolve-project-node.ps1')
$nodeDirectory = Split-Path -Parent $node
$npm = Join-Path $nodeDirectory 'node_modules/npm/bin/npm-cli.js'
if (!(Test-Path -LiteralPath $npm -PathType Leaf)) { throw "所选 Node.js 安装目录缺少随附的 npm（$nodeDirectory）。" }
$previousPath = $env:PATH
try {
    $env:PATH = $nodeDirectory + [IO.Path]::PathSeparator + $env:PATH
    Push-Location -LiteralPath $root
    try { & $node $npm @args; $code = $LASTEXITCODE }
    finally { Pop-Location }
} finally { $env:PATH = $previousPath }
exit $code
