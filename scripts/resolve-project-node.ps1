$node = Get-Command -Name node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $node) { throw '请将全局 Node.js 24.22.1 加入系统 PATH。' }

$version = & $node.Source --version
if ($LASTEXITCODE -ne 0 -or $version -ne 'v24.22.1') {
    throw "项目需要 Node.js 24.22.1。PATH 首个 Node 为 $version（$($node.Source)）。"
}

$node.Source
