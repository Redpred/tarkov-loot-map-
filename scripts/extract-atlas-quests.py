"""Extract task service scenes only; preserve the existing geometry and gameplay data."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
from collections import defaultdict

parser = argparse.ArgumentParser()
parser.add_argument('--game-root', required=True)
parser.add_argument('--map', action='append', dest='maps')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
game = Path(args.game_root).resolve() / 'EscapeFromTarkov_Data'
os.environ['EFT_GAME_DATA'] = str(game)
os.environ['EFT_TARKMAP_ROOT'] = str(root / 'work/tarkmap')
os.environ['EFT_GAMEDATA_OFFLINE'] = '1'
atlas = root / 'work/atlas'
sys.path.insert(0, str(atlas / 'extraction/intel'))
import UnityPy

scenes = None
for obj in UnityPy.load(str(game / 'globalgamemanagers')).objects:
    if obj.type.name == 'BuildSettings':
        tree = obj.read_typetree()
        scenes = tree.get('scenes') or tree.get('m_Scenes')
        break
if not scenes:
    raise RuntimeError('No client BuildSettings scenes found')

manifest=json.loads((atlas/'extraction/maps/manifest.json').read_text(encoding='utf-8'))
maps=[(m['id'],m['folder']) for m in manifest['maps'] if m['id'] in (args.maps or ['factory_rework','streets'])]
if args.maps and len(maps)!=len(set(args.maps)):
    raise ValueError('Unknown map')
for map_id, folder in maps:
    levels, seen = [], set()
    for i, scene in enumerate(scenes):
        scene = scene.replace('\\', '/')
        if (f'/Locations/{folder}/' in scene and
                'quests' in Path(scene).stem.lower().split('_') and scene not in seen):
            levels.append(i)
            seen.add(scene)
    # Some raid locations keep their task triggers in the ordinary gameplay
    # scenes. An empty service-scene supplement is valid for those maps.
    sys.argv = ['extract_gamedata.py', map_id]
    spec = importlib.util.spec_from_file_location('quest_extractor', atlas / 'extraction/intel/extract_gamedata.py')
    extractor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extractor)
    sink = defaultdict(list)
    for level in levels:
        extractor.scan_level(level, sink)
    result = {
        'map': map_id, 'levels': levels,
        'scenes': [scenes[i] for i in levels],
        'quest_triggers': sink['quest_triggers'], 'loose_points': sink['loose_points'],
    }
    out = root / 'work/tarkmap/out' / map_id / 'quest-scenes.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    print(f'{map_id}: {len(result["quest_triggers"])} triggers, {len(result["loose_points"])} item points; {out}', flush=True)
