"""Verify every manually changed surface against the untouched export and cuts."""
import argparse
import hashlib
import importlib.util
import json
import sys
import unittest
from collections import Counter
from pathlib import Path

import numpy as np
import shapely
from lib.atlas_volume_clip import face_lineage, prism_planes

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/tests'))
from geometry_provenance import assert_interpolated_triangles

spec = importlib.util.spec_from_file_location('apply_cuts', ROOT / 'scripts/apply-atlas-model-cuts.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
read_arrays = module.read_arrays
test = unittest.TestCase()


def load(directory, name):
    manifest = json.loads((directory / f'{name}-geometry.json').read_bytes())
    file = directory / manifest['binary']
    assert module.digest(file) == manifest['sha256']
    return manifest, np.memmap(file, dtype='u1', mode='r')


def key(mesh):
    return mesh['name'], mesh['material'], mesh['sourceFaceStart']


def instance_signatures(manifest, binary, ignore_ground=False):
    signatures = Counter()
    for mesh in manifest['meshes']:
        if ignore_ground and mesh['name'] == module.GROUND:
            continue
        data = read_arrays(mesh, binary)
        geometry = hashlib.sha256(b''.join(data[k].tobytes() for k in ['positions', 'uvs', 'paint', 'faces'])).hexdigest()
        signatures.update((key(mesh), geometry, matrix.tobytes(), box.tobytes()) for matrix, box in zip(data['matrices'], data['boxes']))
    return signatures


def verify(directory, baseline, raw, name):
    current, binary = load(directory, name)
    before, baseline_binary = load(baseline, name)
    original, raw_binary = load(raw, name)
    assert current['manualCull']['sourceGeometrySha256'] == before['sha256']
    assert original['sceneSha256'] == current['sceneSha256'] == before['sceneSha256']
    assert current['materials'] == before['materials'] and current['textures'] == before['textures']
    source_meshes = {key(m): m for m in original['meshes']}
    assert len(source_meshes) == len(original['meshes'])
    selection = json.loads((directory / 'manual-cull-selection.json').read_bytes())
    assert module.digest(directory / 'manual-cull-selection.json') == current['manualCull']['selectionSha256']
    if current['manualCull'].get('effectiveSelectionSha256'):
        effective_path = directory / 'manual-cull-effective-selection.json'
        assert module.digest(effective_path) == current['manualCull']['effectiveSelectionSha256']
        selection = json.loads(effective_path.read_bytes())
        assert selection['baselineGeometrySha256'] == before['sha256']
    checked_faces = checked_vertices = changed_groups = 0
    for mesh in current['meshes']:
        if not mesh.get('surfaceClip'):
            continue
        changed_groups += 1
        data = read_arrays(mesh, binary)
        source = source_meshes[key(mesh)]
        original_data = read_arrays(source, raw_binary)
        ids, whole = face_lineage(mesh)
        indices = ids - source['sourceFaceStart']
        assert indices.min() >= 0 and indices.max() < len(original_data['faces'])
        faces, original_faces = data['faces'], original_data['faces'][indices]
        for attr in ['positions', 'uvs', 'paint']:
            np.testing.assert_array_equal(data[attr][faces[:whole]], original_data[attr][original_faces[:whole]])
        weights = assert_interpolated_triangles(test,
            original_data['positions'][original_faces[whole:]].astype(float), original_data['uvs'][original_faces[whole:]].astype(float),
            data['positions'][faces[whole:]].astype(float), data['uvs'][faces[whole:]].astype(float))
        if weights is not None:
            expected = np.einsum('nij,njk->nik', weights, original_data['paint'][original_faces[whole:]])
            np.testing.assert_allclose(data['paint'][faces[whole:]], expected, atol=1.1, rtol=0)
        # No duplicated / enlarged original surface is allowed after subtraction.
        triangles = data['positions'][faces].astype(float)
        areas = np.linalg.norm(np.cross(triangles[:, 1]-triangles[:, 0], triangles[:, 2]-triangles[:, 0]), axis=1)
        originals = original_data['positions'][original_faces].astype(float)
        original_areas = np.linalg.norm(np.cross(originals[:, 1]-originals[:, 0], originals[:, 2]-originals[:, 0]), axis=1)
        unique, inverse = np.unique(ids, return_inverse=True)
        summed = np.bincount(inverse, weights=areas)
        _, first = np.unique(ids, return_index=True)
        assert np.all(summed <= original_areas[first] + np.maximum(.002, original_areas[first] * 1e-4)), mesh['name']
        checked_faces += len(faces)
        checked_vertices += len(data['positions'])
    if name == 'factory':
        volumes = [prism_planes(c['volume']['polygon'], c['volume']['minY'], c['volume']['maxY']) for c in selection['exclusions']]
        checked_instances = 0
        # Every remaining surface must be outside each exclusion's interior,
        # including height-restricted cuts and vertical walls. Plane separation
        # is sufficient here: retained fragments are explicitly convex pieces.
        for mesh in current['meshes']:
            data = read_arrays(mesh, binary)
            for transform, box in zip(data['matrices'].reshape(-1, 3, 4), data['boxes']):
                for planes in volumes:
                    normal = planes[:, :3]
                    maximum = np.sum(np.where(normal >= 0, box[3:], box[:3]) * normal, axis=1) + planes[:, 3]
                    if np.any(maximum <= .0003):
                        continue
                    world = data['positions'].astype(float) @ transform[:, :3].T + transform[:, 3]
                    distances = world @ normal.T + planes[:, 3]
                    for faces in np.array_split(data['faces'], max(1, (len(data['faces']) + 2047) // 2048)):
                        outside = np.any(np.all(distances[faces] <= .0003, axis=1), axis=1)
                        assert outside.all(), f'Retained surface intersects a cut: {mesh["name"]}'
                checked_instances += 1
    else:
        # Exact byte comparisons cover EVERY ship part, including every instance
        # matrix/bounds, UV, color, vertex, index and material assignment.
        assert instance_signatures(current, binary, True) == instance_signatures(before, baseline_binary, True)
        polygon = shapely.Polygon([(p['x'], p['z']) for p in selection['polygon']])
        ship = shapely.Polygon(selection['shipHullXZ'])
        assert polygon.covers(ship.buffer(5, quad_segs=64))
        assert ship.distance(polygon.boundary) >= 5
        mesh = next(m for m in current['meshes'] if m['name'] == module.GROUND)
        data = read_arrays(mesh, binary)
        transform = data['matrices'][0].reshape(3, 4)
        world = data['positions'].astype(float) @ transform[:, :3].T + transform[:, 3]
        assert np.all(shapely.covers(polygon.buffer(.0003), shapely.points(world[:, [0, 2]])))
        checked_instances = current['stats']['exportedInstances']
    report = {'map': name, 'geometrySha256': current['sha256'], 'changedMeshVariantsChecked': changed_groups,
              'sourceTrianglesChecked': checked_faces, 'sourceVerticesChecked': checked_vertices,
              'worldInstancesChecked': checked_instances, 'passed': True}
    (directory / 'manual-cull-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--name', choices=['factory', 'icebreaker'], required=True)
    args = parser.parse_args()
    verify(args.directory, args.baseline, args.raw, args.name)
