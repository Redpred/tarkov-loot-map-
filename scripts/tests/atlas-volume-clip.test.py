import sys
import unittest
from pathlib import Path
import numpy as np
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.atlas_volume_clip import clip_surface, prism_planes, clip_lineage


def volume(x0, z0, x1, z1, y0=-1, y1=1):
    return prism_planes([{'x': x0, 'z': z0}, {'x': x1, 'z': z0},
                         {'x': x1, 'z': z1}, {'x': x0, 'z': z1}], y0, y1)


class VolumeClipTests(unittest.TestCase):
    def clip(self, points, volumes, keep=False, matrix=None, faces=None):
        self.points = np.asarray(points, dtype='<f4')
        self.uv = self.points[:, [0, 2]] * .25 + self.points[:, [1]] * .1
        self.paint = np.tile(np.array([40, 80, 120, 255], 'u1'), (len(points), 1))
        return clip_surface(self.points, self.uv, self.paint,
                            np.asarray(faces or [[0, 1, 2]], dtype='<u4'),
                            np.eye(4)[:3] if matrix is None else matrix, volumes, keep)

    def area(self, result):
        tri = result['positions'][result['indices'].reshape(-1, 3)].astype(float)
        return np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1).sum() / 2

    def test_vertical_wall_keeps_upper_storey_and_texture(self):
        result = self.clip([[0, 0, 0], [4, 0, 0], [0, 4, 0]], [volume(-1, -1, 5, 1, -1, 2)])
        self.assertAlmostEqual(self.area(result), 2)
        self.assertGreaterEqual(result['positions'][:, 1].min(), 2)
        np.testing.assert_allclose(result['uvs'], result['positions'][:, [0, 2]] * .25 + result['positions'][:, [1]] * .1, atol=1e-6)

    def test_overlapping_subtractions_do_not_duplicate_surfaces(self):
        result = self.clip([[0, 0, 0], [10, 0, 0], [0, 0, 10]],
                           [volume(1, 1, 4, 4), volume(2, 2, 5, 5)])
        self.assertAlmostEqual(self.area(result), 36, places=5)
        projected = result['positions'][:, [0, 2]][result['indices'].reshape(-1, 3)]
        triangles = shapely.polygons(projected)
        self.assertAlmostEqual(shapely.union_all(triangles).area, self.area(result), places=5)

    def test_containing_triangle_is_cut_even_without_a_vertex_inside(self):
        result = self.clip([[-10, 0, -10], [10, 0, -10], [0, 0, 10]], [volume(-1, -1, 1, 1)], True)
        self.assertAlmostEqual(self.area(result), 4, places=6)

    def test_coplanar_boundary_not_duplicated(self):
        result = self.clip([[0, 1, 0], [10, 1, 0], [0, 1, 10]], [volume(1, 1, 4, 4)])
        self.assertAlmostEqual(self.area(result), 41, places=5)

    def test_same_mesh_other_instance_and_height_are_unchanged(self):
        points = [[0, 0, 0], [1, 0, 0], [0, 0, 1]]
        cut = [volume(-1, -1, 2, 2)]
        self.assertEqual(len(self.clip(points, cut)['indices']), 0)
        matrix = np.eye(4)[:3].copy(); matrix[1, 3] = 5
        self.assertIsNone(self.clip(points, cut, matrix=matrix))
        matrix[0, 3] = 30; matrix[1, 3] = 0
        self.assertIsNone(self.clip(points, cut, matrix=matrix))

    def test_winding_colors_and_seams_remain(self):
        result = self.clip([[0, 0, 0], [10, 0, 0], [0, 0, 10]], [volume(1, 1, 4, 4)])
        tri = result['positions'][result['indices'].reshape(-1, 3)]
        self.assertTrue(np.all(np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0])[:, 1] < 0))
        np.testing.assert_array_equal(result['paint'], np.tile([40, 80, 120, 255], (len(result['positions']), 1)))

    def test_lineage_composes_previous_ground_cut(self):
        mesh = {'indices': 12, 'groundClip': {'wholeFaceRanges': [[10, 12]], 'boundarySourceFaces': [14, 14]}}
        result = {'wholeFaces': np.array([1, 3]), 'boundaryFaces': np.array([2, 2, 0])}
        self.assertEqual(clip_lineage(mesh, result), {'wholeFaceRanges': [[11, 12]], 'boundarySourceFaces': [14, 14, 14, 10]})

    def test_rejects_concave_polygon_and_invalid_heights(self):
        with self.assertRaises(ValueError):
            volume(0, 0, 1, 1, 2, 1)
        with self.assertRaises(ValueError):
            prism_planes([{'x': 0, 'z': 0}, {'x': 2, 'z': 0}, {'x': .5, 'z': .5}, {'x': 0, 'z': 2}])


if __name__ == '__main__':
    unittest.main(verbosity=2)
