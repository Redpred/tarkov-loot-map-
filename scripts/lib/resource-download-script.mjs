// Self-contained Windows download helper; no Node, account or API token needed.
export function resourceDownloadScript(packs,base) {
  const groups=[...new Set(packs.map(pack=>pack.group))];
  if(!/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[A-Za-z0-9_.-]+\/$/.test(base))throw Error('Invalid resource URL');
  for(const pack of packs)if(!/^[a-z_]+$/.test(pack.group)||!/^resources-[a-z0-9_-]+\.zip$/.test(pack.name)||!/^[a-f0-9]{64}$/.test(pack.sha256)||!Number.isSafeInteger(pack.bytes)||pack.bytes<=0)throw Error('Invalid resource pack');
  return '\uFEFF'+`param(
  [ValidateSet('all',${groups.map(group=>`'${group}'`).join(',')})][string]$Map = 'all',
  [string]$Destination = (Join-Path $PSScriptRoot 'downloaded-resources'),
  [switch]$NoPause
)
$ErrorActionPreference = 'Stop'
$packs = @'
${JSON.stringify(packs)}
'@ | ConvertFrom-Json
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
if ((Get-Item -LiteralPath $Destination).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Choose a normal download folder, not a link.' }
foreach ($pack in $packs) {
  if ($Map -ne 'all' -and $pack.group -ne 'shared' -and $pack.group -ne $Map) { continue }
  $file = Join-Path $Destination $pack.name
  $partial = "$file.partial"
  if (Test-Path -LiteralPath $file) {
    if ((Get-Item -LiteralPath $file).Length -eq $pack.bytes -and (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -eq $pack.sha256) { Write-Host "Verified: $($pack.name)"; continue }
    throw "Existing file differs. Move it aside before retrying: $file"
  }
  $complete = $false
  if (Test-Path -LiteralPath $partial) {
    $item = Get-Item -LiteralPath $partial
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Download is a link: $partial" }
    if ($item.Length -gt $pack.bytes) { throw "Partial file is too large: $partial" }
    $complete = $item.Length -eq $pack.bytes
  }
  if (-not $complete) {
    Write-Host "Downloading: $($pack.name)"
    & curl.exe --fail --location --retry 5 --retry-delay 5 --continue-at - --output $partial ("${base}" + $pack.name)
    if ($LASTEXITCODE -ne 0) { throw 'Download interrupted. Run this script again to resume.' }
  }
  if ((Get-Item -LiteralPath $partial).Length -ne $pack.bytes -or (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $pack.sha256) { throw "Checksum mismatch. Move this partial file aside and retry: $partial" }
  Move-Item -LiteralPath $partial -Destination $file
  Write-Host "Verified: $($pack.name)"
}
Write-Host 'Downloads verified. Close the client and merge map-resources from each ZIP into the installation folder.'
if ($Host.Name -eq 'ConsoleHost' -and -not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
`;
}
