"""Boundary-conforming, volume-preserving reconstruction of recorded FLIP meshes.
No time integration or invented waves. Keep free-surface detail; fit contact
surfaces to the same analytic vessel wall used by the solver.
"""
from pathlib import Path
import argparse,json,gzip,hashlib,sys
import numpy as np
p=argparse.ArgumentParser();p.add_argument('build',type=Path,nargs='?');p.add_argument('--source',type=Path);p.add_argument('--out',type=Path);p.add_argument('--max-shift',type=float,default=2.5);a=p.parse_args()
src=a.source or a.build/'fluid-v3-hires';out=a.out or a.build/'fluid-v4-contact';out.mkdir(parents=True,exist_ok=True)
m=json.loads((src/'manifest.json').read_text());worst=0;shift_max=0
def volume(p):
 t=p.reshape(-1,3,3);return abs(np.einsum('ij,ij->i',t[:,0],np.cross(t[:,1],t[:,2])).sum()/6)
def project_cavity(p):
 q=np.abs(p)-np.array([16.5,17.5,19.5]);outside=np.maximum(q,0);norm=np.linalg.norm(outside,axis=1)
 sdf=norm+np.minimum(q.max(axis=1),0)-10
 gradient=outside/np.maximum(norm[:,None],1e-8)*np.sign(p)
 return p-np.maximum(sdf+.15,0)[:,None]*gradient
for item in m['frames']:
 raw=gzip.decompress((src/item['file']).read_bytes());count=item['count'];p=np.frombuffer(raw,dtype='<i2',count=count*3).reshape(-1,3).astype(float)/512;n=np.frombuffer(raw,dtype='<i2',offset=count*6).reshape(-1,3).astype(float)/32767
 source_volume=volume(p);original_volume=item['volume']['target']*1e9;q=np.abs(p)-np.array([16.5,17.5,19.5]);outside=np.maximum(q,0);norm=np.linalg.norm(outside,axis=1);sdf=norm+np.minimum(q.max(axis=1),0)-10
 wall=outside/np.maximum(norm[:,None],1e-8)*np.sign(p)
 align=np.einsum('ij,ij->i',wall,n);weight=np.clip((sdf+2.0)/.8,0,1)*np.clip((align-.45)/.35,0,1)
 # Never fit the wet interior onto a top wall above the free surface.
 weight[(wall[:,2]>.45)]=0
 p=project_cavity(p)
 n=n*(1-weight[:,None])+wall*weight[:,None];n/=np.linalg.norm(n,axis=1)[:,None]
 # Spread the volume correction over tilted free surfaces as well as flat
 # caps. A fourth power concentrates it into spikes on longer slosh runs.
 free=np.maximum(n[:,2],0)*(1-weight)
 shift=0
 for _ in range(20):
  v=volume(p)
  if abs(v/original_volume-1)<1e-8:break
  trial=p.copy();trial[:,2]+=.01*free;trial=project_cavity(trial);derivative=(volume(trial)-v)/.01
  if abs(derivative)<1e-6:break
  dz=np.clip((original_volume-v)/derivative,-.75,.75);p[:,2]+=dz*free;p=project_cavity(p);shift+=dz
 error=abs(volume(p)/original_volume-1);worst=max(worst,error);shift_max=max(shift_max,abs(shift))
 assert error<.0001 and abs(shift)<a.max_shift, json.dumps({'frame':item['file'],'volumeError':error,'freeShiftMM':shift})
 # Recompute smooth normals from the final constrained surface. Retaining
 # pre-fit normals makes the liquid highlights disagree with its new boundary.
 t=p.reshape(-1,3,3);faces=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);_,welded=np.unique(np.round(p*512).astype(np.int16),axis=0,return_inverse=True)
 summed=np.zeros((welded.max()+1,3));np.add.at(summed,welded,np.repeat(faces,3,axis=0));smooth=summed[welded];length=np.linalg.norm(smooth,axis=1)
 n=np.where((length>1e-12)[:,None],smooth/np.maximum(length[:,None],1e-12),n)
 packed=gzip.compress(np.round(p*512).astype('<i2').tobytes()+np.round(n*32767).astype('<i2').tobytes(),compresslevel=9,mtime=0)
 (out/item['file']).write_bytes(packed);item.update(bytes=len(packed),sha256=hashlib.sha256(packed).hexdigest());item['contact_reconstruction']={'relative_target_volume_error':error,'relative_volume_change':volume(p)/source_volume-1,'free_surface_correction_mm':shift}
m['reconstruction']='Recorded FLIP mesh constrained to the analytic vessel cavity; free surface corrected to physical particle-volume target and normals recomputed; original solver unchanged.'
(out/'manifest.json').write_text(json.dumps(m));print(json.dumps({'frames':len(m['frames']),'max_volume_change':worst,'max_free_surface_correction_mm':shift_max,'out':str(out)}))
