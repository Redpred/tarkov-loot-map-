"""Conservative X/Z scenery filtering; never clip a mesh or change its transform."""
import hashlib
import json
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import MultiPoint, Polygon

POLICY_VERSION = 4
DEFAULT_MARGIN = 10.0


def protected_area(site, map_id, margin=DEFAULT_MARGIN):
    site = Path(site)
    inputs = {}
    documents = {}
    for suffix in ('atlas', 'pois', 'quests'):
        file = site / 'data' / f'{map_id}-{suffix}.json'
        raw = file.read_bytes()
        inputs[file.name] = hashlib.sha256(raw).hexdigest()
        documents[suffix] = json.loads(raw)
    border = documents['atlas']['coordinateAudit']['levelBorder']
    if len(border) < 3:
        raise ValueError(f'{map_id}: missing client border; refusing to guess')
    polygon = Polygon([(p['x'], p['z']) for p in border])
    # A self-intersecting client outline is ambiguous: its convex hull retains
    # extra scenery instead of silently losing a lobe during polygon repair.
    border_fallback = not polygon.is_valid
    if border_fallback:
        polygon = polygon.convex_hull
    anchors = []
    counts = {}
    for source, doc in documents.items():
        start = len(anchors)
        for point in doc.get('points', []):
            if point.get('outsideClientEnvelope'):
                continue
            if set(point.get('poiTypes', [])) & {'mine', 'sniper_zone'}:
                continue  # Forbidden areas are markers, not playable-area extensions.
            positions = [point.get('position')]
            positions += [p.get('Position') for p in point.get('groupPositions', [])]
            # Hazard polygons can span kilometres of forbidden terrain. Their
            # centers are protected, but they must not redefine the playable area.
            if not set(point.get('poiTypes', [])) & {'mine', 'sniper_zone'}:
                positions += point.get('outline', [])
            for p in positions:
                if p and all(np.isfinite(p.get(k, np.nan)) for k in ('x', 'z')):
                    anchors.append((p['x'], p['z']))
        counts[source] = len(anchors) - start
    if not anchors:
        raise ValueError(f'{map_id}: no protected points')
    # Buffer the union, not a hull around unrelated points: islands remain
    # protected without also keeping all scenery between them.
    unique = np.unique(np.asarray(anchors), axis=0)
    extra = unique[~shapely.covers(polygon, shapely.points(unique))]
    parts = [polygon.buffer(margin)]
    if len(extra):
        parts.append(MultiPoint(extra).buffer(margin))
    area = shapely.union_all(parts)
    shapely.prepare(area)
    evidence = {
        'policyVersion': POLICY_VERSION, 'marginMetres': margin,
        'method': 'Buffered client border plus loot/interactive POI/quest anchors; exclude hazard-only extensions. Trim crossing ground to the footprint with barycentric UV/color interpolation, select original intersecting triangles for other large meshes, and keep small objects whole. Exclude verified city panorama, sea-ground scenery and the two verified untextured terrain LOD meshes.',
        'inputSha256': inputs, 'borderConvexHullFallback': border_fallback,
        'protectedAnchorCounts': counts, 'protectedBoundsXZ': list(area.bounds),
    }
    evidence['policySha256'] = hashlib.sha256(json.dumps(evidence, sort_keys=True).encode()).hexdigest()
    return area, evidence


def keep_instances(boxes, area):
    boxes = np.asarray(boxes)
    if boxes.ndim != 2 or boxes.shape[1] != 6 or not np.isfinite(boxes).all():
        raise ValueError('Invalid instance bounds')
    if np.any(boxes[:, :3] > boxes[:, 3:]):
        raise ValueError('Inverted instance bounds')
    # Footprints include a millimetre guard for float32 boundary round-off and
    # for degenerate vertical walls whose X/Z footprint is a line or a point.
    footprints = shapely.box(boxes[:, 0] - .001, boxes[:, 2] - .001,
                             boxes[:, 3] + .001, boxes[:, 5] + .001)
    return np.asarray(shapely.intersects(area, footprints), dtype=bool)


