"""Build a reversible, compact copy of existing geometry without distant scenery.

Run before split-atlas-sectors.py. The source directory must differ from output.
No raw client assets, point data or texture pixels are edited. Cropped surfaces
retain their source transforms and interpolate source UVs and vertex colors.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

import numpy as np
import shapely
from lib.atlas_scenery import DEFAULT_MARGIN, clip_ground, faces_in_area, keep_instances, protected_area


def texture_names(material):
    vp = material.get('vp') or {}
    return {n for n in [material.get('tex'), material.get('emis'), vp.get('heights'),
                        *(layer.get('tex') for layer in vp.get('layers', []))] if n}


def backdrop_card(mesh, material):
    # Verified client billboard: a four-triangle city panorama, not a building.
    # Match both the mesh and albedo identity; never a broad "background" rule.
    return (bool(re.match(r'^Tarkov_city_background_plane_LOD\d+__', mesh['name']))
            and str(material.get('tex', '')).startswith('Tarkov_city_Background_Plane_D__'))


def ground_surface(mesh, material):
    if re.search(r'terrain|(?:^|_)ground(?:_|\.)', mesh['name'], re.I):
        return True
    # Verified Ground Zero grass planes under SBG_Sandbox_background_01.
    # These use generic plane/background names, but are horizontal ground.
    return (mesh['name'] in {'Plane001__489_54_144.obj', 'Sandbox_Background_01_B_LOD0__489_11_25.obj'}
            and str(material.get('tex', '')).startswith('City_Grass_'))


def untextured_terrain_lod(mesh, material):
    # Verified white strips outside Shoreline / Woods, not ordinary white walls.
    # Keep the match narrow: other textureless materials can be intentional.
    return (mesh['name'] in {'Terrain_Base__25_10_297.obj', 'Terrain_Base__165_4_46.obj'}
            and material.get('sh') == 'Hidden/Terrain/TerrainLodBasePass'
            and not material.get('tex'))


def object_decisions(source, binary, area, sea_ground=frozenset()):
    objects = {}
    cards = set()
    terrain_lods = set()
    for mesh in source['meshes']:
        boxes = np.ndarray((mesh['instances'], 6), '<f4', buffer=binary, offset=mesh['boundsOffset'])
        matrices = np.ndarray((mesh['instances'], 12), '<f4', buffer=binary, offset=mesh['matrixOffset'])
        card = backdrop_card(mesh, source['materials'][mesh['material']])
        terrain_lod = untextured_terrain_lod(mesh, source['materials'][mesh['material']])
        for matrix, box in zip(matrices, boxes):
            key = (mesh['name'], matrix.tobytes())
            if key not in objects:
                objects[key] = box.copy()
            else:
                previous = objects[key]
                previous[:3] = np.minimum(previous[:3], box[:3])
                previous[3:] = np.maximum(previous[3:], box[3:])
            if card:
                cards.add(key)
            if terrain_lod:
                terrain_lods.add(key)
    # Use each object's UNION across its material submeshes. A wall/floor that
    # intersects the protected area keeps the entire object, including its roof.
    mask = keep_instances(np.asarray(list(objects.values())), area)
    return {key: ('untextured-terrain-lod' if key in terrain_lods else 'sea-ground-scenery' if key in sea_ground else 'city-panorama-card' if key in cards else
                  None if keep else 'outside-protected-area')
            for key, keep in zip(objects, mask)}


def face_ranges(indices, start=0):
    values = np.asarray(indices, dtype=np.int64) + start
    if not len(values):
        return []
    cuts = np.r_[0, np.flatnonzero(np.diff(values) != 1) + 1, len(values)]
    return [[int(values[a]), int(values[b - 1]) + 1] for a, b in zip(cuts[:-1], cuts[1:])]


def prune(source_dir, output, site, name, margin=DEFAULT_MARGIN):
    source_dir, output = Path(source_dir).resolve(), Path(output).resolve()
    if source_dir == output:
        raise ValueError('Use a separate staging directory; source is the rollback copy')
    source_path = source_dir / f'{name}-geometry.json'
    source = json.loads(source_path.read_text(encoding='utf-8'))
    if source.get('sceneryCull'):
        raise ValueError('Already pruned: rebuild from the original export to change the policy')
    area, policy = protected_area(site, name, margin)
    with (source_dir / source['binary']).open('rb') as f:
        if hashlib.file_digest(f, 'sha256').hexdigest() != source['sha256']:
            raise ValueError('Source binary hash mismatch')
    output.mkdir(parents=True, exist_ok=True)
    binary = np.memmap(source_dir / source['binary'], dtype=np.uint8, mode='r')
    scene_path = Path(__file__).resolve().parents[1] / 'work/atlas-assets' / ('factory_rework' if name == 'factory' else name) / 'scene.json'
    sea_ground = set()
    if scene_path.exists():
        raw = scene_path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != source['sceneSha256']:
            raise ValueError('Scene metadata does not match the original geometry')
        for row in json.loads(raw)['instances']:
            if row.get('root') == row.get('gameObjectName') == 'sea_ground' and row['mesh'].startswith('Plane__'):
                matrix = np.asarray(row['m'], dtype='<f4').reshape(4, 4)[:3]
                sea_ground.add((row['mesh'], matrix.tobytes()))
        del raw
    decisions = object_decisions(source, binary, area, sea_ground)
    records, removed, cropped = [], [], []
    low, high = np.full(3, np.inf), np.full(3, -np.inf)
    instances = triangles = removed_groups = 0
    target = output / source['binary']
    with target.open('wb') as handle:
        for ordinal, mesh in enumerate(source['meshes']):
            boxes = np.ndarray((mesh['instances'], 6), '<f4', buffer=binary, offset=mesh['boundsOffset'])
            matrices = np.ndarray((mesh['instances'], 12), '<f4', buffer=binary, offset=mesh['matrixOffset'])
            positions = np.ndarray((mesh['vertices'], 3), '<f4', buffer=binary, offset=mesh['positionOffset'])
            uvs = np.ndarray((mesh['vertices'], 2), '<f4', buffer=binary, offset=mesh['uvOffset'])
            paint = np.ndarray((mesh['vertices'], 4), 'u1', buffer=binary, offset=mesh['paintOffset'])
            faces = np.ndarray((mesh['indices'] // 3, 3), '<u4', buffer=binary, offset=mesh['indexOffset'])
            variants = {}
            reasons = [decisions[(mesh['name'], matrix.tobytes())] for matrix in matrices]
            for i, matrix in enumerate(matrices):
                if reasons[i]:
                    continue
                box = boxes[i]
                footprint = shapely.box(float(box[0])-.001, float(box[2])-.001, float(box[3])+.001, float(box[5])+.001)
                selected_faces = None
                clipped_ground = None
                if max(box[3]-box[0], box[5]-box[2]) >= 80 and not shapely.covers(area, footprint):
                    transform = matrix.reshape(3, 4)
                    if ground_surface(mesh, source['materials'][mesh['material']]):
                        clipped_ground = clip_ground(positions, uvs, paint, faces, matrix, area, mesh['sourceFaceStart'])
                        if clipped_ground is None:
                            reasons[i] = 'no-ground-in-protected-area'; continue
                        if len(clipped_ground['wholeFaces']) == len(faces):
                            clipped_ground = None
                    else:
                        world = positions @ transform[:, :3].T + transform[:, 3]
                        mask = faces_in_area(world, faces, area)
                        if not mask.any():
                            reasons[i] = 'no-triangle-in-protected-area'; continue
                        if not mask.all():
                            selected_faces = np.flatnonzero(mask)
                signature = ('ground-' + hashlib.sha256(clipped_ground['positions'].tobytes()+clipped_ground['indices'].tobytes()).hexdigest()[:16]
                             if clipped_ground else 'original' if selected_faces is None else hashlib.sha256(selected_faces.tobytes()).hexdigest()[:16])
                variant = variants.setdefault(signature, {'instances': [], 'faces': selected_faces, 'ground': clipped_ground})
                variant['instances'].append(i)
            for reason in sorted({r for r in reasons if r}):
                excluded = [i for i, value in enumerate(reasons) if value == reason]
                removed.append({'sourceGroup': ordinal, 'name': mesh['name'], 'reason': reason,
                                'instanceIndices': excluded, 'triangles': len(excluded) * mesh['indices'] // 3})
            if not variants:
                removed_groups += 1
            for signature, variant in variants.items():
                selected, selected_faces, ground = variant['instances'], variant['faces'], variant['ground']
                record = dict(mesh)
                record['instances'] = len(selected)
                if ground:
                    vertices = ground['positions']
                    attributes = [('positionOffset', vertices), ('uvOffset', ground['uvs']), ('paintOffset', ground['paint']), ('indexOffset', ground['indices'])]
                    record.update(vertices=len(vertices), indices=len(ground['indices']), cropVariant=signature,
                                  sourceFaceCount=len(ground['indices'])//3, sourceOriginalFaceCount=mesh['sourceFaceCount'],
                                  groundClip={'wholeFaceRanges':face_ranges(ground['wholeFaces'], mesh['sourceFaceStart']),
                                              'boundarySourceFaces':ground['boundarySourceFaces']})
                    new_boxes=[]
                    for i in selected:
                        transform=matrices[i].reshape(3,4)
                        world=vertices @ transform[:,:3].T + transform[:,3]
                        new_boxes.append(np.r_[world.min(axis=0),world.max(axis=0)])
                    new_boxes=np.asarray(new_boxes,dtype='<f4')
                    cropped.append({'sourceGroup':ordinal,'name':mesh['name'],'instanceIndices':selected,'variant':signature,
                                    'groundClip':record['groundClip'],'removedTriangles':(len(faces)-record['indices']//3)*len(selected)})
                elif selected_faces is None:
                    attributes = [('positionOffset', positions), ('uvOffset', uvs), ('paintOffset', paint), ('indexOffset', faces)]
                    new_boxes = boxes[selected]
                else:
                    retained, remapped = np.unique(faces[selected_faces].reshape(-1), return_inverse=True)
                    vertices = positions[retained]
                    attributes = [('positionOffset', vertices), ('uvOffset', uvs[retained]), ('paintOffset', paint[retained]),
                                  ('indexOffset', remapped.astype('<u4'))]
                    record.update(vertices=len(retained), indices=len(remapped), cropVariant=signature,
                                  sourceFaceRanges=face_ranges(selected_faces, mesh['sourceFaceStart']),
                                  sourceFaceCount=len(selected_faces), sourceOriginalFaceCount=mesh['sourceFaceCount'])
                    new_boxes = []
                    for i in selected:
                        transform = matrices[i].reshape(3, 4)
                        world = vertices @ transform[:, :3].T + transform[:, 3]
                        new_boxes.append(np.r_[world.min(axis=0), world.max(axis=0)])
                    new_boxes = np.asarray(new_boxes, dtype='<f4')
                    cropped.append({'sourceGroup': ordinal, 'name': mesh['name'], 'instanceIndices': selected,
                                    'variant': signature, 'retainedFaceRanges': record['sourceFaceRanges'],
                                    'removedTriangles': (len(faces)-len(selected_faces))*len(selected)})
                for attr, values in attributes:
                    record[attr] = handle.tell(); handle.write(values.tobytes())
                record['matrixOffset'] = handle.tell(); handle.write(matrices[selected].tobytes())
                record['boundsOffset'] = handle.tell(); handle.write(new_boxes.tobytes())
                records.append(record)
                low = np.minimum(low, new_boxes[:, :3].min(axis=0))
                high = np.maximum(high, new_boxes[:, 3:].max(axis=0))
                instances += len(selected)
                triangles += len(selected) * record['indices'] // 3
            if ordinal % 3000 == 0:
                print(f'[prune] {name} {ordinal}/{len(source["meshes"])}', flush=True)
    if not records:
        raise ValueError('Refusing to publish an empty map')
    used_materials = sorted({m['material'] for m in records})
    # Keep material IDs stable so unchanged sectors retain their binary hash.
    materials = [m if i in used_materials else {} for i, m in enumerate(source['materials'])]
    names = set().union(*(texture_names(m) for m in materials))
    textures = {k: v for k, v in source['textures'].items() if k in names}
    if names - textures.keys():
        raise ValueError('Missing retained texture')
    for entry in textures.values():
        path = output / entry['file']
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_dir / entry['file'], path)
    with target.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    stats = {**source['stats'], 'exportedInstances': instances, 'meshGroups': len(records),
             'instancedTriangles': triangles, 'bytes': target.stat().st_size,
             'textures': len(textures), 'textureBytes': sum(t['bytes'] for t in textures.values())}
    summary = {**policy, 'sourceGeometrySha256': source['sha256'],
               'removedInstances': source['stats']['exportedInstances'] - instances,
               'removedTriangles': source['stats']['instancedTriangles'] - triangles,
               'removedMeshGroups': removed_groups, 'croppedMeshVariants': len(cropped),
               'removedTrianglesFromCrossingMeshes': sum(c['removedTriangles'] for c in cropped),
               'removedTextures': len(source['textures']) - len(textures),
               'originalStats': source['stats']}
    result = {**source, 'sha256': digest, 'meshes': records, 'materials': materials,
              'textures': textures, 'bounds': {'min': low.tolist(), 'max': high.tolist()},
              'stats': stats, 'sceneryCull': summary}
    (output / source_path.name).write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    (output / 'scenery-cull-audit.json').write_text(json.dumps({'map': name, 'summary': summary,
                'outputGeometrySha256': digest, 'removed': removed, 'cropped': cropped}, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'map': name, 'removedInstances': summary['removedInstances'],
                      'removedTriangles': summary['removedTriangles'], 'stats': stats}), flush=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--source', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--site', default='site')
    p.add_argument('--name', required=True)
    p.add_argument('--margin', type=float, default=DEFAULT_MARGIN)
    args = p.parse_args()
    if not 0 < args.margin <= 500:
        p.error('margin must be in (0, 500] metres')
    prune(args.source, args.out, args.site, args.name, args.margin)
