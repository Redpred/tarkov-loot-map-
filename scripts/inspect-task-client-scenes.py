"""Inspect scene-owned task components in a copied client snapshot only.

Produces evidence, not runtime markers. No game installation path is accepted.
"""
import argparse, importlib.util, json, os, struct, sys, hashlib
from pathlib import Path
import numpy as np
import UnityPy

root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--snapshot',default='work/eft-client-snapshots/20261013-task-repair')
parser.add_argument('--plan-only',action='store_true')
parser.add_argument('--maps',default='')
args=parser.parse_args()
snapshot=(root/args.snapshot).resolve()
if not snapshot.is_relative_to(root/'work/eft-client-snapshots'):
    raise ValueError('Only a project client snapshot is permitted')
data=snapshot/'EscapeFromTarkov_Data'
consistency=json.loads((snapshot/'ConsistencyInfo').read_text(encoding='utf-8'))
if consistency['Version']!='1.2.0.0.47965': raise ValueError('Unexpected copied client version')
scenes=json.loads((snapshot/'scenes.json').read_text(encoding='utf-8'))
base=root/'data/tasks/20261013-901f569/raw/eft/maps'
plan={}
for folder in base.iterdir():
    game=json.loads((folder/'gamedata.json').read_text(encoding='utf-8'))
    quest=json.loads((folder/'quest-scenes.json').read_text(encoding='utf-8'))
    levels=set(game['generated_levels']+quest['levels'])
    selected=set(game.get('logic_levels',[])+quest['levels'])
    for lv in levels:
        if any(word in scenes[lv].lower() for word in ['design','script','quests']): selected.add(lv)
    if folder.name=='interchange': selected.add(64)
    plan[folder.name]=sorted(selected)
