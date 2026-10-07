"""Extract actual recovered geometry; bake native materials on its surfaces.

The foreground remains at one uniform scale. Distant ridges are a separately
scaled museum-diorama insert, explicitly recorded rather than regenerated.
"""
from pathlib import Path
import os,sys,json,subprocess,gzip,shutil,hashlib,gc
import numpy as np
import trimesh
import fast_simplification

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'cybr-scenes/environments'
WORK=Path('D:/CYBR-build/exploded-instrument/springs-faithful-v1')
OUT=ROOT/'portfolio/assets/springs-cartridge-v2'
OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(SOURCE/'tools'))
from enhance_geometry import mineral_deform
sys.path.insert(0,str(SOURCE/'engines/hot/cybr-geo/examples/desert_hot_springs'))
from finish import camera_white

def normals(v,f):
    n=np.zeros_like(v);face=np.cross(v[f[:,1]]-v[f[:,0]],v[f[:,2]]-v[f[:,0]])
    for i in range(3):np.add.at(n,f[:,i],face)
    return n/np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-15)

def main():
    meshes=[];probes=[];ranges=[];cursor=0
    source=WORK/'geometry/scene';doc=json.loads((source/'scene.json').read_text())
    with np.load(source/'meshes.npz') as archive:
        for part in doc['parts']:
            mat=part['material'];key=part['key']
            if mat==7:continue
            v=archive[key+'_vertices']*.001;f=archive[key+'_faces'];n=archive[key+'_normals']
            if mat in (1,2):v,n,_,_=mineral_deform(v.astype(np.float32),n.astype(np.float32),'desert-hot-springs')
            if mat==5:
                inside=(np.abs(v[:,0])<7400)&(v[:,1]>150)&(v[:,1]<12000)
                budget=180000
            else:
                inside=((v[:,0]-.5)**2+(v[:,1]-1.)**2)<7.55**2
                budget={0:200000,1:150000,2:100000,3:65000,4:45000,6:45000,8:45000,9:65000}[mat]
            f=f[np.all(inside[f],axis=1)]
            if len(f)==0:continue
            used,indices=np.unique(f,return_inverse=True);v=v[used];n=n[used];f=indices.reshape(-1,3)
            original_faces=len(f)
            if mat==5:
                welded=trimesh.Trimesh(v,f,process=False)
                welded.merge_vertices(digits_vertex=5)
                v=np.asarray(welded.vertices);f=np.asarray(welded.faces)
            if len(f)>budget and mat not in (3,8,9):
                v,f=fast_simplification.simplify(v,f,target_count=budget,agg=5)
                n=normals(v,f)
            # Leaves/stems are kept rather than arbitrarily deleting triangles.
            material='water' if mat==6 else 'baked'
            if material!='water':
                probes.append(np.c_[v,n,np.full(len(v),mat)].astype('<f4'));ranges.append((len(meshes),cursor,len(v)));cursor+=len(v)
            p=np.c_[(v[:,0]-.5)*.30,v[:,2]*.30+.10,-(v[:,1]-1)*.30]
            if mat==5:
                # Preserve source shape with uniform scaling, not low-grid erosion.
                # Entire original ridge is a separate small-scale rear insert.
                p=np.c_[v[:,0]*.00018,v[:,2]*.00018+.18,-.72-(v[:,1]-150)*.00018]
                # Trim only where the physical carrier ends; do not distort hills.
                keep=p[:,0]**2+p[:,2]**2<2.25**2
                f=f[np.all(keep[f],axis=1)]
            nn=np.c_[n[:,0],n[:,2],-n[:,1]]
            meshes.append(dict(name=part['name'],material=material,sourceMaterial=mat,position=p.astype('<f4'),normal=nn.astype('<f4'),index=f.astype('<u4').ravel(),sourceTriangles=original_faces))
            print(part['name'],original_faces,'->',len(f),flush=True)
            del v,f,n;gc.collect()
    # Seal source foreground edges down to a thin undercut tray; no cake rings.
    ground=meshes[0];v=ground['position'];f=ground['index'].reshape(-1,3)
    edges=np.concatenate([f[:,[0,1]],f[:,[1,2]],f[:,[2,0]]]);sorted_edges=np.sort(edges,axis=1)
    _,first,counts=np.unique(sorted_edges,axis=0,return_index=True,return_counts=True);boundary=edges[first[counts==1]]
    boundary=boundary[np.all(np.linalg.norm(v[boundary][:,:,[0,2]],axis=2)>2.1,axis=1)]
    wall=[];faces=[]
    for a,b in boundary:
        va=v[a].copy();vb=v[b].copy();ba=va.copy();bb=vb.copy();ba[1]=bb[1]=-.07
        i=len(wall);wall.extend([va,vb,ba,bb]);faces.extend([[i,i+2,i+1],[i+1,i+2,i+3]])
    if wall:
        wall=np.asarray(wall);faces=np.asarray(faces);meshes.append(dict(name='Open mineral section',material='section',position=wall.astype('<f4'),normal=normals(wall,faces).astype('<f4'),index=faces.astype('<u4').ravel()))
    query=WORK/'surface-probes.bin'
    with query.open('wb') as stream:
        stream.write(np.asarray([cursor],dtype='<u4').tobytes())
        for p in probes:stream.write(p.tobytes())
    del probes;gc.collect()
    env=os.environ.copy();env['CYBR_SURFACE_ATLAS']=str(SOURCE/'assets/mineral_detail.cdt')
    # Source overlay uses the corrected file-backed allocator from the last turn.
    shutil.copy2(ROOT/'portfolio/instrument/springs_disk_allocator.h',WORK/'native-overlay/springs_disk_allocator.h')
    with (WORK/'compile-surfaces.log').open('w') as log:
        subprocess.run(['cmd.exe','/d','/c',str(ROOT/'portfolio/instrument/compile_springs_surfaces.cmd'),str(WORK),str(SOURCE)],cwd=WORK,stdout=log,stderr=log,check=True)
    assets=SOURCE/'engines/hot/cybr-geo/examples/desert_hot_springs/assets'
    with (WORK/'bake-surfaces.log').open('w') as log:
        subprocess.run([str(WORK/'bake-surfaces.exe'),str(WORK/'geometry-r2/scene.meshbin'),str(query),str(WORK/'surface-radiance.bin'),str(assets/'gravel_periodic.pgm'),str(assets/'granular_relief.bin'),str(WORK/'surface-sky.bin')],cwd=WORK,env=env,stdout=log,stderr=log,check=True)
    raw=np.fromfile(WORK/'surface-radiance.bin',dtype='<f4').reshape(-1,3);assert len(raw)==cursor and np.isfinite(raw).all()
    white=camera_white(5750);linear=np.maximum(raw/white*1.9,0);linear=linear*linear/(linear+.035);peak=np.maximum(linear.max(1,keepdims=True),1e-7);linear*=(-np.expm1(-peak))/peak
    for index,offset,count in ranges:meshes[index]['color']=linear[offset:offset+count].astype('<f4')
    chunks=[];offset=0;records=[]
    for m in meshes:
        record={k:v for k,v in m.items() if not isinstance(v,np.ndarray)}
        for key,value in m.items():
            if not isinstance(value,np.ndarray):continue
            a=np.ascontiguousarray(value);assert np.isfinite(a).all()
            record[key]=dict(offset=offset,count=a.size,size=a.shape[-1] if a.ndim>1 else 1)
            chunks.append(a.tobytes());offset+=a.nbytes
        records.append(record)
    data=b''.join(chunks);(OUT/'geometry.bin.gz').write_bytes(gzip.compress(data,compresslevel=6,mtime=0))
    sky=(WORK/'surface-sky.bin').read_bytes();(OUT/'sky.bin.gz').write_bytes(gzip.compress(sky,compresslevel=6,mtime=0))
    manifest=dict(meshes=records,triangles=sum(len(m['index'])//3 for m in meshes),decodedBytes=offset,sha256=hashlib.sha256(data).hexdigest(),source='Recovered full CYBR GEO scene NPZ + R2 mineral deformation',bake='Native material evaluation, sun visibility and 24-sample cosine sky visibility. Diffuse surface lighting; not full path tracing, water caustics or steam.',mountains='Original full-resolution ridge, independently uniformly scaled rear insert; not recreated from a low-resolution generator.',sprites=False)
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({k:v for k,v in manifest.items() if k!='meshes'}),flush=True)

if __name__=='__main__':main()