def faces_in_area(world_vertices, faces, area):
    """Select original triangles; even a containing triangle with no vertex inside stays.

    Retaining intersecting triangles keeps boundary surfaces closed without inventing
    geometry, changing winding/UVs or flattening vertical faces.
    """
    triangles = np.asarray(world_vertices)[:, [0, 2]][np.asarray(faces)]
    lo, hi = triangles.min(axis=1), triangles.max(axis=1)
    rectangles = shapely.box(lo[:, 0] - .001, lo[:, 1] - .001, hi[:, 0] + .001, hi[:, 1] + .001)
    keep = np.asarray(shapely.covers(area, rectangles))
    candidates = np.flatnonzero(~keep & shapely.intersects(area, rectangles))
    if len(candidates):
        projected = triangles[candidates]
        edge_a, edge_b = projected[:, 1] - projected[:, 0], projected[:, 2] - projected[:, 0]
        vertical = np.abs(edge_a[:, 0] * edge_b[:, 1] - edge_a[:, 1] * edge_b[:, 0]) < 1e-8
        if (~vertical).any():
            keep[candidates[~vertical]] = shapely.intersects(area, shapely.polygons(projected[~vertical]))
        if vertical.any():
            lines = np.concatenate([projected[vertical], projected[vertical, :1]], axis=1)
            keep[candidates[vertical]] = shapely.intersects(area, shapely.linestrings(lines))
    return keep


def clip_ground(positions, uvs, paint, faces, matrix, area, source_start=0):
    """Clip a terrain surface to the protected footprint with interpolated attributes.

    Original interior triangles stay byte-identical. Only boundary triangles gain
    new vertices, interpolated on the original plane (including original UV seams).
    Vertical skirts use triangle selection because their X/Z projection has no area.
    """
    matrix = np.asarray(matrix).reshape(3, 4).astype(np.float64)
    world = positions.astype(np.float64) @ matrix[:, :3].T + matrix[:, 3]
    projected = world[:, [0, 2]][faces]
    lo, hi = projected.min(axis=1), projected.max(axis=1)
    rectangles = shapely.box(lo[:, 0], lo[:, 1], hi[:, 0], hi[:, 1])
    full = np.asarray(shapely.covers(area, rectangles))
    crossing = np.flatnonzero(~full & shapely.intersects(area, rectangles))
    additions, boundary_sources = [], []
    for face_id in crossing:
        triangle = projected[face_id]
        edges = (triangle[1:] - triangle[0]).T
        determinant = np.linalg.det(edges)
        if abs(determinant) < 1e-8 or np.linalg.cond(edges) > 1e6:
            full[face_id] = bool(shapely.intersects(area, shapely.LineString([*triangle, triangle[0]])))
            continue
        polygon = Polygon(triangle)
        if shapely.covers(area, polygon):
            full[face_id] = True
            continue
        intersection = shapely.intersection(area, polygon)
        if intersection.is_empty or intersection.area < 1e-8:
            continue
        parts = [p for p in shapely.get_parts(intersection) if p.geom_type == 'Polygon' and p.area > 1e-8]
        inverse = np.linalg.inv(edges)
        addition_start = len(additions)
        unstable = False
        for part in parts:
            for clipped in shapely.get_parts(shapely.constrained_delaunay_triangles(part)):
                points = np.asarray(clipped.exterior.coords)[:3]
                cross = np.linalg.det((points[1:] - points[0]).T)
                if cross * determinant < 0:
                    points = points[[0, 2, 1]]
                bc = (points - triangle[0]) @ inverse.T
                weights = np.column_stack([1 - bc.sum(axis=1), bc])
                if not np.isfinite(weights).all() or weights.min() < -1e-5 or weights.max() > 1.00001:
                    # Nearly vertical skirts can have ill-conditioned X/Z
                    # projections. Preserve the original face instead of creating
                    # a vertex outside its original surface or texture domain.
                    unstable = True
                    break
                weights = np.clip(weights, 0, 1)
                weights /= weights.sum(axis=1, keepdims=True)
                # Coordinates, UVs and color all share the same barycentric weights.
                original = faces[face_id]
                additions.append((weights @ positions[original], weights @ uvs[original], weights @ paint[original]))
                boundary_sources.append(int(source_start + face_id))
            if unstable:
                break
        if unstable:
            del additions[addition_start:]
            del boundary_sources[addition_start:]
            full[face_id] = True
    full_ids = np.flatnonzero(full)
    if not len(full_ids) and not additions:
        return None
    retained, remapped = np.unique(faces[full_ids].reshape(-1), return_inverse=True)
    new_positions, new_uvs, new_paint = positions[retained], uvs[retained], paint[retained]
    if additions:
        new_positions = np.concatenate([new_positions, *(a[0] for a in additions)]).astype('<f4')
        new_uvs = np.concatenate([new_uvs, *(a[1] for a in additions)]).astype('<f4')
        new_paint = np.concatenate([new_paint, *(np.rint(np.clip(a[2], 0, 255)).astype('u1') for a in additions)])
    indices = np.r_[remapped, np.arange(len(retained), len(new_positions))].astype('<u4')
    return {'positions': new_positions, 'uvs': new_uvs, 'paint': new_paint, 'indices': indices,
            'wholeFaces': full_ids, 'boundarySourceFaces': boundary_sources}
