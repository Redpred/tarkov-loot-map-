"""Cut convex Unity-world volumes without moving meshes or flattening surfaces.

Clipping uses barycentric weights, so vertical faces, UV seams, vertex colors,
and the winding of each original triangle survive every successive cut.
"""
import numpy as np

EPS = 1e-8


def prism_planes(polygon, min_y=None, max_y=None):
    points = np.asarray([[p['x'], p['z']] for p in polygon], dtype=float)
    if len(points) < 3 or not np.isfinite(points).all():
        raise ValueError('Invalid volume polygon')
    following = np.roll(points, -1, axis=0)
    area = np.sum(points[:, 0] * following[:, 1] - following[:, 0] * points[:, 1])
    if abs(area) < EPS:
        raise ValueError('Empty polygon')
    if area < 0:
        points = points[::-1]
    planes = []
    for a, b in zip(points, np.roll(points, -1, axis=0)):
        edge = b - a
        length = np.linalg.norm(edge)
        if length < EPS:
            raise ValueError('Duplicate polygon corner')
        normal = np.array([-edge[1], edge[0]]) / length
        offset = -normal @ a
        if np.min(points @ normal + offset) < -1e-6:
            raise ValueError('Volume must be convex')
        planes.append([normal[0], 0, normal[1], offset])
    if min_y is not None or max_y is not None:
        if min_y is None or max_y is None or not np.isfinite([min_y, max_y]).all() or min_y >= max_y:
            raise ValueError('Invalid volume height')
        planes.extend([[0, 1, 0, -min_y], [0, -1, 0, max_y]])
    return np.asarray(planes)


def classify_box(box, planes):
    normals = planes[:, :3]
    lower = np.sum(np.where(normals >= 0, box[:3], box[3:]) * normals, axis=1) + planes[:, 3]
    upper = np.sum(np.where(normals >= 0, box[3:], box[:3]) * normals, axis=1) + planes[:, 3]
    return 'outside' if np.any(upper < -EPS) else 'inside' if np.all(lower >= -EPS) else 'crossing'


def half_polygon(weights, distances, keep_inside):
    signed = weights @ distances
    if not keep_inside:
        if np.all(signed >= -EPS):
            return None  # Coplanar faces belong to the volume, never both halves.
        signed = -signed
    result = []
    for i, a in enumerate(weights):
        j = (i + 1) % len(weights)
        b, da, db = weights[j], signed[i], signed[j]
        ina, inb = da >= 0, db >= 0
        if ina:
            result.append(a)
        if ina != inb:
            result.append(a + (b - a) * (da / (da - db)))
    if len(result) < 3:
        return None
    result = np.asarray(result)
    # Adjacent duplicate boundary vertices make degenerate fan triangles.
    keep = np.linalg.norm(result - np.roll(result, 1, axis=0), axis=1) > 1e-12
    result = result[keep]
    return result if len(result) >= 3 else None


def cut_polygon(weights, distances, keep_inside=False):
    if np.all(weights @ distances >= -EPS):
        return [weights] if keep_inside else []
    if np.any(np.all(weights @ distances < -EPS, axis=0)):
        return [] if keep_inside else [weights]
    outside = []
    remainder = weights
    for plane in distances.T:
        if not keep_inside:
            part = half_polygon(remainder, plane, False)
            if part is not None:
                outside.append(part)
        remainder = half_polygon(remainder, plane, True)
        if remainder is None:
            break
    return ([remainder] if remainder is not None else []) if keep_inside else outside


