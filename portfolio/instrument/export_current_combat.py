"""Freeze the active CONTACT model/rig, not the archived armored proof."""
from pathlib import Path
import json,gzip,hashlib,argparse,subprocess
import numpy as np
import trimesh
from scipy.spatial import cKDTree

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--frame',type=int);parser.add_argument('--name',default='combat-current');args=parser.parse_args()
if not args.name.replace('-','').replace('_','').isalnum():raise ValueError('Output name must be a simple asset basename')
source=ROOT/'cybr-combat/preview';out=ROOT/'portfolio/assets/display-modules'
doc=json.loads((source/'scene.json').read_text());raw=(source/'geometry.bin').read_bytes()
def read(s):return np.frombuffer(raw,s['dtype'],s['bytes']//4,s['offset']).reshape(s['shape']).copy()
take=next(s for s in doc['sequence'] if s[2]=='Original / step-in cross')
frame_index=args.frame if args.frame is not None else round(take[0]*doc['fps'])+20
assert round(take[0]*doc['fps'])<=frame_index<round(take[1]*doc['fps'])
frame=doc['frames'][frame_index];meshes=[]
cloth_path=out/(args.name+'-cloth.json')
subprocess.run(['C:/nvm4w/nodejs/node.exe',str(Path(__file__).with_name('bake_combat_cloth.cjs')),str(frame_index),str(cloth_path)],check=True)
cloth=json.loads(cloth_path.read_text())
for m in doc['meshes']:
    if m.get('model')!='male':continue
    p=read(m['position']);n=read(m['normal'])
    joints=read(m['joints']).astype(int);weights=read(m['weights'])
    skin=read(frame['skins'][m['skin']]).transpose(0,2,1)
    matrix=(skin[joints]*weights[:,:,None,None]).sum(1)
    p=np.einsum('nij,nj->ni',matrix[:,:3,:3],p)+matrix[:,:3,3]
    n=np.einsum('nij,nj->ni',matrix[:,:3,:3],n);n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-8)
    if 'cloth' in m:
        delta=np.asarray(cloth['cages'][m['cloth']]).reshape(-1,4)[:,:3]
        p+=(delta[read(m['clothIds']).astype(int)]*read(m['clothWeights'])[:,:,None]).sum(1)
    meshes.append(dict(name=m['part'],material=m['material'],position=p,normal=n,uv=read(m['uv']),index=read(m['index']).ravel()))
assert {'body','shirt','shorts'}<=set(m['name'] for m in meshes)
# The source's coarse cloth capsules permit body penetration. Fit only the
# frozen portfolio copy against the actual posed body, preserving the source.
body=next(m for m in meshes if m['name']=='body')
collider=trimesh.Trimesh(body['position'],body['index'].reshape(-1,3),process=False)
body_triangles=collider.triangles;body_tree=cKDTree(body_triangles.mean(1))
fit=[]
for m in meshes:
    if m['name']=='body':continue
    p=m['position'];changed=0;maximum=0.
    for start in range(0,len(p),256):
        points=p[start:start+256]
        candidates=body_tree.query(points,k=32)[1]
        projected=trimesh.triangles.closest_point(body_triangles[candidates].reshape(-1,3,3),np.repeat(points,32,axis=0)).reshape(-1,32,3)
        distances=np.linalg.norm(projected-points[:,None,:],axis=2);best=distances.argmin(1);row=np.arange(len(points))
        nearest=projected[row,best];distance=distances[row,best];ids=candidates[row,best]
        normal=collider.face_normals[ids]
        signed=np.sum((points-nearest)*normal,axis=1)
        depth=np.maximum(.0025-signed,0)
        valid=(depth>0)&(distance<.06)
        if np.any(valid):
            correction=normal[valid]*depth[valid,None]
            points[valid]+=correction;changed+=int(valid.sum());maximum=max(maximum,float(depth[valid].max()))
    faces=m['index'].reshape(-1,3)
    m['normal']=np.asarray(trimesh.Trimesh(p,faces,process=False).vertex_normals)
    fit.append(dict(part=m['name'],material=m['material'],adjustedVertices=changed,maxSourceDisplacement=maximum))
points=np.concatenate([m['position'] for m in meshes]);lo=points.min(0);hi=points.max(0);center=(lo+hi)*.5;center[1]=lo[1]
scale=2.65/(hi[1]-lo[1]);chunks=[];offset=0;records=[]
for m in meshes:
    m['position']=(m['position']-center)*scale+np.array([0,.025,0])
    rec={k:v for k,v in m.items() if not isinstance(v,np.ndarray)}
    for key,a in m.items():
        if not isinstance(a,np.ndarray):continue
        a=np.ascontiguousarray(a,dtype='<u4' if key=='index' else '<f4');assert np.isfinite(a).all()
        rec[key]=dict(offset=offset,count=a.size,size=a.shape[1] if a.ndim>1 else 1)
        chunks.append(a.tobytes());offset+=a.nbytes
    records.append(rec)
data=b''.join(chunks)
meta=dict(meshes=records,materials=doc['materials'],source='cybr-combat/preview',sourceModel='cybr-combat/assets/cybr_mannequin_male.glb',modelSHA256=hashlib.sha256((ROOT/'cybr-combat/assets/cybr_mannequin_male.glb').read_bytes()).hexdigest(),geometrySHA256=hashlib.sha256(raw).hexdigest(),frame=frame_index,take=take[2],poseLabel=doc['poseRows'][frame_index].get('label'),currentMannequin=True,poseMode='Static skinned vertex bake of the current rig; no added weapon or armor',triangles=sum(m['index'].size//3 for m in meshes),sha256=hashlib.sha256(data).hexdigest())
meta['clothBake']={k:v for k,v in cloth.items() if k!='cages'}
meta['frozenGarmentFit']=fit
(out/(args.name+'.bin.gz')).write_bytes(gzip.compress(data,6,mtime=0));(out/(args.name+'.json')).write_text(json.dumps(meta,indent=2))
print(json.dumps({k:v for k,v in meta.items() if k not in ('meshes','materials')},ensure_ascii=True))
