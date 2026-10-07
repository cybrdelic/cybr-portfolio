"""Fuse the diorama terrain in object space, retaining baked vertex radiance.

This is an authored miniature, not a claim of uniform geographic scale.
Rasterization samples actual source triangles; there is no image projection.
The v2 package remains untouched for comparison/recovery.
"""
from pathlib import Path
import gzip,json,hashlib
import numpy as np
from numba import njit

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'assets/springs-cartridge-v2'
OUT=ROOT/'assets/springs-cartridge-v3'

@njit
def raster(p,c,f,size,radius):
    h=np.full((size,size),-1e9,np.float32)
    rgb=np.zeros((size,size,3),np.float32)
    step=2*radius/(size-1)
    for t in f:
        a,b,d=p[t[0]],p[t[1]],p[t[2]]
        den=(b[2]-d[2])*(a[0]-d[0])+(d[0]-b[0])*(a[2]-d[2])
        if abs(den)<1e-12:continue
        x0=max(0,int(np.ceil((min(a[0],b[0],d[0])+radius)/step)))
        x1=min(size-1,int(np.floor((max(a[0],b[0],d[0])+radius)/step)))
        z0=max(0,int(np.ceil((min(a[2],b[2],d[2])+radius)/step)))
        z1=min(size-1,int(np.floor((max(a[2],b[2],d[2])+radius)/step)))
        for iz in range(z0,z1+1):
            z=iz*step-radius
            for ix in range(x0,x1+1):
                x=ix*step-radius
                u=((b[2]-d[2])*(x-d[0])+(d[0]-b[0])*(z-d[2]))/den
                v=((d[2]-a[2])*(x-d[0])+(a[0]-d[0])*(z-d[2]))/den
                w=1-u-v
                if min(u,v,w)<-1e-5:continue
                y=u*a[1]+v*b[1]+w*d[1]
                if y>h[iz,ix]:
                    h[iz,ix]=y
                    rgb[iz,ix]=u*c[t[0]]+v*c[t[1]]+w*c[t[2]]
    return h,rgb

def normals(p,f):
    n=np.zeros_like(p);fn=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]])
    for i in range(3):np.add.at(n,f[:,i],fn)
    return n/np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)

