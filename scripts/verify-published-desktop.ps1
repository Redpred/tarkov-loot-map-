param(
    [Parameter(Mandatory=$true)][string]$Tag,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [ValidateSet('all','install','offline','updates','uninstall')][string]$Phase = 'all'
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Run only on an isolated Windows GitHub Actions runner.' }
if ($Tag -notmatch '^desktop-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$') { throw 'Invalid desktop tag' }
$version = $Matches[1]
if ($ExpectedSha256 -notmatch '^[0-9a-f]{64}$') { throw 'An independently checked installer SHA-256 is required.' }
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$evidence = Join-Path $root 'work/release-acceptance'
$target = [IO.Path]::GetFullPath((Join-Path $evidence 'installed 测试'))
if ($Phase -in @('all','install')) {
    if (Test-Path -LiteralPath $evidence) { throw 'Use a fresh runner checkout.' }
    if (Test-Path -LiteralPath (Join-Path $env:APPDATA 'TarkovLootMap')) { throw 'Existing application settings must not be touched.' }
    $registrations = @(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*TarkovLootMap*' -or $_.DisplayName -like '*塔科夫物资地图*' })
    if ($registrations.Count) { throw 'Existing installation must not be touched.' }
    New-Item -ItemType Directory -Path $evidence | Out-Null
} elseif (!(Test-Path -LiteralPath (Join-Path $evidence 'installation-result.json'))) { throw 'Installation verification must complete first.' }
$base = "https://github.com/Redpred/tarkov-loot-map/releases/download/$Tag"
$name = "TarkovLootMap-$version-win-x64-setup.exe"
$installer = Join-Path $evidence $name
if ($Phase -in @('all','install')) {
    foreach ($file in @($name, 'package-verification.json', 'offline-profile.json')) {
        Invoke-WebRequest -Uri "$base/$file" -OutFile (Join-Path $evidence $file) -MaximumRetryCount 3 -RetryIntervalSec 5
    }
}
$actualHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $ExpectedSha256) { throw 'Downloaded installer checksum differs from the independent expected value.' }
$verification = Get-Content -Raw -LiteralPath (Join-Path $evidence 'package-verification.json') | ConvertFrom-Json
if ($verification.version -ne $version -or $verification.installerSha256 -ne $actualHash) { throw 'Release verification metadata mismatch.' }
$profileFile = Join-Path $evidence 'offline-profile.json'
if ((Get-FileHash -LiteralPath $profileFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $verification.offlineResources.inventorySha256) { throw 'Resource profile checksum mismatch.' }
$profile = Get-Content -Raw -LiteralPath $profileFile | ConvertFrom-Json
function Run-Silent([string]$File, [string]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(1200000)) { throw 'Installer did not complete within twenty minutes.' }
    $process.Refresh()
    if ($process.ExitCode -ne 0) { throw ('Installer failed: ' + $process.ExitCode) }
    if (@(Get-Process TarkovLootMap -ErrorAction SilentlyContinue).Count) { throw 'Silent installer unexpectedly launched the application.' }
}
if ($Phase -in @('all','install')) {
Run-Silent $installer ('/S /currentuser /D=' + $target)
$asar = Join-Path $target 'resources/app.asar'
if ((Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash.ToLowerInvariant() -ne $verification.asarSha256) { throw 'Installed application differs from the verified payload.' }
$verifiedFiles = 0
foreach ($entry in $profile.entries) {
    $file = [IO.Path]::GetFullPath((Join-Path $target $entry.path))
    if (!$file.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe resource path.' }
    $item = Get-Item -LiteralPath $file
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -ne $entry.bytes) { throw ('Installed resource size/type mismatch: ' + $entry.path) }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw ('Installed resource hash mismatch: ' + $entry.path) }
    $verifiedFiles++
}
if ($verifiedFiles -ne $profile.files) { throw 'Incomplete resource inventory.' }
[ordered]@{version=$version;installerSha256=$actualHash;resourceFilesHashed=$verifiedFiles;installedAsarMatched=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'installation-result.json') -Encoding utf8
}
if ($Phase -in @('all','offline')) {
# Software-rendered CI covers whole-map and streamed loading plus shared pages.
# The full 13-map rendering check runs locally; installation hashes every resource.
& node scripts/run-desktop-installed-smoke.mjs '--maps=factory,labyrinth' ('--installed=' + $target) ('--evidence=' + $evidence)
if ($LASTEXITCODE -ne 0) { throw 'Installed offline application check failed.' }
}
if ($Phase -in @('all','updates')) {
& node scripts/run-desktop-installed-smoke.mjs --check-updates ('--installed=' + $target) ('--expected-sha256=' + $ExpectedSha256)
if ($LASTEXITCODE -ne 0) { throw 'Real GitHub updater download check failed.' }
}
if ($Phase -in @('all','uninstall')) {
$installation = Get-Content -Raw -LiteralPath (Join-Path $evidence 'installation-result.json') | ConvertFrom-Json
$offline = Get-Content -Raw -LiteralPath (Join-Path $evidence 'offline-smoke.json') | ConvertFrom-Json
$updates = Get-Content -Raw -LiteralPath (Join-Path $evidence 'remote-updater.json') | ConvertFrom-Json
if ($installation.installerSha256 -ne $actualHash -or $installation.resourceFilesHashed -ne $profile.files -or $offline.resourceNetworkRequests -ne 0 -or $offline.renderedMaps -notcontains 'factory' -or $offline.renderedMaps -notcontains 'labyrinth' -or $updates.downloadedInstallerSha256 -ne $actualHash) { throw 'Incomplete or inconsistent acceptance results.' }
$verifiedFiles = $installation.resourceFilesHashed
$before = @(Get-ChildItem -LiteralPath (Join-Path $target 'map-resources') -File -Recurse | ForEach-Object { [pscustomobject]@{Path=$_.FullName;Length=$_.Length;Ticks=$_.LastWriteTimeUtc.Ticks} })
$uninstallers = @(Get-ChildItem -LiteralPath $target -File -Filter 'Uninstall*.exe')
if ($uninstallers.Count -ne 1 -or !$uninstallers[0].FullName.StartsWith($target + [IO.Path]::DirectorySeparatorChar)) { throw 'Unexpected uninstaller location.' }
Run-Silent $uninstallers[0].FullName '/S /currentuser'
for ($attempt=0; $attempt -lt 100; $attempt++) {
    if (!(Test-Path -LiteralPath (Join-Path $target 'TarkovLootMap.exe'))) { break }
    Start-Sleep -Milliseconds 200
}
if (Test-Path -LiteralPath (Join-Path $target 'TarkovLootMap.exe')) { throw 'Uninstaller did not remove the program.' }
foreach ($entry in $before) {
    $item = Get-Item -LiteralPath $entry.Path
    if ($item.Length -ne $entry.Length -or $item.LastWriteTimeUtc.Ticks -ne $entry.Ticks) { throw 'Uninstall changed resource metadata.' }
}
[ordered]@{
    version=$version;windows=[Environment]::OSVersion.VersionString;anonymousDownload=$true;installerSha256=$actualHash
    independentExpectedHashVerified=$true;silentInstall=$true;unicodeAndSpacesInInstallPath=$true;installedAsarMatched=$true
    resourceFilesHashed=$verifiedFiles;silentUninstall=$true;resourceMetadataRetained=$before.Count
    codeSigningStatus=(Get-AuthenticodeSignature -LiteralPath $installer).Status.ToString()
    nativePickerManuallyVerified=$false;physicalGpuMachineVerified=$false
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidence 'acceptance-result.json') -Encoding utf8
}
