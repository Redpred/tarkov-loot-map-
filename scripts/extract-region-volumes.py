"""Extract typed region colliders from a versioned project snapshot, never the game.

Outputs evidence only. build-region-volumes.mjs binds it to unchanged runtime IDs.
Unity world XYZ are retained, including full ancestor TRS and collider center.
"""
import argparse
import gc
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys

import numpy as np
import UnityPy

ROOT = Path(__file__).resolve().parent.parent


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', default='work/eft-client-snapshots/20261013-task-repair')
    parser.add_argument('--out', default='work/region-volumes-20261019/extracted')
    parser.add_argument('--maps', default='')
    parser.add_argument('--plan-only', action='store_true')
    args = parser.parse_args()
    snapshot = (ROOT / args.snapshot).resolve()
    if not snapshot.is_relative_to(ROOT / 'work/eft-client-snapshots'):
        raise ValueError('Only a versioned project snapshot is permitted')
    data = snapshot / 'EscapeFromTarkov_Data'
    version = read(snapshot / 'ConsistencyInfo')['Version']
    if version != '1.2.0.0.47965':
        raise ValueError(f'Unexpected copied client version: {version}')
    scenes = read(snapshot / 'scenes.json')
    output = (ROOT / args.out).resolve()
    if not output.is_relative_to(ROOT / 'work'):
        raise ValueError('Write extraction evidence only inside work/')
    output.mkdir(parents=True, exist_ok=True)
    plan = {}
    for file in sorted((ROOT / 'site/data/tasks/maps').glob('*.json')):
        mid = file.stem
        if args.maps and mid not in args.maps.split(','):
            continue
        rows = read(file)['points'] + read(ROOT / f'site/data/{mid}-pois.json')['points']
        # Spawn sphere references are also inventoried in these scenes, but are
        # not assumed to be playable region bounds (often a default 50 m sphere).
        # Only actual zone-bearing POIs determine the requested scene set.
        area_types = {'transit', 'mine', 'sniper_zone', 'quest_visit', 'quest_place', 'quest_beacon', 'quest_zone', 'quest_flare', 'quest_extract'}
        rows = [p for p in rows if p.get('outline') or any(t in area_types or t.startswith('extract_') for t in p.get('poiTypes', []))]
        levels = {p.get('sceneLevel', p.get('sourceEvidence', {}).get('level')) for p in rows}
        levels.discard(None)
        plan[mid] = sorted(levels)
    missing = [lv for lv in sorted({lv for levels in plan.values() for lv in levels}) if not (data / f'level{lv}').exists()]
    if missing:
        raise FileNotFoundError(f'Missing project snapshot scenes: {missing}')
    (output / 'plan.json').write_text(json.dumps(plan, indent=2), encoding='utf-8')
    if args.plan_only:
        print(json.dumps(plan))
        return

    # Reuse the already audited typed component decoders. Import has no extraction
    # side effects; paths are set to copied resources before loading the module.
    os.environ['EFT_GAME_DATA'] = str(data)
    os.environ['EFT_TARKMAP_ROOT'] = str(ROOT / 'work/tarkmap')
    os.environ['EFT_GAMEDATA_OFFLINE'] = '1'
    sys.argv = ['extract_gamedata.py', 'factory_rework']
    decoder_path = ROOT / 'work/atlas/extraction/intel/extract_gamedata.py'
    spec = importlib.util.spec_from_file_location('volume_decoder', decoder_path)
    decoder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(decoder)

    scripts, used_files = {}, {snapshot / 'ConsistencyInfo', snapshot / 'scenes.json', decoder_path}

    def script_index(name):
        name = Path(name.replace('\\', '/')).name
        if name not in scripts:
            file = data / name
            if not file.exists():
                raise FileNotFoundError(f'Missing script source in snapshot: {file}')
            used_files.add(file)
            env = UnityPy.load(str(file))
            scripts[name] = {o.path_id: o.read_typetree().get('m_ClassName') for o in env.objects if o.type.name == 'MonoScript'}
        return scripts[name]

    def scan(lv):
        file = data / f'level{lv}'
        used_files.add(file)
        env = UnityPy.load(str(file))
        sf = next(f for f in env.files.values() if hasattr(f, 'objects') and Path(f.name).name == file.name)
        objects = sf.objects
        cache, matrices, enabled = {}, {}, {}
        relevant = set(decoder.EXFIL_CLASSES) | set(decoder.QUEST_TRIGGER_CLASSES) | {
            'Minefield', 'SniperFiringZone', 'MineDirectional', 'TransitPoint', 'SpawnPointMarker'
        }

        def tree(pid):
            if pid not in cache:
                if pid not in objects:
                    raise ValueError(f'level{lv}: missing local object {pid}')
                cache[pid] = objects[pid].read_typetree(check_read=False)
            return cache[pid]

        def vec(t, k, default):
            return [t.get(k, {}).get(a, b) for a, b in zip('xyz', default)]

        def matrix(pid, stack=()):
            if not pid:
                return np.eye(4)
            if pid not in matrices:
                if pid in stack or len(stack) > 256:
                    raise ValueError('Invalid transform hierarchy')
                t = tree(pid)
                father = t.get('m_Father', {})
                if father.get('m_FileID', 0):
                    raise ValueError('External parent transform is not supported')
                q = [t.get('m_LocalRotation', {}).get(a, b) for a, b in zip('xyzw', (0, 0, 0, 1))]
                local = decoder.trs_mat(vec(t, 'm_LocalPosition', [0, 0, 0]), q, vec(t, 'm_LocalScale', [1, 1, 1]))
                matrices[pid] = matrix(father.get('m_PathID', 0), (*stack, pid)) @ local
            return matrices[pid]

        def active(tid):
            if not tid:
                return True
            if tid not in enabled:
                t = tree(tid)
                enabled[tid] = bool(tree(t['m_GameObject']['m_PathID']).get('m_IsActive', True)) and active(t.get('m_Father', {}).get('m_PathID', 0))
            return enabled[tid]

        def info(gid):
            go = tree(gid)
            components = [(r.get('component', r)).get('m_PathID') for r in go.get('m_Component', [])]
            tid = next((pid for pid in components if pid in objects and objects[pid].type.name in ('Transform', 'RectTransform')), None)
            boxes = [pid for pid in components if pid in objects and objects[pid].type.name == 'BoxCollider']
            return go, tid, boxes

        def point(mat, xyz):
            return [float(v) for v in (mat @ np.array([*xyz, 1]))[:3]]

        def transform_chain(tid):
            chain = []
            while tid:
                t = tree(tid)
                chain.append({'id': tid, 'position': vec(t, 'm_LocalPosition', [0, 0, 0]),
                    'rotation': [t.get('m_LocalRotation', {}).get(a, b) for a, b in zip('xyzw', [0, 0, 0, 1])],
                    'scale': vec(t, 'm_LocalScale', [1, 1, 1])})
                tid = t.get('m_Father', {}).get('m_PathID', 0)
            return list(reversed(chain))

        def box_volume(cid, mid, component_id, gid, cls, relation):
            t = tree(cid)
            center, size = vec(t, 'm_Center', [0, 0, 0]), vec(t, 'm_Size', [1, 1, 1])
            if not all(np.isfinite(size)) or min(abs(v) for v in size) <= 0:
                return None
            mat = matrix(mid)
            corners = [point(mat, [center[i] + signs[i] * size[i] / 2 for i in range(3)]) for signs in
                       [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1), (-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1)]]
            return {'type': 'box', 'corners': corners, 'source': {
                'level': lv, 'componentId': component_id, 'gameObjectId': gid, 'class': cls,
                'colliderId': cid, 'transformId': mid, 'relation': relation,
                'colliderEnabled': bool(t.get('m_Enabled', 1)), 'isTrigger': bool(t.get('m_IsTrigger', False)),
                'localCenter': center, 'localSize': size, 'worldMatrix': mat.tolist(), 'transformChain': transform_chain(mid)
            }}

        records = []
        for pid, obj in objects.items():
            if obj.type.name != 'MonoBehaviour':
                continue
            h = tree(pid)
            s = h.get('m_Script', {})
            fid, sid = s.get('m_FileID', 0), s.get('m_PathID', 0)
            cls = script_index(sf.externals[fid - 1].path).get(sid) if fid else tree(sid).get('m_ClassName') if sid else None
            if cls not in relevant:
                continue
            gid = h['m_GameObject']['m_PathID']
            go, tid, boxes = info(gid)
            if not tid:
                continue
            pl = decoder.payload_of(obj, h)
            name = go.get('m_Name', '')
            source_id = decoder.dec_exfil_name(pl) or name if cls in decoder.EXFIL_CLASSES else decoder.dec_zone_id(pl) or name if cls in decoder.QUEST_TRIGGER_CLASSES else name
            base = {'level': lv, 'scene': scenes[lv], 'componentId': pid, 'gameObjectId': gid, 'class': cls,
                    'sourceId': source_id, 'name': name, 'active': active(tid) and bool(h.get('m_Enabled', 1))}
            pairs = [(cid, tid, 'same-game-object') for cid in boxes]
            if cls == 'MineDirectional':
                # Preserve all child identities. Rounded old footprint-area ties
                # can choose a different child than full-precision area; bind the
                # existing point by its actual center and footprint downstream.
                candidates = []
                for child in tree(tid).get('m_Children', []):
                    if child.get('m_FileID', 0):
                        continue
                    ct = child['m_PathID']
                    _, _, child_boxes = info(tree(ct)['m_GameObject']['m_PathID'])
                    for cid in child_boxes:
                        v = box_volume(cid, ct, pid, gid, cls, 'direct-child-box')
                        if v:
                            points = v['corners'][:4]
                            area = abs(sum(points[i][0] * points[(i + 1) % 4][2] - points[(i + 1) % 4][0] * points[i][2] for i in range(4))) / 2
                            candidates.append((area, cid, ct))
                pairs = [(cid, ct, 'direct-child-box') for _, cid, ct in candidates]
                base['childBoxCandidates'] = len(candidates)
            if cls == 'SpawnPointMarker':
                decoded = decoder.dec_spawn(pl)
                if not decoded:
                    continue
                sid, sname, pos, sides, cats, inf, bz_pid, core, sphere_pid = decoded
                base['sourceId'] = sid or sname or name
                base['position'] = list(pos)
                if sphere_pid and sphere_pid in objects and objects[sphere_pid].type.name == 'SphereCollider':
                    sphere = tree(sphere_pid)
                    sphere_go, sphere_tid, _ = info(sphere['m_GameObject']['m_PathID'])
                    mat = matrix(sphere_tid)
                    scales = np.linalg.norm(mat[:3, :3], axis=0)
                    # Exact engine sphere scaling is unnecessary to infer here:
                    # retain only uniform, orthogonal transforms in the usable set.
                    orthogonal = np.allclose(mat[:3, :3].T @ mat[:3, :3], np.eye(3) * scales[0]**2, atol=1e-5)
                    radius = float(sphere.get('m_Radius', 0)) * float(scales[0])
                    center = point(mat, vec(sphere, 'm_Center', [0, 0, 0]))
                    base['spawnSphere'] = {'type': 'sphere', 'center': center, 'radius': radius,
                        'source': {'level': lv, 'componentId': pid, 'gameObjectId': gid, 'class': cls,
                                   'colliderId': sphere_pid, 'transformId': sphere_tid, 'relation': 'serialized-sphere-pptr',
                                   'uniformScale': bool(orthogonal), 'localRadius': sphere.get('m_Radius'),
                                   'colliderEnabled': bool(sphere.get('m_Enabled', 1)), 'isTrigger': bool(sphere.get('m_IsTrigger', False)),
                                   'worldMatrix': mat.tolist()}}
                records.append(base)
                continue
            if cls not in ('Minefield', 'MineDirectional'):
                pairs = pairs[:1]
            if not pairs:
                records.append({**base, 'position': point(matrix(tid), [0, 0, 0]), 'volumes': []})
            for cid, ct, relation in pairs:
                volume = box_volume(cid, ct, pid, gid, cls, relation)
                center = point(matrix(ct), vec(tree(cid), 'm_Center', [0, 0, 0]))
                records.append({**base, 'position': center, 'volumes': [volume] if volume else []})
        print(f'level{lv}: {len(records)} typed regions', flush=True)
        return records

    by_level = {}
    for lv in sorted({lv for levels in plan.values() for lv in levels}):
        file = output / f'level{lv}.json'
        # Each invocation refreshes only selected scenes, never source snapshots.
        rows = scan(lv)
        file.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        by_level[str(lv)] = {'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file), 'records': len(rows)}
        gc.collect()
    manifest = {'version': 1, 'eftVersion': version, 'eftBuild': 47965, 'coordinateSystem': 'Unity XYZ; no view reflection',
        'snapshot': snapshot.relative_to(ROOT).as_posix(), 'maps': plan, 'levels': by_level,
        'sourceFiles': [{'path': p.relative_to(ROOT).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p)} for p in sorted(used_files)],
        'extractorSha256': digest(Path(__file__))}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Complete: {len(by_level)} copied scenes; {len(used_files)} source fingerprints', flush=True)


if __name__ == '__main__':
    main()
