param([string]$Source = 'work\spt5-source')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$projectRoot=Split-Path -Parent $PSScriptRoot
$checkout=(Resolve-Path (Join-Path $projectRoot $Source)).Path
$commit=(& git -C $checkout rev-parse HEAD).Trim()
$sourceRoot=Join-Path $checkout 'Libraries\SPTushonka.Server.Assets\SPT_Data'
$version=([xml](Get-Content -Raw (Join-Path $checkout 'Build.props'))).Project.PropertyGroup.SptVersion.'#text'
if (!$version) { $version='5.0.0' }
$core=Get-Content -Raw (Join-Path $sourceRoot 'configs\core.json') | ConvertFrom-Json
$destination=Join-Path $projectRoot ("data\spt\5.0.0-"+$commit.Substring(0,7))
$database=Join-Path $destination 'database'
$files=Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'database') -Recurse -File | Where-Object {
    $relative=[IO.Path]::GetRelativePath((Join-Path $sourceRoot 'database'),$_.FullName).Replace('\','/')
    $relative -match '^locations/[^/]+/(looseLoot|staticLoot|staticContainers|staticAmmo|statics|allExtracts|base)\.json$' -or
    $relative -match '^templates/(items|handbook|quests)\.json$' -or $relative -match '^locales/global/(en|ch)\.json$'
}
$plan=@($files | ForEach-Object {
    $relative=[IO.Path]::GetRelativePath((Join-Path $sourceRoot 'database'),$_.FullName)
    $target=[IO.Path]::GetFullPath((Join-Path $database $relative))
    if (!$target.StartsWith($database+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid database target' }
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    $head=if ($_.Length -lt 200) { Get-Content -Raw -LiteralPath $_.FullName } else { '' }
    $pointer=[regex]::Match($head,'oid sha256:([a-f0-9]{64})\s+size (\d+)')
    if ($pointer.Success) {
      [pscustomobject]@{relative=$relative.Replace('\','/');source=$_.FullName;target=$target;oid=$pointer.Groups[1].Value;size=[long]$pointer.Groups[2].Value;lfs=$true}
    } else {
      [pscustomobject]@{relative=$relative.Replace('\','/');source=$_.FullName;target=$target;oid=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower();size=$_.Length;lfs=$false}
    }
})
$objects=@($plan | Where-Object lfs | ForEach-Object { @{oid=$_.oid;size=$_.size} })
$body=@{operation='download';transfers=@('basic');objects=$objects} | ConvertTo-Json -Depth 6
$batch=Invoke-RestMethod 'https://lfs.sp-tushonka.com/sp-tushonka/server-csharp/objects/batch' -Method Post -Body $body -ContentType 'application/vnd.git-lfs+json' -TimeoutSec 30
$urls=@{}
foreach ($object in $batch.objects) {
  if ($object.error) { throw ($object.error | ConvertTo-Json) }
  $uri=[uri]$object.actions.download.href
  if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'lfs.sp-tushonka.com') { throw 'Unexpected LFS host' }
  $urls[$object.oid]=$uri.AbsoluteUri
}
Write-Output "Downloading $($plan.Count) database files ($($objects.Count) LFS objects) at $commit"
$plan | ForEach-Object -Parallel {
  $ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
  $entry=$_;$downloadUrls=$using:urls
  if ((Test-Path -LiteralPath $entry.target) -and (Get-FileHash -LiteralPath $entry.target -Algorithm SHA256).Hash.ToLower() -eq $entry.oid) { return }
  if ($entry.lfs) {
    $tmp=$entry.target+'.partial'
    if ($entry.size -gt 32MB) {
      # Keep large LFS downloads below proxy request-size/time limits.
      $stream=[IO.File]::Open($tmp,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite)
      try {
        $offset=$stream.Length
        if ($offset -gt $entry.size -or ($offset -lt $entry.size -and $offset % 4MB -ne 0)) { $stream.SetLength(0);$offset=0 }
        while ($offset -lt $entry.size) {
          $end=[Math]::Min($entry.size-1,$offset+4MB-1);$chunk=$tmp+'.chunk'
          for($attempt=0;$attempt -lt 3;$attempt++) {
            try {
              $response=Invoke-WebRequest $downloadUrls[$entry.oid] -Headers @{Range="bytes=$offset-$end"} -OutFile $chunk -PassThru -TimeoutSec 60
              if ($response.StatusCode -ne 206 -or ($response.Headers['Content-Range'] -join '') -ne "bytes $offset-$end/$($entry.size)" -or (Get-Item -LiteralPath $chunk).Length -ne $end-$offset+1) { throw 'Invalid ranged response' }
              break
            } catch { if($attempt -eq 2){throw} }
          }
          $bytes=[IO.File]::ReadAllBytes($chunk);$stream.Position=$offset;$stream.Write($bytes,0,$bytes.Length);$stream.Flush();$offset=$end+1
          Write-Output "$($entry.relative): $offset / $($entry.size)"
        }
      } finally { $stream.Dispose() }
    } else { Invoke-WebRequest $downloadUrls[$entry.oid] -OutFile $tmp -TimeoutSec 240 }
    if ((Get-Item -LiteralPath $tmp).Length -ne $entry.size -or (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLower() -ne $entry.oid) { throw "Hash/size mismatch: $($entry.relative)" }
    Move-Item -LiteralPath $tmp -Destination $entry.target -Force
  } else { Copy-Item -LiteralPath $entry.source -Destination $entry.target -Force }
} -ThrottleLimit 4
# Validate every member before publishing a manifest. The active source pointer
# is changed separately, after the schema and map audit has succeeded.
foreach ($entry in $plan) {
  if (!(Test-Path -LiteralPath $entry.target) -or (Get-FileHash -LiteralPath $entry.target -Algorithm SHA256).Hash.ToLower() -ne $entry.oid) { throw "Incomplete database: $($entry.relative)" }
}
Copy-Item -LiteralPath (Join-Path $checkout 'LICENSE') -Destination (Join-Path $destination 'LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $sourceRoot 'configs\core.json') -Destination (Join-Path $destination 'core.json')
$manifest=@{version='5.0.0-dev';channel='5.0x-dev';eftVersion=$core.compatibleTarkovVersion;eftBuild=[int]$core.compatibleTarkovVersion.Split('.')[-1];commit=$commit;repository='https://github.com/SP-Tushonka/server-csharp';retrievedAt=[DateTime]::UtcNow.ToString('o');databasePath=[IO.Path]::GetRelativePath($projectRoot,$database).Replace('\','/');files=@{}}
foreach ($entry in $plan) { $manifest.files[$entry.relative]=@{sha256=$entry.oid;bytes=$entry.size} }
$manifest | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $destination 'source.json') -Encoding utf8
Write-Output "Verified $($plan.Count) database files. Manifest: $destination\source.json"
