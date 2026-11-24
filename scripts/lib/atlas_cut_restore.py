"""Explicit restoration shrinks an audited removal recipe; it never adds cuts."""
import copy
import hashlib
import json
import shapely
from shapely.geometry import Polygon
from .atlas_cut_history import merge_exclusions
from .atlas_volume_clip import prism_planes


def polygon(volume):
    return Polygon([(p['x'], p['z']) for p in volume['polygon']])


def cut_record(shape, low, high):
    volume = {'polygon': [{'x': float(x), 'z': float(z)} for x, z in list(shape.exterior.coords)[:-1]], 'minY': low, 'maxY': high}
    prism_planes(volume['polygon'], low, high)
    key = hashlib.sha256(json.dumps(volume, sort_keys=True).encode()).hexdigest()[:20]
    return {'id': 'effective-'+key, 'volume': volume, 'operation': 'review-and-prune-intersecting-geometry'}


def subtract_preservation(cut, keep):
    volume = cut['volume']; low = max(volume['minY'], keep['minY']); high = min(volume['maxY'], keep['maxY'])
    shape, preserved = polygon(volume), polygon(keep)
    if low >= high or not shape.intersects(preserved):
        return [copy.deepcopy(cut)]
    result = []
    if volume['minY'] < low:
        result.append(cut_record(shape, volume['minY'], low))
    if high < volume['maxY']:
        result.append(cut_record(shape, high, volume['maxY']))
    for part in shapely.get_parts(shape.difference(preserved)):
        if part.geom_type != 'Polygon' or part.area < 1e-9:
            continue
        parts = ([part] if not part.interiors and part.convex_hull.area-part.area < 1e-9
                 else shapely.get_parts(shapely.constrained_delaunay_triangles(part)))
        result.extend(cut_record(piece, low, high) for piece in parts if piece.area > 1e-9)
    return result


def ensure_only_restores(before, after):
    heights = sorted({v['volume'][k] for v in [*before, *after] for k in ['minY', 'maxY']})
    for lo, hi in zip(heights, heights[1:]):
        middle = (lo+hi)/2
        footprint = lambda rows: shapely.union_all([polygon(c['volume']) for c in rows if c['volume']['minY'] < middle < c['volume']['maxY']])
        if footprint(after).difference(footprint(before)).area > 1e-7:
            raise ValueError('A restoration plan would introduce new removals')


def restore_recipe(effective, latest, plan):
    if plan.get('operation') != 'restore-reviewed-boundaries' or plan.get('map') != latest['map'] or plan.get('reviewedGeometrySha256') != latest['source']['geometrySha256']:
        raise ValueError('Restoration plan does not match the reviewed source')
    result = copy.deepcopy(effective); before = copy.deepcopy(result['exclusions'])
    selections = {cut['id']:cut for cut in latest['exclusions']}
    for change in plan['replacements']:
        selected = selections[change['cutId']]
        if selected['volume']['polygon'] != change['replacementPolygon']:
            raise ValueError('Editor boundary does not match restoration plan')
        old = Polygon([(p['x'],p['z']) for p in change['previousPolygon']])
        new = polygon(selected['volume'])
        if new.is_empty or not new.is_valid or new.difference(old).area > 1e-7:
            raise ValueError('Restoration must shrink the old exclusion')
        found = 0; updated = []
        for cut in result['exclusions']:
            if cut['volume']['polygon'] == change['previousPolygon']:
                found += 1
                volume = cut['volume']; low, high = change.get('heightRange', [volume['minY'], volume['maxY']])
                low, high = max(low, volume['minY']), min(high, volume['maxY'])
                if low >= high:
                    updated.append(cut); continue
                if volume['minY'] < low:
                    updated.append(cut_record(old, volume['minY'], low))
                updated.append(cut_record(new, low, high))
                if high < volume['maxY']:
                    updated.append(cut_record(old, high, volume['maxY']))
            elif cut['volume']['polygon'] != change['replacementPolygon']:
                updated.append(cut)
        if not found:
            raise ValueError('Original boundary was not found in the applied recipe')
        result['exclusions'] = updated
    result['exclusions'] = merge_exclusions(result['exclusions'], [])
    for entry in plan.get('preserveVolumes', []):
        keep = entry['volume']; prism_planes(keep['polygon'], keep['minY'], keep['maxY'])
        result['exclusions'] = [part for cut in result['exclusions'] for part in subtract_preservation(cut, keep)]
    ensure_only_restores(before, result['exclusions'])
    result['restoration'] = copy.deepcopy(plan)
    return result
