import json,subprocess,sys,tempfile,unittest
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[2]

class SectorSplitTests(unittest.TestCase):
    def test_spatial_split_preserves_negative_coordinates_uvs_and_instance_rows(self):
        with tempfile.TemporaryDirectory(prefix='sector-test-',dir=ROOT/'work') as tmp:
            directory=Path(tmp).resolve();self.assertEqual(directory.parent,(ROOT/'work').resolve())
            record={'name':'original.obj','vertices':3,'indices':3,'instances':3,'material':0,'sourceFaceStart':0,'sourceFaceCount':1,'rendererSources':['level214']}
            vertices=np.array([[0,0,0],[1,0,0],[0,1,1]],'<f4')
            uv=np.array([[0,0],[1,0],[0,1]],'<f4')
            matrices=np.array([[1,.2,0,-130,0,1,0,2,0,0,1,15],[1,0,0,10,0,1,0,2,0,0,1,15],[1,0,0,130,0,1,0,2,0,0,1,15]],'<f4')
            boxes=np.array([[-130,2,15,-128.8,3,16],[10,2,15,11,3,16],[130,2,15,131,3,16]],'<f4')
            with (directory/'streets-geometry.bin').open('wb') as f:
                for field,array in [('positionOffset',vertices),('uvOffset',uv),('paintOffset',np.ones((3,4),'u1')*255),('indexOffset',np.array([0,1,2],'<u4')),('matrixOffset',matrices),('boundsOffset',boxes)]:
                    record[field]=f.tell();f.write(array.tobytes())
            (directory/'streets-geometry.json').write_text(json.dumps({'binary':'streets-geometry.bin','sha256':'fixture','meshes':[record],'materials':[{}],'textures':{},'stats':{'exportedInstances':3}}))
            subprocess.run([sys.executable,str(ROOT/'scripts/split-atlas-sectors.py'),'--directory',tmp,'--size','96'],check=True,capture_output=True)
            index=json.loads((directory/'streets-sectors.json').read_text());self.assertEqual(len(index['sectors']),3)
            recovered=[]
            for sector in index['sectors']:
                detail=json.loads((directory/sector['file']).read_text());m=detail['meshes'][0];data=(directory/sector['binary']).read_bytes()
                np.testing.assert_array_equal(np.frombuffer(data,'<f4',9,m['positionOffset']).reshape(3,3),vertices)
                np.testing.assert_array_equal(np.frombuffer(data,'<f4',6,m['uvOffset']).reshape(3,2),uv)
                recovered.append(np.frombuffer(data,'<f4',12,m['matrixOffset']).tobytes())
            self.assertCountEqual(recovered,[m.tobytes() for m in matrices])

if __name__=='__main__':unittest.main(verbosity=2)
