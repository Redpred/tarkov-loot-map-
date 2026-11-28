param([Parameter(Mandatory=$true)][string]$GameRoot, [int]$Jobs=3, [switch]$ExtractOnly)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$gameData=Join-Path (Resolve-Path -LiteralPath $GameRoot).Path 'EscapeFromTarkov_Data'
if (!(Test-Path -LiteralPath (Join-Path $gameData 'globalgamemanagers'))) { throw 'Invalid EFT game directory.' }
if (Get-Process -Name EscapeFromTarkov -ErrorAction SilentlyContinue) { throw 'Close EscapeFromTarkov before extraction.' }
Set-Location -LiteralPath $projectRoot
$workspace=Join-Path $projectRoot 'work'
$atlasPath=Join-Path $workspace 'atlas'
$python=Join-Path $workspace 'atlas-venv/Scripts/python.exe'
$tlsBootstrap=Join-Path $PSScriptRoot 'atlas-python-bootstrap.py'
$node=& (Join-Path $PSScriptRoot 'resolve-project-node.ps1')
& $node (Join-Path $PSScriptRoot 'setup-atlas-python.mjs')
if ($LASTEXITCODE) { throw 'Atlas Python initialization failed.' }
& $python $tlsBootstrap scripts/patch-atlas-extractor.py $atlasPath
if ($LASTEXITCODE) { throw 'Atlas scene ownership patch failed.' }
$env:EFT_GAME_DATA=$gameData
$env:EFT_ASSETS_ROOT=Join-Path $workspace 'atlas-assets'
$env:EFT_TARKMAP_ROOT=Join-Path $workspace 'tarkmap'
$env:EFT_GAMEDATA_OFFLINE='1'
$env:PYTHONIOENCODING='utf-8'
# Validate absolute extraction and staging roots before Atlas cleans or merges them.
foreach($target in @($env:EFT_ASSETS_ROOT,$env:EFT_TARKMAP_ROOT)) {
  if(![IO.Path]::GetFullPath($target).StartsWith([IO.Path]::GetFullPath($workspace)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Extraction target escaped work/.' }
}
$levelJson=& $python $tlsBootstrap (Join-Path $atlasPath 'tools/gen_maps.py') --levels-for City
if ($LASTEXITCODE) { throw 'Scene discovery failed.' }
$levels=[int[]]($levelJson | ConvertFrom-Json)
if (!$levels.Count) { throw 'No City scenes in this client.' }
$csv=$levels -join ','
Write-Host "Extracting Streets: $($levels.Count) scene files; workers=$Jobs"
& $python -u $tlsBootstrap (Join-Path $atlasPath 'extraction/unity/extract_parallel.py') --levels $csv --name streets --jobs $Jobs
if ($LASTEXITCODE) { throw 'Streets geometry extraction failed.' }
& $python -u $tlsBootstrap (Join-Path $atlasPath 'extraction/intel/extract_gamedata.py') streets "--levels=$csv"
if ($LASTEXITCODE) { throw 'Streets gameplay data extraction failed.' }
$version=(Get-Item -LiteralPath (Join-Path $GameRoot 'EscapeFromTarkov.exe')).VersionInfo.ProductVersion
$build=if($version -match '-(\d+)-'){[int]$Matches[1]}else{$null}
$metadata=[ordered]@{project='https://github.com/ConocoFieldsForever/atlas';commit=(git -C $atlasPath rev-parse HEAD);localPatches=@('scene-owned-renderer-scope');extractorSha256=(Get-FileHash -LiteralPath (Join-Path $atlasPath 'extraction/unity/eft_extract_v2.py') -Algorithm SHA256).Hash.ToLower();clientVersion=$version;eftBuild=$build;map='streets';geometryLevels=$levels;extractedAt=(Get-Date).ToUniversalTime().ToString('o')}
$metadata.localPatches+= 'gamedata-container-identities'
$metadata.gamedataExtractorSha256=(Get-FileHash -LiteralPath (Join-Path $atlasPath 'extraction/intel/extract_gamedata.py') -Algorithm SHA256).Hash.ToLower()
New-Item -ItemType Directory -Path data/atlas -Force | Out-Null
$metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath data/atlas/streets-source.json -Encoding utf8
if ($ExtractOnly) { Write-Host 'Streets source extraction complete.'; exit 0 }
& $node scripts/build-factory.mjs --map streets
if ($LASTEXITCODE) { throw 'Streets loot build failed.' }
& $python $tlsBootstrap scripts/export-atlas-geometry.py --atlas $atlasPath --dataset (Join-Path $env:EFT_ASSETS_ROOT 'streets') --out site/data/atlas/streets --name streets --texture-size 256
if ($LASTEXITCODE) { throw 'Streets web geometry export failed.' }
& $python $tlsBootstrap scripts/split-atlas-sectors.py --directory site/data/atlas/streets
if ($LASTEXITCODE) { throw 'Streets sector partition failed.' }
Write-Host 'Complete: http://127.0.0.1:4175/streets.html'
