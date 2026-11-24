"""Resume local Atlas extraction/export for the requested raid maps."""
import argparse, hashlib, importlib.util, json, os, shutil, subprocess, sys, time
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--game-root',required=True)
parser.add_argument('--client-version',required=True)
parser.add_argument('--maps',default='lighthouse,customs,reserve,interchange,shoreline,woods,terminal,icebreaker,ground_zero,labyrinth,labs,factory_rework,streets')
parser.add_argument('--jobs',type=int,default=3)
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
work=(root/'work').resolve();atlas=work/'atlas';game=Path(args.game_root).resolve()/'EscapeFromTarkov_Data'
assets=(work/'atlas-assets').resolve();intel=(work/'tarkmap').resolve()
for target in [assets,intel]:
    if not target.is_relative_to(work):raise RuntimeError(f'Extraction escaped workspace: {target}')
os.environ.update(EFT_GAME_DATA=str(game),EFT_ASSETS_ROOT=str(assets),EFT_TARKMAP_ROOT=str(intel),EFT_GAMEDATA_OFFLINE='1',PYTHONIOENCODING='utf-8')
# Each 4096px terrain bake already uses four sample workers. Serial tiles
# preserve the exact accumulation order/output and avoid >40 GiB commit peaks.
os.environ.setdefault('EFT_TERRAIN_TILE_JOBS','1')
sys.path.insert(0,str(atlas/'tools'))
import gen_maps
scenes=gen_maps.load_scenes();roster={m.id:m for m in gen_maps.ROSTER if m.playable}
requested=args.maps.split(',')
if any(m not in roster for m in requested):raise ValueError('Unknown or excluded map')
fingerprint=hashlib.sha256((game/'globalgamemanagers').read_bytes()).hexdigest()
extractor_hash=hashlib.sha256((atlas/'extraction/unity/eft_extract_v2.py').read_bytes()).hexdigest()
intel_hash=hashlib.sha256((atlas/'extraction/intel/extract_gamedata.py').read_bytes()).hexdigest()
report_path=work/'all-maps-progress.json'
report=json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {}

def stage(map_id,name,command):
    directory=work/'maps'/map_id;directory.mkdir(parents=True,exist_ok=True)
    print(f'[{map_id}] {name}',flush=True)
    report[map_id]={'stage':name,'clientVersion':args.client_version,'updatedAt':time.time()};report_path.write_text(json.dumps(report,indent=2),encoding='utf-8')
    with (directory/f'{name}.log').open('w',encoding='utf-8') as log:
        result=subprocess.run([str(x) for x in command],cwd=root,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if result.returncode:raise RuntimeError(f'{map_id} {name} failed: {directory/name}.log')

for map_id in requested:
    if shutil.disk_usage(work).free<20*1024**3:raise RuntimeError('Less than 20 GiB free on extraction drive')
    m=roster[map_id];levels=gen_maps.derive_levels(scenes,m.folder)
    if not levels:raise RuntimeError(f'No scenes for {map_id}')
    for directory in [assets/map_id,*assets.glob(map_id+'__p*')]:
        if not directory.resolve().is_relative_to(assets):raise RuntimeError('Invalid Atlas staging path')
    browser_id='factory' if map_id=='factory_rework' else map_id
    metadata=root/'data/atlas'/f'{browser_id}-source.json'
    existing=json.loads(metadata.read_text(encoding='utf-8-sig')) if metadata.exists() else {}
    same=existing.get('clientFingerprint')==fingerprint and existing.get('extractorSha256')==extractor_hash and existing.get('clientVersion')==args.client_version
    csv=','.join(map(str,levels));target=root/'site/data/atlas' if browser_id=='factory' else root/'site/data/atlas'/browser_id
    if not (same and (assets/map_id/'scene.json').exists()):
        stage(map_id,'extract',[sys.executable,'-u',atlas/'extraction/unity/extract_parallel.py','--levels',csv,'--name',map_id,'--jobs',args.jobs])
    if not (same and existing.get('intelSha256')==intel_hash and (intel/'out'/map_id/'gamedata.json').exists()):
        stage(map_id,'gamedata',[sys.executable,'-u',atlas/'extraction/intel/extract_gamedata.py',map_id,f'--levels={csv}'])
    stage(map_id,'quests',[sys.executable,'-u',root/'scripts/extract-atlas-quests.py','--game-root',args.game_root,'--map',map_id])
    metadata.parent.mkdir(parents=True,exist_ok=True)
    if not (same and (target/f'{browser_id}-geometry.json').exists()):
        stage(map_id,'geometry',[sys.executable,'-u',root/'scripts/export-atlas-geometry.py','--atlas',atlas,'--dataset',assets/map_id,'--out',target,'--name',browser_id,'--texture-size','256'])
    if browser_id!='factory' and not (same and (target/f'{browser_id}-sectors.json').exists()):
        stage(map_id,'sectors',[sys.executable,'-u',root/'scripts/split-atlas-sectors.py','--directory',target,'--name',browser_id])
    metadata.write_text(json.dumps({'project':'https://github.com/ConocoFieldsForever/atlas','commit':'5779530d9a45654df0027b6876bc1060e03cef94','clientVersion':args.client_version,'eftBuild':int(args.client_version.split('-')[1]),'clientFingerprint':fingerprint,'extractorSha256':extractor_hash,'intelSha256':intel_hash,'map':map_id,'geometryLevels':levels,'localPatches':['scene-owned-renderer-scope','gamedata-container-identities','keyed-container-variable-id-offset','private-lootable-containers']},indent=2),encoding='utf-8')
    report[map_id]={'stage':'complete','clientVersion':args.client_version,'updatedAt':time.time()};report_path.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(f'[{map_id}] complete',flush=True)
