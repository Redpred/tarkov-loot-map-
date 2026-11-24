"""Check exported sectors without loading the whole map in RAM; --map selects a map."""
import hashlib,json,unittest,sys,re
from collections import Counter
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
MAP='streets'
if '--map' in sys.argv:
    i=sys.argv.index('--map');MAP=sys.argv[i+1];del sys.argv[i:i+2]
if not re.fullmatch('[a-z_]+',MAP):raise ValueError('Invalid map')
BASE=ROOT/'site/data/atlas'/MAP
if '--directory' in sys.argv:
    i=sys.argv.index('--directory');BASE=Path(sys.argv[i+1]);del sys.argv[i:i+2]

class AtlasSectors(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index=json.loads((BASE/f'{MAP}-sectors.json').read_text(encoding='utf-8'))
        cls.source=json.loads((BASE/f'{MAP}-geometry.json').read_text(encoding='utf-8'))
        cls.binary=np.memmap(BASE/cls.source['binary'],dtype=np.uint8,mode='r')

    def test_original_scene_ownership_and_world_matrices(self):
        file=ROOT/'work/atlas-assets'/MAP/'scene.json'
        with file.open('rb') as f:self.assertEqual(hashlib.file_digest(f,'sha256').hexdigest(),self.source['sceneSha256'])
        scene=json.loads(file.read_text(encoding='utf-8'));matrices={}
        for row in scene['instances']:
            if row.get('kind')=='mesh' and not row.get('wlayer'):
                self.assertEqual(row.get('rendererSource'),f"level{row['lv']}")
            matrices.setdefault(row['mesh'],set()).add(np.asarray(row['m'],dtype='<f4').reshape(4,4)[:3].tobytes())
        for m in self.source['meshes']:
            exported=np.ndarray((m['instances'],12),'<f4',buffer=self.binary,offset=m['matrixOffset'])
            for matrix in exported:self.assertIn(matrix.tobytes(),matrices[m['name']])

    def test_partitions_preserve_all_original_instance_matrices_and_geometry(self):
        expected=Counter();source={}
        for m in self.source['meshes']:
            key=(m['name'],m['material'],m['sourceFaceStart'],m['sourceFaceCount'],m.get('cropVariant'));source[key]=m
            matrices=np.ndarray((m['instances'],12),'<f4',buffer=self.binary,offset=m['matrixOffset'])
            expected.update((key,row.tobytes()) for row in matrices)
        seen=Counter();n=0
        for sector in self.index['sectors']:
            detail=json.loads((BASE/sector['file']).read_text(encoding='utf-8'))
            file=BASE/sector['binary']
            with file.open('rb') as f:self.assertEqual(hashlib.file_digest(f,'sha256').hexdigest(),sector['sha256'])
            self.assertEqual(file.stat().st_size,sector['stats']['bytes'])
            data=np.memmap(file,dtype=np.uint8,mode='r');end=0
            for m in detail['meshes']:
                key=(m['name'],m['material'],m['sourceFaceStart'],m['sourceFaceCount'],m.get('cropVariant'));original=source[key]
                self.assertEqual(m['positionOffset'],end)
                self.assertTrue(all(name.startswith('level') for name in m['rendererSources']))
                for attr,length in [('positionOffset',m['vertices']*12),('uvOffset',m['vertices']*8),('paintOffset',m['vertices']*4),('indexOffset',m['indices']*4)]:
                    np.testing.assert_array_equal(data[m[attr]:m[attr]+length],self.binary[original[attr]:original[attr]+length])
                matrices=np.ndarray((m['instances'],12),'<f4',buffer=data,offset=m['matrixOffset'])
                boxes=np.ndarray((m['instances'],6),'<f4',buffer=data,offset=m['boundsOffset'])
                self.assertTrue(np.isfinite(matrices).all());self.assertTrue(np.all(boxes[:,:3]<=boxes[:,3:]))
                self.assertTrue(np.all(boxes[:,:3]>=np.asarray(sector['bounds']['min'])-.001))
                self.assertTrue(np.all(boxes[:,3:]<=np.asarray(sector['bounds']['max'])+.001))
                seen.update((key,row.tobytes()) for row in matrices);n+=m['instances']
                end=m['boundsOffset']+m['instances']*24
            self.assertEqual(end,len(data))
        self.assertEqual(seen,expected)
        self.assertEqual(n,self.source['stats']['exportedInstances'])

    def test_materials_and_textures_are_complete(self):
        for sector in self.index['sectors']:
            for mid in sector['materialIds']:
                m=self.index['materials'][mid]
                for name in [m.get('tex'),m.get('emis'),(m.get('vp') or {}).get('heights')]+[l.get('tex') for l in (m.get('vp') or {}).get('layers',[])]:
                    if name:self.assertIn(name,self.index['textures'])
        for t in self.index['textures'].values():
            file=BASE/t['file']
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),t['sha256'])
            with Image.open(file) as image:self.assertEqual(list(image.size),t['size'])

if __name__=='__main__':unittest.main(verbosity=2)
