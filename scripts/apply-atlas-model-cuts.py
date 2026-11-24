"""Apply reviewed local cuts to a freshly reproduced scenery baseline in staging.

Never overwrite inputs. A factory selection carries the exact reviewed geometry
hash; an icebreaker ellipse targets only the verified outdoor snow terrain.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import shapely
from lib.atlas_volume_clip import classify_box, clip_lineage, clip_surface, prism_planes
from lib.atlas_cut_history import verified_history
from lib.atlas_cut_restore import restore_recipe, ensure_only_restores

GROUND = 'Snow_terrain_LOD0__699_2_799.obj'


def digest(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def read_arrays(mesh, binary):
    return {key: np.ndarray(shape, dtype, buffer=binary, offset=mesh[offset]) for key, shape, dtype, offset in [
        ('positions', (mesh['vertices'], 3), '<f4', 'positionOffset'),
        ('uvs', (mesh['vertices'], 2), '<f4', 'uvOffset'),
        ('paint', (mesh['vertices'], 4), 'u1', 'paintOffset'),
        ('faces', (mesh['indices'] // 3, 3), '<u4', 'indexOffset'),
        ('matrices', (mesh['instances'], 12), '<f4', 'matrixOffset'),
        ('boxes', (mesh['instances'], 6), '<f4', 'boundsOffset')]}


def ship_ellipse(source, binary, margin=5):
    """Axis-aligned minimum-area enclosing ellipse over the actual ship footprint.

    Gather exact transformed vertices, reduce to a convex hull, then encompass
    its 5 m buffer. Fit the two radii numerically without changing ship models.
    """
    hulls = []
    for mesh in source['meshes']:
        if mesh['name'] == GROUND:
            continue
        arrays = read_arrays(mesh, binary)
        positions = arrays['positions'].astype(float)
        for matrices in np.array_split(arrays['matrices'], max(1, (mesh['instances'] + 63) // 64)):
            transform = matrices.reshape(-1, 3, 4).astype(float)
            world = np.einsum('vj,mkj->mvk', positions, transform[:, :, :3]) + transform[:, None, :, 3]
            hull = shapely.convex_hull(shapely.multipoints(world[:, :, [0, 2]].reshape(-1, 2)))
            if not hull.is_empty:
                hulls.append(hull)
    hull = shapely.convex_hull(shapely.union_all(hulls))
    # Extra 2 cm covers polygon approximation and float32 output round-off.
    buffered = hull.buffer(margin + .02, quad_segs=64)
    points = np.asarray(buffered.exterior.coords)[:-1]
    center = (np.min(points, axis=0) + np.max(points, axis=0)) / 2
    relative = np.abs(points - center)
    half = relative.max(axis=0)
    best = None
    for rz in np.linspace(half[1] * 1.001, half[1] * 2, 4000):
        rx = np.max(relative[:, 0] / np.sqrt(1 - (relative[:, 1] / rz) ** 2))
        if best is None or rx * rz < best[0]:
            best = (rx * rz, rx, rz)
    # A circumscribed 256-gon encloses the fitted ellipse, not an inscribed cut.
    count = 256
    radii = np.asarray(best[1:]) / np.cos(np.pi / count)
    theta = np.arange(count) * (2 * np.pi / count)
    polygon = np.column_stack([np.cos(theta), np.sin(theta)]) * radii + center
    area = shapely.Polygon(polygon)
    if not area.covers(buffered):
        raise ValueError('Ellipse does not enclose the complete ship margin')
    return {
        'schemaVersion': 1, 'map': 'icebreaker', 'coordinateSystem': 'unity-world-xyz',
        'operation': 'keep-ground-inside-ellipse', 'targetMeshes': [GROUND],
        'sourceGeometrySha256': source['sha256'], 'sceneSha256': source['sceneSha256'],
        'marginMetres': margin, 'minimumMeasuredClearanceMetres': float(hull.distance(area.boundary)),
        'centerXZ': center.tolist(), 'radiiXZ': list(best[1:]), 'segments': count,
        'shipFootprintBoundsXZ': list(hull.bounds), 'shipHullXZ': list(map(list, hull.exterior.coords)),
        'polygon': [{'x': float(x), 'z': float(z)} for x, z in polygon],
        'evidence': 'Only Snow_terrain_LOD0 under SBG_Icebreaker_Outdoor is clipped. All other retained ship parts stay byte-identical; the ellipse encloses their exact world vertices plus 5 m.'}


def apply(source_dir, output, name, selection=None, ground_source=None, reviewed_current=None, previous_selection=None, restoration_plan=None):
    source_dir, output = Path(source_dir).resolve(), Path(output).resolve()
    if source_dir == output or source_dir in output.parents or output.exists():
        raise ValueError('Use a new independent staging directory')
    manifest_path = source_dir / f'{name}-geometry.json'
    source = json.loads(manifest_path.read_bytes())
    if source.get('manualCull'):
        raise ValueError('Already manually clipped; rebuild from the raw export')
    if digest(source_dir / source['binary']) != source['sha256']:
        raise ValueError('Input geometry SHA-256 mismatch')
    binary = np.memmap(source_dir / source['binary'], dtype='u1', mode='r')
    effective = reviewed = None
    if name == 'factory':
        raw_selection = Path(selection).read_bytes()
        policy = json.loads(raw_selection)
        if policy['map'] != name or policy['coordinateSystem'] != 'unity-world-xyz':
            raise ValueError('Wrong map or coordinate system')
        if reviewed_current and previous_selection:
            effective, reviewed = verified_history(source, policy, reviewed_current, previous_selection)
        elif reviewed_current or previous_selection:
            raise ValueError('Both the reviewed current geometry and previous selection are required')
        elif policy['source']['geometrySha256'] != source['sha256'] or policy['source']['sceneSha256'] != source['sceneSha256']:
            raise ValueError('Selection was saved against a different source')
        if not policy['exclusions']:
            raise ValueError('No saved exclusions')
        if restoration_plan:
            if not effective:
                raise ValueError('Restoration requires verified applied history')
            effective = restore_recipe(effective, policy, json.loads(Path(restoration_plan).read_bytes()))
            ensure_only_restores(json.loads(Path(previous_selection).read_bytes())['exclusions'], effective['exclusions'])
        cuts = effective['exclusions'] if effective else policy['exclusions']
        volumes = [prism_planes(cut['volume']['polygon'], cut['volume']['minY'], cut['volume']['maxY']) for cut in cuts]
        for cut in policy['exclusions']:
            if cut['operation'] != 'review-and-prune-intersecting-geometry':
                raise ValueError('Unsupported cut operation')
        selection_sha = hashlib.sha256(raw_selection).hexdigest()
    elif name == 'icebreaker':
        matches = [m for m in source['meshes'] if m['name'] == GROUND]
        if len(matches) != 1 or matches[0]['instances'] != 1 or source['materials'][matches[0]['material']].get('tex') != 'Snow_decal_line_D__sharedassets699_72':
            raise ValueError('Verified ground identity changed')
        policy = ship_ellipse(source, binary)
        # Recut the untouched snow plane, rather than intersecting with the old
        # irregular scenery footprint (which would leave flat spots on the oval).
        ground_dir = Path(ground_source).resolve()
        ground_manifest = json.loads((ground_dir / f'{name}-geometry.json').read_bytes())
        if ground_manifest.get('sceneryCull') or ground_manifest['sceneSha256'] != source['sceneSha256']:
            raise ValueError('Ground must come from the matching untouched export')
        if digest(ground_dir / ground_manifest['binary']) != ground_manifest['sha256']:
            raise ValueError('Original ground geometry SHA-256 mismatch')
        ground_binary = np.memmap(ground_dir / ground_manifest['binary'], dtype='u1', mode='r')
        raw_ground = [m for m in ground_manifest['meshes'] if m['name'] == GROUND]
        if len(raw_ground) != 1 or raw_ground[0]['material'] != matches[0]['material'] or ground_manifest['materials'][raw_ground[0]['material']] != source['materials'][matches[0]['material']]:
            raise ValueError('Original ground material identity changed')
        policy['originalGroundGeometrySha256'] = ground_manifest['sha256']
        raw_selection = json.dumps(policy, ensure_ascii=False, indent=2).encode('utf-8')
        selection_sha = hashlib.sha256(raw_selection).hexdigest()
        volumes = [prism_planes(policy['polygon'])]
    else:
        raise ValueError('Only the reviewed factory and icebreaker edits are supported')
    output.mkdir(parents=True)
    (output / 'manual-cull-selection.json').write_bytes(raw_selection)
    if effective:
        (output / 'manual-cull-effective-selection.json').write_text(json.dumps(effective, indent=2), encoding='utf-8')
    if restoration_plan:
        shutil.copy2(restoration_plan, output / 'manual-cull-restoration-plan.json')
    records, changes = [], []
    low, high = np.full(3, np.inf), np.full(3, -np.inf)
    instances = triangles = 0
    with (output / source['binary']).open('wb') as handle:
        for ordinal, mesh in enumerate(source['meshes']):
            if name == 'icebreaker' and mesh['name'] == GROUND:
                mesh = raw_ground[0]
                data = read_arrays(mesh, ground_binary)
            else:
                data = read_arrays(mesh, binary)
            variants = {}
            affected, removed = [], []
            for i, (matrix, box) in enumerate(zip(data['matrices'], data['boxes'])):
                enabled = name == 'factory' or mesh['name'] == GROUND
                keep_inside = name == 'icebreaker'
                relevant = []
                eliminate = False
                if enabled:
                    for planes in volumes:
                        classification = classify_box(box, planes)
                        if classification == ('outside' if keep_inside else 'inside'):
                            eliminate = True
                            break
                        if classification == 'crossing':
                            relevant.append(planes)
                if eliminate:
                    removed.append(i)
                    continue
                result = clip_surface(data['positions'], data['uvs'], data['paint'], data['faces'], matrix, relevant, keep_inside) if relevant else None
                if result is not None and not len(result['indices']):
                    removed.append(i)
                    continue
                signature = 'unchanged'
                if result is not None:
                    signature = 'manual-' + hashlib.sha256(b''.join(result[k].tobytes() for k in ['positions', 'uvs', 'paint', 'indices', 'wholeFaces', 'boundaryFaces'])).hexdigest()[:20]
                    affected.append(i)
                variant = variants.setdefault(signature, {'result': result, 'instances': []})
                variant['instances'].append(i)
            if affected or removed:
                changes.append({'sourceGroup': ordinal, 'name': mesh['name'], 'material': mesh['material'],
                                'removedInstances': removed, 'clippedInstances': affected})
            for signature, variant in variants.items():
                selected, clipped = variant['instances'], variant['result']
                record = dict(mesh)
                record['instances'] = len(selected)
                if clipped is None:
                    attrs = [data[k] for k in ['positions', 'uvs', 'paint', 'faces']]
                    boxes = data['boxes'][selected]
                else:
                    attrs = [clipped[k] for k in ['positions', 'uvs', 'paint', 'indices']]
                    record.pop('groundClip', None)
                    record.pop('sourceFaceRanges', None)
                    record.update(vertices=len(clipped['positions']), indices=len(clipped['indices']), cropVariant=signature,
                                  sourceFaceCount=len(clipped['indices']) // 3,
                                  sourceOriginalFaceCount=mesh.get('sourceOriginalFaceCount', mesh['sourceFaceCount']),
                                  surfaceClip=clip_lineage(mesh, clipped))
                    boxes = []
                    for i in selected:
                        transform = data['matrices'][i].reshape(3, 4)
                        world = clipped['positions'] @ transform[:, :3].T + transform[:, 3]
                        boxes.append(np.r_[world.min(0), world.max(0)])
                    boxes = np.asarray(boxes, dtype='<f4')
                for key, values in zip(['positionOffset', 'uvOffset', 'paintOffset', 'indexOffset', 'matrixOffset', 'boundsOffset'],
                                       [*attrs, data['matrices'][selected], boxes]):
                    record[key] = handle.tell()
                    handle.write(values.tobytes())
                records.append(record)
                low = np.minimum(low, boxes[:, :3].min(0))
                high = np.maximum(high, boxes[:, 3:].max(0))
                instances += len(selected)
                triangles += len(selected) * record['indices'] // 3
            if ordinal % 1000 == 0:
                print(f'[manual-cull] {name} {ordinal}/{len(source["meshes"])}', flush=True)
    if not records or not changes:
        raise ValueError('Empty map or no affected geometry')
    sha = digest(output / source['binary'])
    summary = {'version': 1, 'sourceGeometrySha256': source['sha256'], 'selectionSha256': selection_sha,
               'coordinateSystem': 'unity-world-xyz', 'operation': 'subtract-saved-volumes' if name == 'factory' else 'keep-ground-inside-ellipse',
               'selectionCount': len(volumes), 'removedInstances': sum(len(c['removedInstances']) for c in changes),
               'clippedInstances': sum(len(c['clippedInstances']) for c in changes), 'affectedMeshGroups': len(changes)}
    if effective:
        summary.update(effectiveSelectionSha256=digest(output / 'manual-cull-effective-selection.json'),
                       reviewedPreviousGeometrySha256=reviewed['sha256'],
                       latestSelectionCount=len(policy['exclusions']),
                       additionalRemovedInstances=reviewed['stats']['exportedInstances'] - instances,
                       previousRoundStats=reviewed['stats'])
    if restoration_plan:
        summary.update(restorationPlanSha256=digest(output / 'manual-cull-restoration-plan.json'),
                       restoredInstances=instances-reviewed['stats']['exportedInstances'])
    stats = {**source['stats'], 'exportedInstances': instances, 'meshGroups': len(records), 'instancedTriangles': triangles,
             'bytes': (output / source['binary']).stat().st_size}
    result = {**source, 'sha256': sha, 'meshes': records, 'bounds': {'min': low.tolist(), 'max': high.tolist()},
              'stats': stats, 'manualCull': summary}
    (output / manifest_path.name).write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    (output / 'manual-cull-audit.json').write_text(json.dumps({'map': name, 'summary': summary, 'before': source['stats'], 'after': stats,
                'outputGeometrySha256': sha, 'changes': changes}, indent=2), encoding='utf-8')
    for texture in source['textures'].values():
        target = output / texture['file']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_dir / texture['file'], target)
    print(json.dumps({'map': name, 'summary': summary, 'stats': stats, 'bounds': result['bounds']}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--name', choices=['factory', 'icebreaker'], required=True)
    parser.add_argument('--selection')
    parser.add_argument('--ground-source')
    parser.add_argument('--reviewed-current', help='Current geometry manifest matching this round of saved edits')
    parser.add_argument('--previous-selection', help='Previous effective selection (or first-round original) verified by its applied SHA-256')
    parser.add_argument('--restoration-plan', help='Explicit reviewed boundary shrink and preservation volumes')
    args = parser.parse_args()
    if args.name == 'factory' and not args.selection:
        parser.error('Factory requires the saved --selection file')
    if args.name == 'icebreaker' and not args.ground_source:
        parser.error('Icebreaker requires the untouched --ground-source directory')
    if bool(args.reviewed_current) != bool(args.previous_selection) or args.reviewed_current and args.name != 'factory':
        parser.error('Factory history requires both --reviewed-current and --previous-selection')
    if args.restoration_plan and not args.reviewed_current:
        parser.error('Restoration requires verified current geometry and history')
    apply(args.source, args.out, args.name, args.selection, args.ground_source, args.reviewed_current, args.previous_selection, args.restoration_plan)
