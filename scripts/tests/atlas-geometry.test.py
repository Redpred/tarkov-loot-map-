"""Validate the exported artifact against the extracted Unity scene (no game needed)."""
import hashlib
import json
import sys
import unittest
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'site/data/atlas'
if '--directory' in sys.argv:
    i = sys.argv.index('--directory'); BASE = Path(sys.argv[i + 1]); del sys.argv[i:i + 2]
DATASET = ROOT / 'work/atlas-assets/factory_rework'
sys.path.insert(0, str(ROOT / 'work/atlas/eft_pipeline'))
from tarkmap_core.objio import load_obj
from geometry_provenance import assert_interpolated_triangles


class AtlasArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((BASE / 'factory-geometry.json').read_text(encoding='utf-8'))
        cls.binary = (BASE / 'factory-geometry.bin').read_bytes()
        cls.scene_bytes = (DATASET / 'scene.json').read_bytes()
        cls.scene = json.loads(cls.scene_bytes)

    def test_renderers_belong_to_real_scene_files_not_dependency_prefabs(self):
        for row in self.scene['instances']:
            if row.get('kind')=='mesh' and not row.get('wlayer'):
                self.assertEqual(row.get('rendererSource'),f"level{row['lv']}")
                self.assertGreater(row['rendererPathId'],0)
                self.assertGreater(row['gameObjectPathId'],0)
        # This client has no BTR renderer in level527. The former export included
        # 1,297 BTR parts from dependencies and placed them at colliding local IDs.
        self.assertEqual(sum('BTR_' in row['mesh'] for row in self.scene['instances'] if row['lv']==527),0)

    def test_integrity_indices_and_original_world_matrices(self):
        m = self.manifest
        self.assertEqual(hashlib.sha256(self.binary).hexdigest(), m['sha256'])
        self.assertEqual(hashlib.sha256(self.scene_bytes).hexdigest(), m['sceneSha256'])
        source_matrices = {}
        for row in self.scene['instances']:
            matrix = np.asarray(row['m'], dtype='<f4').reshape(4, 4)[:3]
            source_matrices.setdefault(row['mesh'], set()).add(matrix.tobytes())
        end = instances = triangles = 0
        for mesh in m['meshes']:
            self.assertEqual(mesh['positionOffset'], end)
            vertices = np.frombuffer(self.binary, '<f4', mesh['vertices'] * 3, mesh['positionOffset']).reshape(-1, 3)
            uv = np.frombuffer(self.binary, '<f4', mesh['vertices'] * 2, mesh['uvOffset']).reshape(-1, 2)
            self.assertTrue(np.isfinite(uv).all())
            self.assertGreaterEqual(mesh['material'],0)
            self.assertLess(mesh['material'],len(m['materials']))
            indices = np.frombuffer(self.binary, '<u4', mesh['indices'], mesh['indexOffset'])
            matrices = np.frombuffer(self.binary, '<f4', mesh['instances'] * 12, mesh['matrixOffset']).reshape(-1, 3, 4)
            boxes = np.frombuffer(self.binary, '<f4', mesh['instances'] * 6, mesh['boundsOffset']).reshape(-1, 6)
            self.assertTrue(np.isfinite(vertices).all())
            self.assertTrue(np.isfinite(matrices).all())
            self.assertLess(int(indices.max()), len(vertices))
            self.assertTrue(np.all(boxes[:, :3] <= boxes[:, 3:]))
            for matrix in matrices:
                # Full matrix comparison catches transpose, wrong X flip, lost shear or fitted offsets.
                self.assertIn(matrix.tobytes(), source_matrices[mesh['name']])
            end = mesh['boundsOffset'] + mesh['instances'] * 6 * 4
            instances += mesh['instances']
            triangles += mesh['indices'] // 3 * mesh['instances']
        self.assertEqual(end, len(self.binary))
        self.assertEqual(instances, m['stats']['exportedInstances'])
        self.assertEqual(triangles, m['stats']['instancedTriangles'])

    def test_sampled_vertices_keep_source_shape_and_undo_obj_x_flip(self):
        meshes = self.manifest['meshes']
        for index in np.linspace(0, len(meshes) - 1, 16, dtype=int):
            mesh = meshes[index]
            source, uvs, faces = load_obj(str(DATASET), mesh['name'])
            source = np.asarray(source, dtype=np.float32).copy()
            source[:, 0] *= -1
            source_points = {tuple(p) for p in source}
            exported = np.frombuffer(self.binary, '<f4', mesh['vertices'] * 3, mesh['positionOffset']).reshape(-1, 3)
            if mesh.get('surfaceClip') or mesh.get('groundClip'):
                clip=mesh.get('surfaceClip') or mesh['groundClip']
                whole=np.concatenate([np.arange(a,b) for a,b in clip['wholeFaceRanges']]) if clip['wholeFaceRanges'] else np.array([],dtype=int)
                source_ids=np.r_[whole,clip['boundarySourceFaces']].astype(int)
                original_faces=faces[source_ids]
                original_uv=uvs[np.clip(original_faces[:,:,1],0,len(uvs)-1)].copy()
                original_uv[original_faces[:,:,1]<0]=0
                indices=np.frombuffer(self.binary,'<u4',mesh['indices'],mesh['indexOffset']).reshape(-1,3)
                uv=np.frombuffer(self.binary,'<f4',mesh['vertices']*2,mesh['uvOffset']).reshape(-1,2)
                np.testing.assert_array_equal(exported[indices[:len(whole)]],source[original_faces[:len(whole),:,0]])
                np.testing.assert_array_equal(uv[indices[:len(whole)]],original_uv[:len(whole)])
                assert_interpolated_triangles(self,source[original_faces[len(whole):,:,0]].astype(float),original_uv[len(whole):].astype(float),exported[indices[len(whole):]].astype(float),uv[indices[len(whole):]].astype(float))
                continue
            for point in exported:
                self.assertIn(tuple(point), source_points)
            # Compare position/UV pairs and face connectivity, including UV seams and submesh spans.
            face_start=mesh['sourceFaceStart']
            selected=(np.concatenate([faces[a:b] for a,b in mesh['sourceFaceRanges']])
                      if mesh.get('sourceFaceRanges') else faces[face_start:face_start+mesh['sourceFaceCount']])
            pairs,inverse=np.unique(selected.reshape(-1,2),axis=0,return_inverse=True)
            expected_uv=uvs[np.clip(pairs[:,1],0,len(uvs)-1)].copy()
            expected_uv[pairs[:,1]<0]=0
            uv=np.frombuffer(self.binary,'<f4',mesh['vertices']*2,mesh['uvOffset']).reshape(-1,2)
            indices=np.frombuffer(self.binary,'<u4',mesh['indices'],mesh['indexOffset'])
            np.testing.assert_array_equal(uv,expected_uv)
            np.testing.assert_array_equal(exported,source[pairs[:,0]])
            np.testing.assert_array_equal(indices,inverse)

    def test_texture_files_and_source_material_bindings(self):
        for texture in self.manifest['textures'].values():
            path=BASE/texture['file']
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),texture['sha256'])
            with Image.open(path) as im:
                self.assertEqual(list(im.size),texture['size'])
                self.assertLessEqual(max(im.size),self.manifest['textureMaxSize'])
        for material in self.manifest['materials']:
            if material.get('tex'):
                self.assertIn(material['tex'],self.manifest['textures'])
            for layer in (material.get('vp') or {}).get('layers',[]):
                if layer.get('tex'):
                    self.assertIn(layer['tex'],self.manifest['textures'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
