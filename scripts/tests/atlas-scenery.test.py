import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from lib.atlas_scenery import clip_ground, faces_in_area, keep_instances, protected_area
spec = importlib.util.spec_from_file_location('prune', ROOT / 'scripts/prune-atlas-scenery.py')
prune = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prune)


class SceneryCull(unittest.TestCase):
    def test_verified_untextured_terrain_lods_only(self):
        material={'sh':'Hidden/Terrain/TerrainLodBasePass','tex':None}
        for name in ['Terrain_Base__25_10_297.obj','Terrain_Base__165_4_46.obj']:
            self.assertTrue(prune.untextured_terrain_lod({'name':name},material))
            self.assertFalse(prune.untextured_terrain_lod({'name':name},{**material,'tex':'terrain_albedo'}))
        self.assertFalse(prune.untextured_terrain_lod({'name':'white_wall.obj'},material))
        self.assertFalse(prune.untextured_terrain_lod({'name':'Terrain_Base__25_10_297.obj'},{'sh':'Standard','tex':None}))

    def test_verified_generic_grass_plane_is_clipped_but_not_building(self):
        self.assertTrue(prune.ground_surface({'name':'Plane001__489_54_144.obj'},{'tex':'City_Grass_02_D__sharedassets211_57'}))
        self.assertFalse(prune.ground_surface({'name':'Office_background.obj'},{'tex':'City_Grass_02_D__sharedassets211_57'}))
        self.assertFalse(prune.ground_surface({'name':'Plane001__489_54_144.obj'},{'tex':'Glass'}))

    def test_complete_intersecting_object_and_all_floors_are_kept(self):
        area = box(0, 0, 100, 100)
        bounds = [[10, -200, 10, 20, -100, 20],  # basement
                  [10, 100, 10, 20, 500, 20],   # upper floors
                  [95, 0, 95, 600, 10, 600],    # overlaps despite distant center
                  [100, 0, 30, 100, 9, 35],    # zero-width wall touching border
                  [200, 0, 200, 500, 10, 500]]
        np.testing.assert_array_equal(keep_instances(bounds, area), [True, True, True, True, False])

    def test_exits_tasks_and_loot_variants_protect_border_extensions(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder) / 'data'; data.mkdir()
            docs = {
                'atlas': {'coordinateAudit': {'levelBorder': [dict(x=x, z=z) for x, z in [(0,0),(10,0),(10,10),(0,10)]]},
                          'points': [{'position': {'x': 2, 'z': 2}, 'groupPositions': [{'Position': {'x': 30, 'z': 10}}]},
                                     {'position': {'x': 999, 'z': 999}, 'outsideClientEnvelope': True}]},
                'pois': {'points': [{'position': {'x': 50, 'z': 10}, 'poiTypes': ['extract_pmc'],
                                     'outline': [{'x': 55, 'z': 10}]}]},
                'quests': {'points': [{'position': {'x': 80, 'z': 10}}]},
            }
            for suffix, doc in docs.items():
                (data / f'test-{suffix}.json').write_text(json.dumps(doc))
            area, report = protected_area(folder, 'test', 2)
            bounds = [[x, -10, z, x+.1, 10, z+.1] for x,z in [(5,5),(30,10),(50,10),(55,10),(80,10),(40,40),(999,999)]]
            np.testing.assert_array_equal(keep_instances(bounds, area), [True]*5+[False]*2)
            self.assertEqual(report['protectedAnchorCounts'], {'atlas': 2, 'pois': 2, 'quests': 1})

    def test_material_submeshes_of_same_object_cannot_be_partly_removed(self):
        matrix = np.eye(4, dtype='<f4')[:3].reshape(1, 12)
        chunks=[]; meshes=[]; offset=0
        for bounds in [[10,0,10,20,2,20], [200,0,200,210,2,210]]:
            b=np.asarray([bounds], dtype='<f4')
            meshes.append({'name':'house.obj','instances':1,'matrixOffset':offset,'boundsOffset':offset+48,'material':0})
            chunks.extend([matrix.tobytes(),b.tobytes()]); offset+=72
        decisions=prune.object_decisions({'meshes':meshes,'materials':[{}]}, b''.join(chunks), box(0,0,100,100))
        self.assertEqual(list(decisions.values()), [None])

    def test_only_verified_city_card_matches(self):
        material={'tex':'Tarkov_city_Background_Plane_D__sharedassets23_125'}
        self.assertTrue(prune.backdrop_card({'name':'Tarkov_city_background_plane_LOD0__23_3_623.obj'},material))
        self.assertFalse(prune.backdrop_card({'name':'Terminal_ground_BG_LOD0.obj'},material))
        self.assertFalse(prune.backdrop_card({'name':'Tarkov_city_background_plane_LOD0__23_3_623.obj'},{}))

    def test_invalid_bounds_fail_closed(self):
        with self.assertRaises(ValueError):keep_instances([[0,0,0,float('nan'),1,1]], box(0,0,1,1))
        with self.assertRaises(ValueError):keep_instances([[2,0,0,1,1,1]], box(0,0,1,1))

    def test_face_selection_keeps_containing_and_vertical_triangles(self):
        vertices=np.asarray([[-10,0,-10],[20,0,-10],[5,0,20],  # covers entire protected square
                             [20,0,20],[30,0,20],[25,0,30],  # entirely outside
                             [2,0,2],[2,10,2],[8,0,2],     # vertical wall
                             [-10,0,8],[8,0,-10],[-10,0,-10]]) # bbox overlap but triangle outside
        mask=faces_in_area(vertices,np.arange(12).reshape(-1,3),box(0,0,10,10))
        np.testing.assert_array_equal(mask,[True,False,True,False])

    def test_source_face_ranges_keep_gaps(self):
        self.assertEqual(prune.face_ranges([0,1,4,7,8,9],20),[[20,22],[24,25],[27,30]])

    def test_coarse_ground_is_cut_exactly_with_height_and_uv_continuity(self):
        # A sloped 100 x 100 m quad made of only two triangles, clipped to 10 x 10.
        positions=np.asarray([[-50,-25,-50],[50,25,-50],[50,25,50],[-50,-25,50]],dtype='<f4')
        uvs=positions[:,[0,2]]/10
        paint=np.tile([200,55,0,255],(4,1)).astype('u1')
        result=clip_ground(positions,uvs,paint,np.array([[0,1,2],[0,2,3]]),np.eye(4)[:3],box(-5,-5,5,5))
        self.assertIsNotNone(result)
        vertices=result['positions'];self.assertTrue((abs(vertices[:,[0,2]])<=5.0001).all())
        np.testing.assert_allclose(vertices[:,1],vertices[:,0]/2,atol=1e-5)
        np.testing.assert_allclose(result['uvs'],vertices[:,[0,2]]/10,atol=1e-5)
        tri=vertices[result['indices'].reshape(-1,3)][:,:,[0,2]]
        a=tri[:,1]-tri[:,0];b=tri[:,2]-tri[:,0]
        self.assertAlmostEqual(float(abs(a[:,0]*b[:,1]-a[:,1]*b[:,0]).sum()/2),100,places=4)
        self.assertTrue((a[:,0]*b[:,1]-a[:,1]*b[:,0]>0).all())

    def test_ground_clip_preserves_polygon_holes(self):
        positions=np.asarray([[-10,0,-10],[20,0,-10],[5,0,20]],dtype='<f4')
        area=box(0,0,10,10).difference(box(4,4,6,6))
        result=clip_ground(positions,positions[:,[0,2]],np.ones((3,4),dtype='u1')*255,np.array([[0,1,2]]),np.eye(4)[:3],area)
        triangles=result['positions'][result['indices'].reshape(-1,3)][:,:,[0,2]]
        import shapely
        union=shapely.union_all(shapely.polygons(triangles))
        self.assertLess(union.symmetric_difference(area).area,1e-5)

    def test_nearly_vertical_skirt_does_not_create_extrapolated_vertices(self):
        positions=np.asarray([[0,0,0],[100,100,1e-6],[100,200,1.01e-6]],dtype='<f4')
        result=clip_ground(positions,np.array([[0,0],[1,0],[1,1]],dtype='<f4'),np.ones((3,4),dtype='u1')*255,np.array([[0,1,2]]),np.eye(4)[:3],box(50,-1,60,1))
        np.testing.assert_array_equal(result['positions'],positions)
        self.assertEqual(result['boundarySourceFaces'],[])


if __name__ == '__main__':unittest.main(verbosity=2)
