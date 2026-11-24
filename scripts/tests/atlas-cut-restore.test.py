import copy,json,sys,unittest
from pathlib import Path
import shapely
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lib.atlas_cut_restore import subtract_preservation, ensure_only_restores, restore_recipe, polygon


def volume(x0,z0,x1,z1,low=-10,high=10):
    return {'polygon':[{'x':x0,'z':z0},{'x':x1,'z':z0},{'x':x1,'z':z1},{'x':x0,'z':z1}],'minY':low,'maxY':high}


def cut(v):
    return {'id':'cut-1','operation':'review-and-prune-intersecting-geometry','volume':v}


class RestoreTests(unittest.TestCase):
    def test_basement_hole_preserves_upper_removal_and_exact_footprint(self):
        original=cut(volume(0,0,10,10)); keep=volume(2,2,8,8,-5,0)
        result=subtract_preservation(original,keep);ensure_only_restores([original],result)
        for y,area in [(-7,100),(-2,64),(2,100)]:
            shape=shapely.union_all([polygon(c['volume']) for c in result if c['volume']['minY']<y<c['volume']['maxY']])
            self.assertAlmostEqual(shape.area,area)
            if y==-2:self.assertAlmostEqual(shape.intersection(polygon(keep)).area,0)

    def test_restoration_does_not_touch_nonoverlapping_cut(self):
        original=cut(volume(0,0,1,1));self.assertEqual(subtract_preservation(original,volume(4,4,5,5)),[original])

    def test_boundary_shrink_and_no_input_mutation(self):
        old=volume(0,0,10,10);new=volume(1,0,10,10)
        effective={'exclusions':[cut(old)]};latest={'map':'factory','source':{'geometrySha256':'current'},'exclusions':[cut(new)]}
        plan={'map':'factory','operation':'restore-reviewed-boundaries','reviewedGeometrySha256':'current','replacements':[{'cutId':'cut-1','previousPolygon':old['polygon'],'replacementPolygon':new['polygon']}]}
        snapshot=copy.deepcopy(effective);result=restore_recipe(effective,latest,plan)
        self.assertEqual(effective,snapshot);self.assertEqual(polygon(result['exclusions'][0]['volume']).area,90)
        plan['reviewedGeometrySha256']='wrong'
        with self.assertRaises(ValueError):restore_recipe(effective,latest,plan)

    def test_rejects_new_removals_at_any_height(self):
        with self.assertRaises(ValueError):ensure_only_restores([cut(volume(0,0,1,1))],[cut(volume(0,0,2,1))])

    def test_basement_boundary_shift_does_not_restore_above_ground_scenery(self):
        old=volume(0,0,10,10);new=volume(1,0,10,10)
        effective={'exclusions':[cut(old),cut(new)]}
        latest={'map':'factory','source':{'geometrySha256':'current'},'exclusions':[cut(new)]}
        plan={'map':'factory','operation':'restore-reviewed-boundaries','reviewedGeometrySha256':'current','replacements':[{'cutId':'cut-1','previousPolygon':old['polygon'],'replacementPolygon':new['polygon'],'heightRange':[-5,0]}]}
        result=restore_recipe(effective,latest,plan)
        for y,area in [(-7,100),(-2,90),(2,100)]:
            shape=shapely.union_all([polygon(c['volume']) for c in result['exclusions'] if c['volume']['minY']<y<c['volume']['maxY']])
            self.assertAlmostEqual(shape.area,area)


if __name__=='__main__':unittest.main(verbosity=2)