def main():
    doc=json.loads((SRC/'manifest.json').read_text())
    data=gzip.decompress((SRC/'geometry.bin.gz').read_bytes());meshes=[]
    for record in doc['meshes']:
        m={k:v for k,v in record.items() if not isinstance(v,dict)}
        for key,s in record.items():
            if not isinstance(s,dict):continue
            dtype='<u4' if key=='index' else '<f4'
            m[key]=np.frombuffer(data,dtype,count=s['count'],offset=s['offset']).reshape(-1,s['size']).copy()
        meshes.append(m)
    ground=next(m for m in meshes if m['name']=='Continuous_irregular_spring_shelf')
    ridge=next(m for m in meshes if m.get('sourceMaterial')==5)
    size=901;radius=2.265
    gh,gc=raster(ground['position'],ground['color'],ground['index'].reshape(-1,3),size,radius)
    mh,mc=raster(ridge['position'],ridge['color'],ridge['index'].reshape(-1,3),size,radius)
    x,z=np.meshgrid(np.linspace(-radius,radius,size),np.linspace(-radius,radius,size))
    valid=(gh>-1e8)&(x*x+z*z<2.24**2)
    # Bury the flat apron gradually in the real bank. An irregular transition
    # follows the miniature's relief instead of a raised rectangular cutoff.
    start=-.95+.10*np.sin(x*3)+.06*np.sin(x*7)
    weight=np.clip((start-z)/.48,0,1);weight=weight*weight*(3-2*weight)
    relief=np.maximum(0,mh-gh)*weight
    height=gh+relief
    blend=np.clip(relief/.13,0,1);blend=blend*blend*(3-2*blend)
    color=gc*(1-blend[:,:,None])+mc*blend[:,:,None]
    indices=np.arange(size*size).reshape(size,size)
    a=indices[:-1,:-1].ravel();b=a+1;c=a+size;d=c+1
    faces=np.concatenate([np.c_[a,c,b],np.c_[b,c,d]])
    faces=faces[np.all(valid.ravel()[faces],axis=1)]
    used,inv=np.unique(faces,return_inverse=True);faces=inv.reshape(-1,3)
    p=np.c_[x.ravel(),height.ravel(),z.ravel()][used].astype('<f4')
    terrain=dict(name='Continuous fused terrain and ridge',material='baked',position=p,normal=normals(p,faces),color=color.reshape(-1,3)[used].astype('<f4'),index=faces.astype('<u4').ravel())
    result=[terrain]
    for m in meshes:
        if m is ground or m is ridge or m['material']=='section':continue
        if m['material']=='water':
            f=m['index'].reshape(-1,3);p=m['position']
            face=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]])
            # Closed volume side/bottom surfaces were refracting a second time.
            f=f[face[:,1]>.5*np.linalg.norm(face,axis=1)]
            used,inv=np.unique(f,return_inverse=True)
            for key in ['position','normal']:m[key]=m[key][used]
            m['index']=inv.astype('<u4')
            m['name']='Single air-water interface'
        result.append(m)
    # Exact boundary of the fused terrain, sealed down to its carrier.
    f=terrain['index'].reshape(-1,3);p=terrain['position']
    edges=np.concatenate([f[:,[0,1]],f[:,[1,2]],f[:,[2,0]]])
    _,first,counts=np.unique(np.sort(edges,axis=1),axis=0,return_index=True,return_counts=True)
    boundary=edges[first[counts==1]];wall=[];wf=[];wc=[]
    for a,b in boundary:
        if min(np.linalg.norm(p[a,[0,2]]),np.linalg.norm(p[b,[0,2]]))<2.20:continue
        ba=p[a].copy();bb=p[b].copy();ba[1]=bb[1]=-.07;i=len(wall)
        wall.extend([p[a],p[b],ba,bb]);wf.extend([[i,i+1,i+2],[i+1,i+3,i+2]])
        ca=terrain['color'][a];cb=terrain['color'][b];wc.extend([ca,cb,ca*.60,cb*.60])
    wall=np.array(wall,dtype='<f4');wf=np.array(wf,dtype='<u4')
    result.append(dict(name='Sealed mineral section',material='baked',position=wall,normal=normals(wall,wf),color=np.array(wc,dtype='<f4'),index=wf.ravel()))
    chunks=[];records=[];offset=0
    for m in result:
        rec={k:v for k,v in m.items() if not isinstance(v,np.ndarray)}
        for k,v in m.items():
            if not isinstance(v,np.ndarray):continue
            v=np.ascontiguousarray(v,dtype='<u4' if k=='index' else '<f4')
            assert np.isfinite(v).all()
            rec[k]=dict(offset=offset,count=v.size,size=v.shape[1] if v.ndim>1 else 1)
            chunks.append(v.tobytes());offset+=v.nbytes
        records.append(rec)
    output=b''.join(chunks);OUT.mkdir(exist_ok=True)
    (OUT/'geometry.bin.gz').write_bytes(gzip.compress(output,6,mtime=0))
    (OUT/'sky.bin.gz').write_bytes((SRC/'sky.bin.gz').read_bytes())
    doc.update(meshes=records,decodedBytes=offset,sha256=hashlib.sha256(output).hexdigest(),triangles=sum(m['index'].size//3 for m in result),mountains='Source ridge fused into foreground in object space with a buried, smoothly graded transition. Authored miniature; not uniform geographic scale.')
    (OUT/'manifest.json').write_text(json.dumps(doc,indent=2))
    print(json.dumps({k:v for k,v in doc.items() if k!='meshes'}))

if __name__=='__main__':main()
