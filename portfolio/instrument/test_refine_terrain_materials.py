"""Physical material-footprint gates, independent of CAD topology generation."""
import hashlib
import unittest
import numpy as np
from refine_terrain_materials import integrate_albedo


class MineralFootprintTests(unittest.TestCase):
    def test_resolves_subpixel_grit_and_retains_broad_mineral_staining(self):
        x, y = np.meshgrid(np.arange(121)*.1, np.arange(61)*.1)
        vertices = np.column_stack((x.ravel(),y.ravel(),np.zeros(x.size)))
        broad = .12*np.sin(vertices[:,0]*np.pi/6)
        fine = np.where((np.round(vertices[:,0]*10)+np.round(vertices[:,1]*10))%2, .09, -.09)
        source = np.tile((.35+broad+fine)[:,None],(1,3))
        before = hashlib.sha256(vertices.tobytes()).hexdigest()
        result, _ = integrate_albedo(vertices,source)
        interior = (vertices[:,0]>1)&(vertices[:,0]<11)&(vertices[:,1]>1)&(vertices[:,1]<5)
        residual = result[:,0]-(.35+broad)
        self.assertLess(np.sqrt(np.mean(residual[interior]**2)), .025)
        high = interior&(vertices[:,0]>2)&(vertices[:,0]<4)
        low = interior&(vertices[:,0]>8)&(vertices[:,0]<10)
        expected = broad[high].mean()-broad[low].mean()
        self.assertGreater((result[high,0].mean()-result[low,0].mean())/expected,.94)
        self.assertEqual(hashlib.sha256(vertices.tobytes()).hexdigest(),before)

    def test_constant_mineral_palette_and_sampling_density_are_preserved(self):
        x,y = np.meshgrid(np.arange(21)*.1,np.arange(21)*.1)
        vertices = np.column_stack((x.ravel(),y.ravel(),np.zeros(x.size)))
        constant = np.tile([.2,.4,.6],(len(vertices),1))
        result,_ = integrate_albedo(vertices,constant)
        np.testing.assert_allclose(result,constant,rtol=0,atol=3e-8)
        color = np.tile((.25+.1*vertices[:,0])[:,None],(1,3))
        base,_ = integrate_albedo(vertices,color)
        extra = vertices[:,0]<.7
        duplicate_v = np.concatenate([vertices]+[vertices[extra]]*5)
        duplicate_c = np.concatenate([color]+[color[extra]]*5)
        dense,_ = integrate_albedo(duplicate_v,duplicate_c)
        np.testing.assert_allclose(base,dense[:len(vertices)],rtol=0,atol=1e-7)

    def test_invalid_reflectance_and_footprint_fail_explicitly(self):
        v = np.zeros((3,3))
        with self.assertRaises(ValueError):integrate_albedo(v,np.full((3,3),1.1))
        with self.assertRaises(ValueError):integrate_albedo(v,np.full((3,3),.2),0)
        with self.assertRaises(ValueError):integrate_albedo(v,np.full((2,3),.2))


if __name__ == '__main__':unittest.main()