def clip_surface(positions, uvs, paint, faces, matrix, volumes, keep_inside=False):
    """None means byte-identical; otherwise return compact arrays and face lineage."""
    transform = np.asarray(matrix, dtype=float).reshape(3, 4)
    world = np.asarray(positions, dtype=float) @ transform[:, :3].T + transform[:, 3]
    whole = np.ones(len(faces), dtype=bool)
    fragments = {}
    for planes in volumes:
        vertex_distances = world @ planes[:, :3].T + planes[:, 3]
        ids = np.flatnonzero(whole)
        # Bound peak memory for high-poly terrain and the ellipse's many planes.
        crossing = []
        for batch in np.array_split(ids, max(1, (len(ids) + 2047) // 2048)):
            d = vertex_distances[faces[batch]]
            inside = np.all(d >= -EPS, axis=(1, 2))
            outside = np.any(np.all(d < -EPS, axis=1), axis=1)
            whole[batch[outside if keep_inside else inside]] = False
            crossing.extend(batch[~inside & ~outside].tolist())
        for face_id in list(fragments):
            distances = vertex_distances[faces[face_id]]
            pieces = [part for poly in fragments[face_id] for part in cut_polygon(poly, distances, keep_inside)]
            if pieces:
                fragments[face_id] = pieces
            else:
                del fragments[face_id]
        for face_id in crossing:
            whole[face_id] = False
            parts = cut_polygon(np.eye(3), vertex_distances[faces[face_id]], keep_inside)
            if parts:
                fragments[face_id] = parts
    if whole.all() and not fragments:
        return None
    weights, boundary_ids = [], []
    for face_id, polygons in sorted(fragments.items()):
        triangle = world[faces[face_id]]
        for polygon in polygons:
            for i in range(1, len(polygon) - 1):
                bary = polygon[[0, i, i + 1]]
                actual = bary @ triangle
                if np.linalg.norm(np.cross(actual[1] - actual[0], actual[2] - actual[0])) <= 1e-10:
                    continue
                weights.append(bary)
                boundary_ids.append(face_id)
    whole_ids = np.flatnonzero(whole)
    retained, remapped = np.unique(faces[whole_ids].reshape(-1), return_inverse=True)
    p, uv, colors = positions[retained], uvs[retained], paint[retained]
    if weights:
        bary = np.asarray(weights)
        originals = faces[boundary_ids]
        interpolate = lambda values: np.einsum('nij,njk->nik', bary, values[originals]).reshape(-1, values.shape[1])
        p = np.concatenate([p, interpolate(positions)]).astype('<f4')
        uv = np.concatenate([uv, interpolate(uvs)]).astype('<f4')
        colors = np.concatenate([colors, np.rint(np.clip(interpolate(paint), 0, 255)).astype('u1')])
    indices = np.r_[remapped, np.arange(len(retained), len(p))].astype('<u4')
    return {'positions': p, 'uvs': uv, 'paint': colors, 'indices': indices,
            'wholeFaces': whole_ids, 'boundaryFaces': np.asarray(boundary_ids, dtype=int)}


def face_lineage(mesh):
    clip = mesh.get('surfaceClip') or mesh.get('groundClip')
    ranges = clip['wholeFaceRanges'] if clip else mesh.get('sourceFaceRanges', [[mesh['sourceFaceStart'], mesh['sourceFaceStart'] + mesh['sourceFaceCount']]])
    whole = np.concatenate([np.arange(a, b) for a, b in ranges]).astype(int) if ranges else np.array([], dtype=int)
    boundary = np.asarray(clip['boundarySourceFaces'], dtype=int) if clip else np.array([], dtype=int)
    ids = np.r_[whole, boundary]
    if len(ids) != mesh['indices'] // 3:
        raise ValueError('Invalid source face lineage')
    return ids, len(whole)


def face_ranges(ids):
    if not len(ids):
        return []
    split = np.r_[0, np.flatnonzero(np.diff(ids) != 1) + 1, len(ids)]
    return [[int(ids[a]), int(ids[b - 1]) + 1] for a, b in zip(split[:-1], split[1:])]


def clip_lineage(mesh, clipped):
    ids, whole_count = face_lineage(mesh)
    kept = clipped['wholeFaces']
    originals = kept[kept < whole_count]
    boundaries = np.r_[kept[kept >= whole_count], clipped['boundaryFaces']]
    return {'wholeFaceRanges': face_ranges(ids[originals]), 'boundarySourceFaces': ids[boundaries].tolist()}