(snapshot/'scene-plan.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
if args.plan_only:
    print(json.dumps(plan));sys.exit()

os.environ['EFT_GAME_DATA']=str(data)
os.environ['EFT_TARKMAP_ROOT']=str(root/'work/tarkmap')
os.environ['EFT_GAMEDATA_OFFLINE']='1'
sys.argv=['extract_gamedata.py','factory_rework']
spec=importlib.util.spec_from_file_location('decoder',root/'work/atlas/extraction/intel/extract_gamedata.py')
decoder=importlib.util.module_from_spec(spec);spec.loader.exec_module(decoder)
audit=json.loads((root/'work/task-repair-20261013/before-coverage.json').read_text(encoding='utf-8'))
targets={r['id'].strip() for o in audit['objectives'] for r in o['requirements'] if r['type']!='item' and r['id']!='1'}
targets.update(o['objectiveId'] for o in audit['objectives'] if o['status']=='missing')
extra_targets=root/'work/task-repair-20261013/client-event-targets.json'
if extra_targets.exists(): targets.update(json.loads(extra_targets.read_text(encoding='utf-8')))
scripts={}
def script_index(name):
    name=Path(name.replace('\\','/')).name
    if name not in scripts:
        file=data/name
        if not file.exists(): scripts[name]={};return scripts[name]
        env=UnityPy.load(str(file));scripts[name]={o.path_id:o.read_typetree().get('m_ClassName') for o in env.objects if o.type.name=='MonoScript'}
    return scripts[name]

def scan(lv):
    file=data/f'level{lv}'
    if not file.exists(): raise FileNotFoundError(file)
    env=UnityPy.load(str(file))
    sf=next(f for f in env.files.values() if hasattr(f,'objects') and Path(f.name).name==file.name)
    objects=sf.objects
    types={name:{pid:o for pid,o in objects.items() if o.type.name==name} for name in ['GameObject','Transform','BoxCollider','MonoBehaviour','MonoScript']}
    cache={};matrices={}
    def tree(pid):
        if pid not in cache: cache[pid]=objects[pid].read_typetree(check_read=False) if pid in objects else {}
        return cache[pid]
    def vec(d,k,default): return [d.get(k,{}).get(a,b) for a,b in zip('xyz',default)]
    def matrix(pid,stack=None):
        if not pid:return np.eye(4)
        if pid not in matrices:
            stack=set() if stack is None else stack
            if pid in stack:raise ValueError('Transform cycle')
            t=tree(pid);q=[t.get('m_LocalRotation',{}).get(a,b) for a,b in zip('xyzw',[0,0,0,1])]
            local=decoder.trs_mat(vec(t,'m_LocalPosition',[0,0,0]),q,vec(t,'m_LocalScale',[1,1,1]))
            matrices[pid]=matrix(t.get('m_Father',{}).get('m_PathID',0),stack|{pid})@local
        return matrices[pid]
    def active(tid,gid):
        if not tree(gid).get('m_IsActive',True):return False
        parent=tree(tid).get('m_Father',{}).get('m_PathID',0)
        return not parent or active(parent,tree(parent).get('m_GameObject',{}).get('m_PathID',0))
    result=[]
    for pid,obj in types['MonoBehaviour'].items():
        h=tree(pid);s=h.get('m_Script',{});fid=s.get('m_FileID',0);sid=s.get('m_PathID',0)
        cls=script_index(sf.externals[fid-1].path).get(sid) if fid else tree(sid).get('m_ClassName')
        pl=decoder.payload_of(obj,h)
        matches=[]
        for name in targets:
            token=name.encode();needle=struct.pack('<i',len(token))+token
            at=pl.find(needle)
            raw_at=pl.find(token)
            if at>=0:matches.append({'id':name,'payloadOffset':at,'encoding':'length-prefixed'})
            elif raw_at>=0:matches.append({'id':name,'payloadOffset':raw_at,'encoding':'embedded','context':pl[max(0,raw_at-70):raw_at+len(token)+90].decode('utf-8',errors='replace')})
        gid=h.get('m_GameObject',{}).get('m_PathID',0);go=tree(gid)
        if cls not in decoder.QUEST_TRIGGER_CLASSES and cls not in ['TransitPoint','HandlerCompleteQuestCondition'] and not matches and go.get('m_Name','').strip() not in targets:continue
        components=[r.get('component',{}).get('m_PathID') for r in go.get('m_Component',[])]
        tid=next((x for x in components if x in types['Transform']),None)
        if not tid:continue
        mat=matrix(tid);boxes=[tree(x) for x in components if x in types['BoxCollider']]
        box=boxes[0] if boxes else None
        center=vec(box,'m_Center',[0,0,0]) if box else [0,0,0]
        pos=(mat@np.array([*center,1]))[:3]
        outline=[]
        if box:
            size=vec(box,'m_Size',[1,1,1]);x,y,z=center;dx,dy,dz=[v/2 for v in size]
            for p in [[x-dx,y-dy,z-dz],[x+dx,y-dy,z-dz],[x+dx,y-dy,z+dz],[x-dx,y-dy,z+dz]]:outline.append([round(float(v),2) for v in (mat@np.array([*p,1]))[:3]])
        result.append({'level':lv,'scene':scenes[lv],'componentId':pid,'gameObjectId':gid,'name':go.get('m_Name'),'class':cls,'active':active(tid,gid) and bool(h.get('m_Enabled',1)),'position':dict(zip('xyz',[round(float(v),2) for v in pos])),'outline':[dict(zip('xyz',p)) for p in outline],'zoneId':decoder.dec_zone_id(pl) if cls in decoder.QUEST_TRIGGER_CLASSES else None,'matches':matches,'payloadHex':pl.hex()})
    return result

output=root/'work/task-repair-20261013/client-inspection';output.mkdir(parents=True,exist_ok=True)
for map_id,levels in plan.items():
    if args.maps and map_id not in args.maps.split(','):continue
    rows=[]
    for lv in levels:
        rows+=scan(lv)
    (output/f'{map_id}.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'{map_id}: {len(levels)} scenes, {len(rows)} matching components',flush=True)
files=[snapshot/'ConsistencyInfo',snapshot/'EscapeFromTarkov.exe',data/'globalgamemanagers',data/'globalgamemanagers.assets',*(data/f'level{i}' for i in sorted({v for values in plan.values() for v in values}))]
manifest={'sourceDirectory':None,'sourceDirectoryRedacted':True,'snapshotDirectory':snapshot.relative_to(root).as_posix(),'policy':'Raw files copied before all metadata reading, hashing and analysis; only project copies inspected','version':consistency['Version'],'coordinateSystem':'Unity XYZ; no renderer transforms applied','files':[{'path':str(f.relative_to(root)).replace('\\','/'),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in files]}
(output/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
