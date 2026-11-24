"""Atlas scene.json/OBJ -> compact instanced browser geometry, in ORIGINAL Unity coordinates.

Uses Atlas's structural culls, original UVs, material assignments and texture PNGs.
No TRS decomposition, guessed registration or mesh simplification.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict


def unity_vertices(vertices):
    result = np.array(vertices, dtype=np.float32, copy=True)
    result[:, 0] *= -1  # Undo UnityPy's local OBJ X flip exactly ONCE.
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--atlas', required=True)
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--texture-size', type=int, default=512)
    parser.add_argument('--name', default='factory')
    args = parser.parse_args()
    if not args.name.replace('_', '').isalnum():
        parser.error('Map name must contain only letters, digits and underscores')
    atlas, dataset, out = map(Path, (args.atlas, args.dataset, args.out))
    sys.path.insert(0, str(atlas / 'eft_pipeline'))
    from tarkmap_core.culls import Culls
    from tarkmap_core.objio import load_obj, load_vcol
    from assemble_bevy import _TexTest

    scene_path = dataset / 'scene.json'
    scene = json.loads(scene_path.read_text(encoding='utf-8'))
    culls = Culls()
    texture_test = _TexTest(str(dataset))
    kept, report = culls.filter(scene['instances'])
    for row in kept:
        if row.get('kind')=='mesh' and not row.get('wlayer'):
            expected=f"level{row['lv']}"
            if row.get('rendererSource')!=expected:
                raise RuntimeError(f"Scene ownership is unverified for {row['mesh']}; re-extract with scripts/extract-factory.ps1")
    # The extractor already emitted LOD0; retain the lowest available LOD defensively.
    minimum = {}
    for row in kept:
        if row.get('lod'):
            lid = row['lod']['g']
            minimum[lid] = min(minimum.get(lid, 1000), row['lod']['i'])
    groups, materials, material_ids = {}, [], {}
    source_objects = set()
    for row in kept:
        lod = row.get('lod')
        if lod and lod['i'] != minimum[lod['g']]:
            continue
        # Match Atlas's material/proxy culls before grouping instanced geometry.
        start = 0
        for sub in row.get('subs', []):
            n = sub.get('n', -1)
            normal_decal = sub.get('role') == 'decal' and texture_test.albedo_is_normalmap(sub.get('tex'))
            if culls.keep_submesh(sub) and sub.get('role') not in ('glass', 'water') and not normal_decal:
                # Material identity must participate in grouping: instances can reuse a mesh with a different skin.
                material = {k:v for k,v in sub.items() if k != 'n'}
                signature = json.dumps(material, sort_keys=True)
                if signature not in material_ids:
                    material_ids[signature] = len(materials)
                    materials.append(material)
                mid = material_ids[signature]
                groups.setdefault((row['mesh'], start, n, mid), []).append(row)
                source_objects.add(id(row))
            if n < 0:
                break
            start += n

    out.mkdir(parents=True, exist_ok=True)
    binary_path = out / f'{args.name}-geometry.bin'
    records, missing = [], []
    bounds_min, bounds_max = np.full(3, np.inf), np.full(3, -np.inf)
    total_instances = total_triangles = 0
    mesh_cache = OrderedDict()
    with binary_path.open('wb') as target:
        def put(data, dtype):
            array = np.asarray(data, dtype=dtype)
            offset = target.tell()
            target.write(array.tobytes())
            return offset
        # Process all material variants of a mesh together so the bounded cache
        # does not repeatedly parse the same large OBJ across distant instances.
        for number, ((filename, start, length, mid), rows) in enumerate(sorted(groups.items(),key=lambda entry:entry[0][0])):
            if not (dataset / 'meshes' / filename).exists():
                missing.append(filename)
                continue
            if filename not in mesh_cache:
                mesh_cache[filename] = (load_obj(str(dataset), filename), load_vcol(str(dataset), filename))
                if len(mesh_cache)>24: mesh_cache.popitem(last=False)
            else:
                mesh_cache.move_to_end(filename)
            (vertices, uv, faces), vcol = mesh_cache[filename]
            fs = faces[start:] if length < 0 else faces[start:start+length]
            if not len(fs):
                continue
            # Deduplicate vertex/UV PAIRS to preserve UV seams, never merge by position alone.
            pairs, inverse = np.unique(fs.reshape(-1, 2), axis=0, return_inverse=True)
            local = unity_vertices(vertices[pairs[:,0]])
            texcoords = uv[np.clip(pairs[:,1], 0, len(uv)-1)].copy()
            texcoords[pairs[:,1] < 0] = 0
            paint = np.zeros((len(pairs),4), np.float32)
            paint[:,0] = paint[:,3] = 1
            if vcol is not None and len(vcol) == len(vertices):
                paint = vcol[pairs[:,0]]
            indices = inverse.astype(np.uint32)
            lo, hi = local.min(axis=0), local.max(axis=0)
            corners = np.array([[x,y,z,1] for x in (lo[0],hi[0]) for y in (lo[1],hi[1]) for z in (lo[2],hi[2])])
            matrices, boxes = [], []
            for row in rows:
                mat = np.array(row['m'], dtype=np.float32).reshape(4,4)
                world = (corners @ mat.T)[:, :3]
                bmin, bmax = world.min(axis=0), world.max(axis=0)
                # Whole-map geometry is retained; viewport fitting uses loot bounds separately.
                bounds_min = np.minimum(bounds_min, bmin)
                bounds_max = np.maximum(bounds_max, bmax)
                matrices.append(mat[:3].reshape(-1))
                boxes.append(np.r_[bmin, bmax])
            record = {'name':filename,'vertices':len(local),'indices':len(indices),'instances':len(rows),
                      'rendererSources':sorted({row.get('rendererSource',f"level{row['lv']}") for row in rows}),
                      'material':mid,'sourceFaceStart':start,'sourceFaceCount':len(fs)}
            record['positionOffset'] = put(local, '<f4')
            record['uvOffset'] = put(texcoords, '<f4')
            record['paintOffset'] = put(np.rint(np.clip(paint,0,1)*255), 'u1')
            record['indexOffset'] = put(indices, '<u4')
            record['matrixOffset'] = put(matrices, '<f4')
            record['boundsOffset'] = put(boxes, '<f4')
            records.append(record)
            total_instances += len(rows)
            total_triangles += len(indices)//3*len(rows)
            if number % 400 == 0:
                print(f'[geometry] {number}/{len(groups)} mesh groups, {total_instances} instances', flush=True)

    if missing:
        raise RuntimeError(f'Missing {len(missing)} source meshes: {missing[:5]}')

    # Ship only referenced color/mask textures, not the full 3 GB extraction or game normal/spec maps.
    referenced = {}
    for material in materials:
        for key in ('tex','emis'):
            if material.get(key): referenced[material[key]] = 'srgb'
        vp = material.get('vp') or {}
        for layer in vp.get('layers', []):
            if layer.get('tex'): referenced[layer['tex']] = 'srgb'
        if vp.get('heights'): referenced[vp['heights']] = 'linear'
    texture_out = out / 'textures'
    texture_out.mkdir(exist_ok=True)
    def ship_texture(entry):
        name, space = entry
        source = dataset / 'tex' / (name + '.png')
        filename = hashlib.sha256(name.encode()).hexdigest()[:20] + '.webp'
        destination = texture_out / filename
        with Image.open(source) as image:
            original_size = list(image.size)
            image = image.convert('RGBA')
            image.thumbnail((args.texture_size,args.texture_size), Image.Resampling.LANCZOS)
            image.save(destination, format='WEBP', quality=88, method=4, lossless=space=='linear')
            size = list(image.size)
        return name, {'file':'textures/'+filename,'colorSpace':space,'size':size,'sourceSize':original_size,
                      'bytes':destination.stat().st_size,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}
    print(f'[textures] encoding {len(referenced)} referenced textures, max {args.texture_size}px', flush=True)
    with ThreadPoolExecutor(max_workers=6) as workers:
        textures = dict(workers.map(ship_texture, referenced.items()))
    manifest = {'schemaVersion':2,'coordinateSystem':'unity-world-x-y-z','source':'Atlas extracted client geometry',
        'sceneOwnership':'Only renderers owned by the requested level file; external asset prefabs are excluded.',
        'viewerTransform':{'scale':[1,1,-1],'note':'Unity left-handed to Three.js right-handed; applied once to geometry and markers at render time.'},
        'binary':binary_path.name,'sha256':hashlib.file_digest(binary_path.open('rb'),'sha256').hexdigest(),
        'sceneSha256':hashlib.sha256(scene_path.read_bytes()).hexdigest(),
        'bounds':{'min':bounds_min.tolist(),'max':bounds_max.tolist()},
        'stats':{'sourceInstances':len(scene['instances']),'exportedInstances':total_instances,
            'sourceObjects':len(source_objects),'meshGroups':len(records),'instancedTriangles':total_triangles,
            'bytes':binary_path.stat().st_size,'textures':len(textures),'textureBytes':sum(t['bytes'] for t in textures.values())},
        'culls':report,'omittedMaterials':['glass','water'],
        'rendering':'Original geometry, UVs, albedo/tint/cutout/vertex-paint materials. WebP texture copies; simplified lighting, no game shaders.',
        'textureMaxSize':args.texture_size,'uvConvention':'Original Unity UV; Three.js texture flipY=true, ST applied in shader.',
        'meshes':records,'materials':materials,'textures':textures}
    (out / f'{args.name}-geometry.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    print(json.dumps(manifest['stats']), flush=True)


if __name__ == '__main__':
    main()
