"""Check whether dielectric triangle winding agrees with authored normals."""
from pathlib import Path
import gzip,json,numpy as np
root=Path(__file__).resolve().parents[1]/'assets'
m=json.loads((root/'instrument-3d/manifest.json').read_text())
raw=gzip.decompress((root/'instrument-3d/instrument.bin.gz').read_bytes())
def attr(s,w):
    return np.frombuffer(raw,dtype=s['dtype'],offset=s['offset'],count=s['count']).reshape(-1,w)
def report(name,p,n):
    cross=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0])
    area=np.linalg.norm(cross,axis=1)
    dot=(cross*n.mean(axis=1)).sum(axis=1)
    return {'name':name,'triangles':len(p),'reversed':int((dot<-1e-7).sum()),'degenerate':int((area<1e-7).sum())}
results=[]
for mesh in m['meshes']:
    if mesh['material']!=3:continue
    idx=attr(mesh['indices'],3)
    results.append(report(mesh['module'],attr(mesh['positions'],3)[idx],attr(mesh['normals'],3)[idx]/32767.))
fm=json.loads((root/'instrument-fluid/manifest.json').read_text())
for i in [0,24,71]:
    f=fm['frames'][i];b=gzip.decompress((root/'instrument-fluid'/f['file']).read_bytes());count=f['count']
    p=np.frombuffer(b,dtype='<i2',count=count*3).reshape(-1,3,3)/512.
    n=np.frombuffer(b,dtype='<i2',offset=count*6).reshape(-1,3,3)/32767.
    results.append(report('water-'+str(i),p,n))
print(json.dumps(results))
