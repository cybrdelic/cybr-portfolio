"""Small deterministic checks; no renders or bulk workspace outputs."""
import unittest
from types import SimpleNamespace
import numpy as np
from metal_finish import machining_uv


class MachiningTests(unittest.TestCase):
    def test_barrel_tangent_follows_circumference(self):
        theta = np.array([-.15, .15, -.15])
        v = np.column_stack(([0, 0, 4], 10*np.cos(theta), 10*np.sin(theta)))
        # Extra bounds vertices keep the known part centre on the shaft.
        vertices = np.vstack((v, [-4,-10,-10], [4,10,10]))
        p = SimpleNamespace(vertices=vertices, faces=np.array([[0,1,2]]),
                            normals=np.tile([0,1,0],(5,1)))
        uv = machining_uv(p).reshape(3,3)
        self.assertAlmostEqual(uv[0,1],uv[1,1])
        self.assertGreater(uv[1,0],uv[0,0])
        self.assertGreater(uv[2,1],uv[0,1])

    def test_angular_seam_is_local(self):
        theta = np.array([-3.13, 3.13, -3.12])
        vertices = np.column_stack(([0,0,1],10*np.cos(theta),10*np.sin(theta)))
        vertices=np.vstack((vertices,[-1,-10,-10],[1,10,10]))
        p=SimpleNamespace(vertices=vertices,faces=np.array([[0,1,2]]),normals=np.tile([0,-1,0],(5,1)))
        uv=machining_uv(p).reshape(3,3)
        self.assertLess(np.ptp(uv[:,0]),.02)


if __name__ == '__main__':
    unittest.main()
