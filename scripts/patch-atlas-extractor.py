"""Keep only objects owned by the requested Unity scene when dependencies are loaded."""
import sys
from pathlib import Path

def patch_source(source):
    if '# TARKOV_LOOT_MAP_SCENE_SCOPE' in source:
        return source
    start=source.index('    for lv in levels:')
    prefix,body=source[:start],source[start:]
    body=body.replace('env.objects','scene_objects')
    anchor='        env = UnityPy.load(path)\n'
    if body.count(anchor)!=1:
        raise RuntimeError('Unsupported Atlas extractor revision; scene scope anchor changed.')
    body=body.replace(anchor,anchor+'''        # TARKOV_LOOT_MAP_SCENE_SCOPE: shared asset prefabs are not placed scene entities.
        scene_objects = tuple(o for o in env.objects
                              if os.path.basename(o.assets_file.name).lower() == f"level{lv}")
        if not scene_objects:
            raise RuntimeError(f"No scene-owned objects in level{lv}")
''')
    anchor='"lv": lv, "kind": "mesh", "root": root_of(mr.m_GameObject.path_id),'
    if body.count(anchor)!=1:
        raise RuntimeError('Unsupported Atlas extractor revision; provenance anchor changed.')
    body=body.replace(anchor,anchor+'''
                            "rendererSource": o.assets_file.name, "rendererPathId": o.path_id,
                            "gameObjectPathId": mr.m_GameObject.path_id, "gameObjectName": go.m_Name,''')
    return prefix+body


def patch_gamedata(source):
    if '# TARKOV_LOOT_MAP_CONTAINER_IDENTITIES' in source:
        return source
    old='''    sink["containers"] = dedupe(sink["containers"],
                                lambda r: r.get("id") or (r.get("name"), tuple(r["pos"])))'''
    if source.count(old)!=1:
        raise RuntimeError('Unsupported Atlas gameplay extractor; container dedupe changed.')
    return source.replace(old,'''    # TARKOV_LOOT_MAP_CONTAINER_IDENTITIES: retain conflicting positions for join auditing.
    sink["containers"] = dedupe(sink["containers"],
                                lambda r: (r.get("id") or r.get("name"), r.get("template"), tuple(r["pos"])))''')

if __name__=='__main__':
    target=Path(sys.argv[1])/'extraction/unity/eft_extract_v2.py'
    original=target.read_text(encoding='utf-8')
    patched=patch_source(original)
    if patched!=original:
        target.write_text(patched,encoding='utf-8')
        print('Atlas scene ownership patch applied.')
    else: print('Atlas scene ownership patch already present.')
    target=Path(sys.argv[1])/'extraction/intel/extract_gamedata.py'
    original=target.read_text(encoding='utf-8')
    patched=patch_gamedata(original)
    if patched!=original:
        target.write_text(patched,encoding='utf-8')
        print('Atlas container identity patch applied.')
