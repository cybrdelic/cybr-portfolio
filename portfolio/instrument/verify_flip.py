"""Validate baked FLIP files; write only a compact summary to stdout."""
from pathlib import Path
import json,gzip,hashlib,sys,numpy as np
base=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'assets/instrument-fluid'
m=json.loads((base/'manifest.json').read_text());assert m['complete'] and len(m['frames'])>=2
hashes=set();max_error=0;max_violation=0;counts=set()
for f in m['frames']:
    raw=(base/f['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==f['sha256'];hashes.add(f['sha256'])
    b=gzip.decompress(raw);assert len(b)==f['count']*12 and f['count']>300
    p=np.frombuffer(b,dtype='<i2',count=f['count']*3).reshape(-1,3)/512
    n=np.frombuffer(b,dtype='<i2',offset=f['count']*6).reshape(-1,3)/32767
    assert np.isfinite(p).all() and np.max(np.abs(p))<34
    assert np.max(np.abs(np.linalg.norm(n,axis=1)-1))<.002
    assert f['finite'] and f['pressure']['converged'];counts.add(f['particles'])
    triangles=p.reshape(-1,3,3)
    actual_volume=abs(np.einsum('ij,ij->i',triangles[:,0],np.cross(triangles[:,1],triangles[:,2])).sum()/6)
    max_error=max(max_error,abs(actual_volume/(f['volume']['target']*1e9)-1));max_violation=max(max_violation,f['solidViolations'])
assert len(hashes)==len(m['frames']) and len(counts)==1 and max_violation==0 and max_error<.02
print(json.dumps({'frames':len(hashes),'distinct_meshes':len(hashes),'particles':counts.pop(),'max_surface_volume_error':max_error,'solid_violations':max_violation,'all_pressure_solves_converged':True,'compressed_bytes':sum(f['bytes'] for f in m['frames'])}))
