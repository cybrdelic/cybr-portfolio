"""Source-derived module assets. Does not modify production geometry or bakes."""
from pathlib import Path
import sys,json,gzip,hashlib
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'portfolio/assets/display-modules'
OUT.mkdir(parents=True,exist_ok=True)
HOT=ROOT/'cybr-scenes/environments/engines/hot/cybr-geo/examples/desert_hot_springs'
sys.path.insert(0,str(HOT))
from v11_landforms import height,poolq,rock_template,landscape_ridges,connected_shrub
from build_scene_v4 import gridmesh,mesh_normals,noise,fbm

def save(name,meshes,meta):
    chunks=[];cursor=0;records=[]
    for mesh in meshes:
        record={k:v for k,v in mesh.items() if not isinstance(v,np.ndarray)}
        for key,value in mesh.items():
            if not isinstance(value,np.ndarray):continue
            a=np.ascontiguousarray(value,dtype='<u4' if key=='index' else '<f4')
            assert np.isfinite(a).all()
            record[key]=dict(offset=cursor,count=a.size,size=a.shape[-1] if a.ndim>1 else 1,dtype=str(a.dtype))
            chunks.append(a.tobytes());cursor+=a.nbytes
        records.append(record)
    raw=b''.join(chunks)
    (OUT/(name+'.bin.gz')).write_bytes(gzip.compress(raw,compresslevel=6,mtime=0))
    meta.update(meshes=records,bytes=cursor,sha256=hashlib.sha256(raw).hexdigest(),triangles=sum(len(m['index'])//3 for m in meshes))
    (OUT/(name+'.json')).write_text(json.dumps(meta,separators=(',',':')))
    print(name,meta['triangles'],'triangles',len(raw),'bytes',flush=True)

def combat():
    source=ROOT/'cybr-combat/demo-output/physical-animation-proof'
    doc=json.loads((source/'scene.json').read_text());raw=(source/'geometry.bin').read_bytes()
    def read(r):return np.frombuffer(raw,dtype=r['dtype'],count=r['bytes']//4,offset=r['offset']).reshape(r['shape']).copy()
    # Original authored strike, frozen on its approach rather than a bind pose.
    frame_index=23;frame=doc['frames'][frame_index];meshes=[]
    for m in doc['meshes']:
        if m['name'] not in ('body','helmet'):continue
        p=read(m['position']);n=read(m['normal'])
        if 'skin' in m:
            joints=read(m['joints']).astype(int);weights=read(m['weights'])
            skin=read(frame['skins'][m['skin']]).transpose(0,2,1)
            matrix=(skin[joints]*weights[:,:,None,None]).sum(axis=1)
            p=np.einsum('nij,nj->ni',matrix[:,:3,:3],p)+matrix[:,:3,3]
            n=np.einsum('nij,nj->ni',matrix[:,:3,:3],n)
        elif m.get('transform'):
            matrix=read(frame[m['transform']]).T
            p=p@matrix[:3,:3].T+matrix[:3,3];n=n@np.linalg.inv(matrix[:3,:3])
        n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-8)
        meshes.append(dict(name=m['name'],material=m['material'],position=p,normal=n,uv=read(m['uv']),index=read(m['index']).ravel()))
    # Straight forged sword matching the approved concept, attached to the
    # original hand/weapon matrix. The source proof used an axe.
    transform=read(frame['axe']).T
    v=np.array([[-.045,.15,0],[0,.15,.013],[.045,.15,0],[0,.15,-.013],[-.04,1.13,0],[0,1.13,.009],[.04,1.13,0],[0,1.13,-.009],[0,1.33,0]],float)
    faces=[]
    for j in range(4):k=(j+1)%4;faces.extend([[j,k,j+4],[k,k+4,j+4],[j+4,k+4,8]])
    f=np.asarray(faces);v=v@transform[:3,:3].T+transform[:3,3]
    meshes.append(dict(name='Concept sword blade',material=6,position=v,normal=mesh_normals(v,f),index=f.ravel()))
    import trimesh
    for label,extents,centre,mat in [('Sword guard',[.30,.045,.065],[0,.13,0],8),('Sword grip',[.043,.30,.042],[0,-.04,0],7),('Sword pommel',[.073,.065,.065],[0,-.21,0],8)]:
        box=trimesh.creation.box(extents=extents);v=np.asarray(box.vertices)+centre;f=np.asarray(box.faces)
        v=v@transform[:3,:3].T+transform[:3,3]
        meshes.append(dict(name=label,material=mat,position=v,normal=mesh_normals(v,f),index=f.ravel()))
    allp=np.concatenate([m['position'] for m in meshes]);lo=allp.min(0);hi=allp.max(0)
    scale=2.65/(hi[1]-lo[1]);centre=(lo+hi)/2;centre[1]=lo[1]
    for m in meshes:m['position']=(m['position']-centre)*scale
    for i,p in enumerate(doc['textures']):
        if i not in (3,4,5,7,8,9):continue
        im=Image.open(source/p);im.thumbnail((2048,2048));im.save(OUT/f'combat-{i}.webp',quality=95)
    save('combat',meshes,dict(source=str(source.relative_to(ROOT)),frame=frame_index,materials=doc['materials'],note='Original retained armor, helmet, weapon and authored pose. Static vertex bake; no image projection.'))

def stem(p,q,radius,sides=5):
    d=q-p;d/=np.linalg.norm(d);u=np.cross(d,[0,0,1])
    if np.linalg.norm(u)<.01:u=np.cross(d,[0,1,0])
    u/=np.linalg.norm(u);b=np.cross(d,u);a=np.arange(sides)*2*np.pi/sides
    offsets=np.cos(a)[:,None]*u+np.sin(a)[:,None]*b
    v=np.vstack((p+offsets*radius,q+offsets*radius*.44));f=[]
    for k in range(sides):j=(k+1)%sides;f.extend([[k,j,j+sides],[k,j+sides,k+sides]])
    f=np.asarray(f);return v,f,mesh_normals(v,f)

def terrain():
    meshes=[];rng=np.random.default_rng(20260914)
    # Actual v11 hot-spring coordinates, compressed distant ridges as a diorama.
    def convert(v):return np.c_[(v[:,0]-.5)*.30,v[:,2]*.30+.65,-(v[:,1]-1)*.30]
    def add(name,v,f,material,color=None):
        p=convert(v);n=mesh_normals(p,f)
        m=dict(name=name,material=material,position=p,normal=n,index=np.asarray(f).ravel())
        if color is not None:m['color']=color
        meshes.append(m)
    angles=np.linspace(0,2*np.pi,513);rs=np.linspace(.0001,7,161)
    rr,aa=np.meshgrid(rs,angles,indexing='ij');xx=.5+rr*np.cos(aa);yy=1+rr*np.sin(aa)
    zz=height(xx,yy);verts=np.c_[xx.ravel(),yy.ravel(),zz.ravel()];faces=[]
    for i in range(len(rs)-1):
        for j in range(len(angles)-1):
            a=i*len(angles)+j;b=a+len(angles);faces.extend([[a,b,a+1],[a+1,b,b+1]])
    f=np.asarray(faces);q=poolq(xx,yy,0).ravel();variation=fbm(verts[:,0]*5,verts[:,1]*5,4)
    sand=np.tile([.48,.37,.23],(len(verts),1));bank=np.tile([.74,.70,.58],(len(verts),1))
    blend=np.exp(-((q-1.10)/.3)**2);c=sand*(1-blend[:,None])+bank*blend[:,None]
    c*=1+variation[:,None]*.35
    underwater=q<1;c[underwater]*=np.array([.65,.89,.85])
    add('Original v11 mineral basin',verts,f,'earth',c)
    # Seal the circular geological section down to the cartridge tray.
    edge=verts[-len(angles):].copy();base=edge.copy();base[:,2]=-2.1
    v=np.vstack([edge,base]);fs=[]
    for j in range(len(angles)-1):fs.extend([[j,j+1,j+len(angles)],[j+1,j+len(angles)+1,j+len(angles)]])
    add('Cutaway mineral strata',v,np.asarray(fs)[:,::-1],'strata')
    # Conforming water surface: only triangles completely inside the real shore.
    v=verts.copy();v[:,2]=.055+.003*np.sin(v[:,0]*17+v[:,1]*11)
    mask=np.all(q[f]<.995,axis=1);add('Shore conforming water',v,f[mask],'water')
    print('terrain basin built',flush=True)
    # Reuse actual terrain generator at display LOD, no photo planes.
    xs=np.linspace(-7500,7500,181);ys=np.linspace(150,12000,111)
    cache=OUT/'ridge-lod.npy'
    z=np.load(cache) if cache.exists() else landscape_ridges(xs,ys,20260914)
    if not cache.exists():np.save(cache,z)
    v,f,n=gridmesh(xs,ys,gaussian_filter(z,1.05))
    v[:,0]=v[:,0]/1500+.5;v[:,1]=4+v[:,1]/4500;v[:,2]=v[:,2]/900
    keep=((v[:,0]-.5)**2+(v[:,1]-1)**2)<6.95**2;f=f[np.all(keep[f],axis=1)]
    add('Source eroded ridge miniature',v,f,'rock')
    groups={'rock':[],'wood':[],'leaf':[]}
    templates=[rock_template(i+500,2) for i in range(9)]
    for i in range(950):
        x=rng.uniform(-6.3,7.3);y=rng.uniform(-5.8,7.8)
        if (x-.5)**2+(y-1)**2>6.7**2:continue
        q0=float(poolq(x,y,0));h=float(height(x,y))
        if q0<.55:continue
        v,f,n=templates[i%9];s=rng.uniform(.025,.10) if i>32 else rng.uniform(.18,.52)
        p=v*np.array([s,s*rng.uniform(.7,1.3),s*rng.uniform(.6,1.1)])+np.array([x,y,h+s*.3]);groups['rock'].append((p,f))
    for i in range(38):
        x=rng.uniform(-5.8,6.8);y=rng.uniform(-4.5,6.7)
        if (x-.5)**2+(y-1)**2>6.2**2 or float(poolq(x,y,0))<1.2:continue
        base=np.array([x,y,float(height(x,y))]);wood,leaves=connected_shrub(rng,base,rng.uniform(.3,.8),1,stem)
        for key,items in [('wood',wood),('leaf',leaves)]:
            for v,f,n in items:groups[key].append((v,f))
    for key,items in groups.items():
        vs=[];fs=[];offset=0
        for v,f in items:vs.append(v);fs.append(f+offset);offset+=len(v)
        if vs:add(key,np.concatenate(vs),np.concatenate(fs),key)
    save('springs',meshes,dict(source=str(HOT.relative_to(ROOT)),note='v11 height/poolq, rock_template, landscape_ridges and connected_shrub. Foreground cropped to circular 14m diameter; distant mountains compressed into display relief. Not a 1:1 scale scene.',seed=20260914))
    Image.open(HOT/'assets/gravel_periodic.pgm').convert('RGB').save(OUT/'mineral-grain.webp',quality=94)

if __name__=='__main__':
    combat();terrain()
