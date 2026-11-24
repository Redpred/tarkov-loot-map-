param([Parameter(Mandatory=$true)][string]$GameRoot, [int]$Jobs=3)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$gameData=Join-Path (Resolve-Path -LiteralPath $GameRoot).Path 'EscapeFromTarkov_Data'
if (!(Test-Path -LiteralPath (Join-Path $gameData 'globalgamemanagers'))) { throw 'GameRoot must contain EscapeFromTarkov_Data/globalgamemanagers.' }
if (Get-Process -Name EscapeFromTarkov -ErrorAction SilentlyContinue) { throw 'Close EscapeFromTarkov before extracting its assets.' }
Set-Location -LiteralPath $projectRoot
$workspace=Join-Path $projectRoot 'work'
New-Item -ItemType Directory -Path $workspace -Force | Out-Null
$atlasPath=Join-Path $workspace 'atlas'
$pinnedCommit='5779530d9a45654df0027b6876bc1060e03cef94'
if (!(Test-Path -LiteralPath (Join-Path $atlasPath '.git'))) {
  git clone https://github.com/ConocoFieldsForever/atlas.git $atlasPath
  if ($LASTEXITCODE) { throw 'Atlas clone failed.' }
  git -C $atlasPath checkout $pinnedCommit
  if ($LASTEXITCODE) { throw 'Cannot checkout the tested Atlas revision.' }
}
$python=Join-Path $workspace 'atlas-venv/Scripts/python.exe'
$tlsBootstrap=Join-Path $PSScriptRoot 'atlas-python-bootstrap.py'
$node=Join-Path $workspace 'runtimes/node-v24.22.1-win-x64/node.exe'
& $node (Join-Path $PSScriptRoot 'setup-atlas-python.mjs')
if ($LASTEXITCODE) { throw 'Atlas Python initialization failed.' }
& $python $tlsBootstrap -m pip install -r (Join-Path $PSScriptRoot 'requirements-atlas-tls.txt') -r (Join-Path $atlasPath 'extraction/requirements.txt')
if ($LASTEXITCODE) { throw 'Atlas Python dependencies failed.' }
& $python $tlsBootstrap scripts/patch-atlas-extractor.py $atlasPath
if ($LASTEXITCODE) { throw 'Atlas scene ownership patch failed.' }
$env:EFT_GAME_DATA=$gameData
$env:EFT_ASSETS_ROOT=Join-Path $workspace 'atlas-assets'
$env:EFT_TARKMAP_ROOT=Join-Path $workspace 'tarkmap'
$env:PYTHONIOENCODING='utf-8'
# Atlas may clean its own staging directories; confine all derived paths to this project's work/.
foreach($target in @($env:EFT_ASSETS_ROOT,$env:EFT_TARKMAP_ROOT)) {
  if(![IO.Path]::GetFullPath($target).StartsWith([IO.Path]::GetFullPath($workspace)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Extraction target escaped work/.' }
}
$levelJson=& $python $tlsBootstrap (Join-Path $atlasPath 'tools/gen_maps.py') --levels-for Factory_Rework
if ($LASTEXITCODE) { throw 'Scene discovery failed.' }
$levels=$levelJson | ConvertFrom-Json
if (!$levels.Count) { throw 'No Factory_Rework scenes in this client version.' }
$csv=$levels -join ','
& $python -u $tlsBootstrap (Join-Path $atlasPath 'extraction/unity/extract_parallel.py') --levels $csv --name factory_rework --jobs $Jobs
if ($LASTEXITCODE) { throw 'Geometry extraction failed.' }
& $python -u $tlsBootstrap (Join-Path $atlasPath 'extraction/intel/extract_gamedata.py') factory_rework "--levels=$csv"
if ($LASTEXITCODE) { throw 'Gameplay data extraction failed.' }
$version=(Get-Item -LiteralPath (Join-Path $GameRoot 'EscapeFromTarkov.exe')).VersionInfo.ProductVersion
$build=if($version -match '-(\d+)-'){[int]$Matches[1]}else{$null}
$metadata=[ordered]@{project='https://github.com/ConocoFieldsForever/atlas';commit=(git -C $atlasPath rev-parse HEAD);localPatches=@('scene-owned-renderer-scope');extractorSha256=(Get-FileHash -LiteralPath (Join-Path $atlasPath 'extraction/unity/eft_extract_v2.py') -Algorithm SHA256).Hash.ToLower();clientVersion=$version;eftBuild=$build;map='factory_rework';geometryLevels=$levels;extractedAt=(Get-Date).ToUniversalTime().ToString('o')}
New-Item -ItemType Directory -Path data/atlas -Force | Out-Null
$metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath data/atlas/factory-source.json -Encoding utf8
& $node scripts/build-factory.mjs
if ($LASTEXITCODE) { throw 'Loot dataset build failed.' }
& $python $tlsBootstrap scripts/export-atlas-geometry.py --atlas $atlasPath --dataset (Join-Path $env:EFT_ASSETS_ROOT 'factory_rework') --out site/data/atlas
if ($LASTEXITCODE) { throw 'Web geometry export failed.' }
Write-Host 'Complete. Run npm start, then open http://127.0.0.1:4175/factory.html'
