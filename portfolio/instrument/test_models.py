"""Checks for the specific shape regressions raised in the reference review."""
from pathlib import Path
import sys, unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-geo/src'))
from mechanism_lab.core import load_cache,validate
FOLDER=Path('D:/CYBR-build/exploded-instrument/geometry-v4')

class ReferenceShapeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.models={n:load_cache(FOLDER/n) for n in ('geo','light','elements','song','combat','scenes')}
    def test_all_named_parts_validate(self):
        for name,model in self.models.items():
            report=validate(model)
            self.assertTrue(all(p['finite'] and p['valid_indices'] for p in report['checks']),name)
            self.assertTrue(all(p.get('analytic_valid') in (None,True) for p in report['checks']),name)
    def test_water_has_headspace_and_surface(self):
        model=self.models['elements']
        water=next(p for p in model.parts if 'water_with_free_surface' in p.name)
        self.assertLess(water.bounds[1,2],17)
        self.assertLess(water.bounds[0,2],-28)
        self.assertGreater(model.bounds[1,2]-water.bounds[1,2],15)
    def test_cymbals_are_dished_not_flat_washers(self):
        cymbals=[p for p in self.models['song'].parts if 'dished_cymbal' in p.name]
        self.assertEqual(len(cymbals),3)
        for part in cymbals:self.assertGreater(np.ptp(part.vertices[:,0]),4)
    def test_one_slack_internal_cable(self):
        cables=[p for p in self.models['elements'].parts if 'jacket' in p.name]
        self.assertEqual(len(cables),1)
        self.assertGreater(np.ptp(cables[0].vertices[:,2]),10)
    def test_claw_has_paired_tapered_links(self):
        links=[p for p in self.models['combat'].parts if '_cheek_' in p.name]
        self.assertEqual(len(links),18)
    def test_core_uses_bowed_struts_and_branched_seams(self):
        names=[p.name for p in self.models['scenes'].parts]
        self.assertEqual(sum('cage_bowed_strut' in n for n in names),6)
        self.assertGreaterEqual(sum('mineral_branch' in n for n in names),28)
        self.assertTrue(any('faceted_obsidian_core' in n for n in names))
    def test_geo_has_knurled_machining_band(self):
        self.assertEqual(sum('__knurl_' in p.name for p in self.models['geo'].parts),120)
    def test_optical_service_passage_is_axial(self):
        parts=self.models['light'].parts
        self.assertFalse(any('optical_black_backing' in p.name for p in parts))
        self.assertEqual(sum('axial_cable_gland' in p.name for p in parts),2)
        self.assertTrue(any('optical_service_sleeve' in p.name for p in parts))
    def test_all_modules_have_internal_cable_or_takeup(self):
        for name,model in self.models.items():
            self.assertTrue(any('cable' in p.name or 'takeup' in p.name for p in model.parts),name)

if __name__=='__main__':unittest.main()
