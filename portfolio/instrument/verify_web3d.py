"""Small regression gate for packed normals, attributes and camera-independent materials."""
from pathlib import Path
import gzip,json,numpy as np
root=Path(__file__).resolve().parents[1]
folder=root/'assets/instrument-3d'
m=json.loads((folder/'manifest.json').read_text());raw=gzip.decompress((folder/'instrument.bin.gz').read_bytes())
def read(spec,width):
    return np.frombuffer(raw,dtype=spec['dtype'],count=spec['count'],offset=spec['offset']).reshape(-1,width)
bad=0;planar=0
for mesh in m['meshes']:
    v=read(mesh['positions'],3);n=read(mesh['normals'],3).astype(float)/32767
    f=read(mesh['indices'],3);uv=read(mesh['uv'],2);ao=read(mesh['occlusion'],1)
    assert len(v)==len(n)==len(uv)==len(ao)
    assert np.isfinite(v).all() and np.isfinite(n).all() and np.isfinite(uv).all()
    assert f.max()<len(v) and ao.min()>=0 and ao.max()<=1
    assert np.max(np.abs(np.linalg.norm(n,axis=1)-1))<.0001
    if mesh['module']=='geo' and mesh['material']==0:
        p=v[f];gn=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0])
        norm=np.linalg.norm(gn,axis=1);gn/=np.maximum(norm[:,None],1e-12)
        flat=(np.abs(gn[:,0])>.9999)&(norm>1e-5)
        dots=np.abs((n[f]*gn[:,None,:]).sum(2))
        planar+=int(flat.sum());bad+=int((flat&(dots.min(1)<.866)).sum())
assert bad==0,(planar,bad)
js=(root/'instrument-3d.js').read_text()
assert 'referenceBake' not in js and 'vReferenceUV' not in js and 'bakeWeight' not in js
assert '-surface.webp' not in js
print(json.dumps({'meshes':len(m['meshes']),'parts':m['stats']['sourceParts'],'geo_planar_triangles':planar,'corrupted_planar_normals':bad,'legacy_single_view_beauty_dependencies':0,'camera_path_bake_opt_in':'loadPathBake' in js,'geometry_bytes':m['stats']['geometryBytes']}))
