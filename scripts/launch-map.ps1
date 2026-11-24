param(
    [ValidateSet('index','streets','factory','customs','woods','shoreline','interchange','reserve','labs','ground_zero','labyrinth','terminal','icebreaker','lighthouse')]
    [string]$Map = 'index',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$siteRoot = Join-Path $projectRoot 'site'
$logDir = Join-Path $projectRoot 'work\launcher'
$baseUrl = 'http://127.0.0.1:4175'
$mutex = $null
$ownsMutex = $false
$page = if ($Map -in @('index','streets','factory')) { "$Map.html" } else { 'map.html' }
$mapQuery = if ($page -eq 'map.html') { "?map=$Map" } else { '' }

function Get-MapService {
    try {
        return Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2 -ErrorAction Stop
    } catch {
        return $null
    }
}

function Test-MapPort {
    $connection = New-Object System.Net.Sockets.TcpClient
    try {
        return ($connection.ConnectAsync('127.0.0.1', 4175).Wait(500) -and $connection.Connected)
    } catch {
        return $false
    } finally {
        $connection.Dispose()
    }
}

function Assert-MapService($service) {
    if ($service.app -ne 'tarkov-loot-map' -or $service.siteRoot -ne $siteRoot) {
        throw '4175 端口被其他服务占用。请关闭占用此端口的程序后再打开地图。'
    }
}

try {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    if (!(Test-Path -LiteralPath (Join-Path $siteRoot $page))) {
        throw '地图页面不存在，请将启动入口和 scripts、site 文件夹保留在同一项目中。'
    }

    # Serialize double clicks so only one background server starts.
    $mutex = New-Object System.Threading.Mutex($false, 'Local\TarkovLootMap-4175')
    try {
        $ownsMutex = $mutex.WaitOne(25000)
    } catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (!$ownsMutex) { throw '另一个地图入口正在启动，请稍后重试。' }

    $service = Get-MapService
    if ($null -ne $service) {
        Assert-MapService $service
    } else {
        if (Test-MapPort) {
            throw '4175 端口已有服务，但不是当前地图服务。若之前用 npm start 启动过旧版本，请先关闭那个终端中的服务。'
        }

        $nodePath = Join-Path $projectRoot 'work/runtimes/node-v24.22.1-win-x64/node.exe'
        if (!(Test-Path -LiteralPath $nodePath)) { throw '未找到项目 Node.js 24.22.1，请按安全修复记录恢复项目运行时。' }

        $serverScript = Join-Path $PSScriptRoot 'serve.mjs'
        # Do not inherit an unrelated PORT override from the caller.
        $env:PORT = '4175'
        $server = Start-Process -FilePath $nodePath -ArgumentList @('"' + $serverScript + '"') `
            -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logDir 'server.log') `
            -RedirectStandardError (Join-Path $logDir 'server-error.log')

        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            $service = Get-MapService
            if ($null -ne $service) { break }
            if ($server.HasExited) {
                throw "地图服务已退出（代码 $($server.ExitCode)），请查看 $logDir\server-error.log。"
            }
            Start-Sleep -Milliseconds 200
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($null -eq $service) { throw "地图服务启动超时，请查看 $logDir\server-error.log。" }
        Assert-MapService $service
    }

    $mutex.ReleaseMutex()
    $ownsMutex = $false
    $url = "$baseUrl/$page$mapQuery"
    if (!$NoBrowser) { Start-Process $url }
    Write-Output "地图已就绪：$url（服务 PID：$($service.pid)）"
} catch {
    $message = "无法打开塔科夫物资地图。`r`n`r`n$($_.Exception.Message)"
    if (Test-Path -LiteralPath $logDir) {
        Add-Content -LiteralPath (Join-Path $logDir 'launcher-error.log') `
            -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message" -Encoding UTF8
    }
    if ($NoBrowser) {
        [Console]::Error.WriteLine($message)
    } else {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show($message, '塔科夫物资地图', 'OK', 'Error') | Out-Null
    }
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
