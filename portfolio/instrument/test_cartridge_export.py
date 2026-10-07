"""Small exporter gates: UV/material directives must follow emitted primitives."""
import io,unittest
import numpy as np
from bake_light_path import triangles

class ExportTests(unittest.TestCase):
    def test_streamed_transform_and_chunk_boundaries_are_equivalent(self):
        rng=np.random.default_rng(42);p=rng.normal(size=(33000,3)).astype('float32')
        n=(rng.uniform(-1,1,size=p.shape)*32767).astype('int16');f=np.arange(len(p)).reshape(-1,3)
        f[1023]=f[1024]=f[8191]=[0,0,0]
        uv=rng.random((len(p),2));colors=rng.random(p.shape);parameters=rng.random(p.shape)
        a=io.StringIO();b=io.StringIO();shift=245.123456
        transformed=p.astype(float);transformed[:,0]+=shift
        ra=triangles(a,transformed,f,n.astype(float)/32767,9,3,17,uv,colors,parameters,chunk_size=8192)
        rb=triangles(b,p,f,n,9,3,17,uv,colors,parameters,position_offset=shift,normal_scale=32767)
        self.assertEqual(ra,rb)
        # Directive order between batches may change, not primitive order or data.
        for directive in ('triangle ','surface_uv ','surface_material '):
            self.assertEqual([s for s in a.getvalue().splitlines() if s.startswith(directive)],
                             [s for s in b.getvalue().splitlines() if s.startswith(directive)])
    def test_degenerate_faces_do_not_shift_attributes(self):
        stream=io.StringIO();p=np.array([[0,0,0],[1,0,0],[0,1,0.]])
        n=np.tile([0,0,1.],(3,1));uv=p[:,:2];colors=np.full((3,3),.4);parameters=np.tile([.7,1.45,0.],(3,1))
        r=triangles(stream,p,np.array([[0,0,0],[0,1,2]]),n,9,3,primitive=17,uv=uv,colors=colors,parameters=parameters)
        rows=stream.getvalue().splitlines()
        self.assertEqual(r['exported'],1);self.assertEqual(r['nextPrimitive'],18)
        self.assertEqual([x.split()[0] for x in rows],['triangle','surface_uv','surface_material'])
        self.assertEqual(rows[1].split()[1],'17');self.assertEqual(rows[2].split()[1],'17')
        self.assertEqual(len(rows[1].split()),11);self.assertEqual(len(rows[2].split()),20)
    def test_plain_following_mesh_advances_primitive(self):
        p=np.array([[0,0,0],[1,0,0],[0,1,0.]])
        r=triangles(io.StringIO(),p,np.array([[0,1,2]]),np.tile([0,0,1.],(3,1)),0,2,primitive=18)
        self.assertEqual(r['nextPrimitive'],19)

if __name__=='__main__':unittest.main()
