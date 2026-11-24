"""Retain verified prior removals when rebuilding subsequent editing rounds."""
import copy
import hashlib
import json
from pathlib import Path
from .atlas_volume_clip import prism_planes


def file_sha(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def merge_exclusions(previous, latest):
    """Exact union: only coalesce identical X/Z polygons with touching Y spans."""
    by_polygon = {}
    for cut in [*previous, *latest]:
        if cut['operation'] != 'review-and-prune-intersecting-geometry':
            raise ValueError('Unsupported historical cut operation')
        volume = cut['volume']
        prism_planes(volume['polygon'], volume['minY'], volume['maxY'])
        key = json.dumps(volume['polygon'], sort_keys=True, separators=(',', ':'))
        by_polygon.setdefault(key, []).append(volume)
    result = []
    for key, volumes in by_polygon.items():
        merged = []
        for volume in sorted(volumes, key=lambda v: v['minY']):
            if merged and volume['minY'] <= merged[-1]['maxY']:
                merged[-1]['maxY'] = max(merged[-1]['maxY'], volume['maxY'])
            else:
                merged.append(copy.deepcopy(volume))
        for volume in merged:
            digest = hashlib.sha256(json.dumps(volume, sort_keys=True).encode()).hexdigest()[:20]
            result.append({'id': f'effective-{digest}', 'volume': volume,
                           'operation': 'review-and-prune-intersecting-geometry'})
    return result


def verified_history(baseline, latest, reviewed_path, previous_path):
    """Do not rewrite user stamps: verify both sides of the geometry/recipe chain."""
    reviewed_path, previous_path = Path(reviewed_path), Path(previous_path)
    reviewed = json.loads(reviewed_path.read_bytes())
    previous = json.loads(previous_path.read_bytes())
    stamp = latest['source']
    if stamp['geometryManifestSha256'] != file_sha(reviewed_path) or stamp['geometrySha256'] != reviewed['sha256']:
        raise ValueError('Selection does not match the reviewed current geometry')
    if file_sha(reviewed_path.parent / reviewed['binary']) != reviewed['sha256']:
        raise ValueError('Reviewed current binary SHA-256 mismatch')
    if stamp['sceneSha256'] != reviewed['sceneSha256'] or reviewed['sceneSha256'] != baseline['sceneSha256']:
        raise ValueError('Client scene changed between editing rounds')
    applied = reviewed.get('manualCull') or {}
    if applied.get('sourceGeometrySha256') != baseline['sha256']:
        raise ValueError('Previous round used a different scenery baseline')
    expected = applied.get('effectiveSelectionSha256') or applied.get('selectionSha256')
    if file_sha(previous_path) != expected:
        raise ValueError('Previous selection does not match the applied audit')
    if previous.get('map') != latest['map'] or previous.get('coordinateSystem') != latest['coordinateSystem']:
        raise ValueError('Historical map or coordinate system changed')
    # Unchanged editor rectangles must not re-delete a reviewed restoration hole.
    # Only new or geometrically changed selections count as new user intent.
    previous_input_path = previous_path.with_name('manual-cull-selection.json') if applied.get('effectiveSelectionSha256') else previous_path
    if file_sha(previous_input_path) != applied.get('selectionSha256'):
        raise ValueError('Previous editor input does not match the applied audit')
    previous_input = json.loads(previous_input_path.read_bytes())
    old_by_id = {cut['id']: cut for cut in previous_input['exclusions']}
    additions = [cut for cut in latest['exclusions'] if cut['id'] not in old_by_id or
                 cut['volume'] != old_by_id[cut['id']]['volume'] or cut['operation'] != old_by_id[cut['id']]['operation']]
    effective = {'schemaVersion': 1, 'kind': 'derived-cumulative-selection', 'map': latest['map'],
                 'coordinateSystem': latest['coordinateSystem'], 'baselineGeometrySha256': baseline['sha256'],
                 'previousEffectiveSelectionSha256': expected, 'reviewedGeometrySha256': reviewed['sha256'],
                 'newOrChangedSelections': len(additions),
                 'exclusions': merge_exclusions(previous['exclusions'], additions)}
    return effective, reviewed
