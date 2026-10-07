"""Offline whole-assembly radiance plus visibility for geometry reprojection.

Uses the exact browser camera/assembly export. Does not capture the live browser
shader or put renders on billboard planes. Each checkpoint is independently
path traced; depth and object IDs gate runtime reprojection onto CAD geometry.
"""
from pathlib import Path
import argparse,gzip,json,sys,time,hashlib
import subprocess
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-geo/src'))
from mechanism_lab.geometry import tube_mesh
from mechanism_lab.v9 import write_binary_ply,_render_linear,_oidn,_save_png,_reconcile,_extract
import trimesh
from trimesh.ray.ray_pyembree import RayMeshIntersector

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--build',type=Path,required=True)
    parser.add_argument('--indices',default='all')
    parser.add_argument('--width',type=int,default=1280)
    parser.add_argument('--spp',type=int,default=128)
    parser.add_argument('--reuse-beauty',action='store_true')
    parser.add_argument('--variant',default='scalar_rgb')
    parser.add_argument('--ptx',type=int,default=0)
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--sample-batch',type=int,default=8)
    parser.add_argument('--publish',action='store_true')
    parser.add_argument('--threads',type=int,default=12)
    args=parser.parse_args();build=args.build;out=build/'path-bake';out.mkdir(exist_ok=True)
    import mitsuba as mi
    mi.set_variant(args.variant)
    import drjit as dr
    dr.set_thread_count(args.threads)
    if args.ptx:
        import ctypes,drjit
        core=ctypes.CDLL(str(Path(drjit.__file__).parent/'drjit-core.dll'))
        target=getattr(core,'?jit_cuda_set_target@@YAXII@Z') if sys.platform=='win32' else core.jit_cuda_set_target
        target.argtypes=[ctypes.c_uint32,ctypes.c_uint32];target.restype=None
        target(args.ptx,89)
    path=json.loads((out/'path.json').read_text());source=ROOT/'portfolio/assets/instrument-3d'
    manifest=json.loads((source/'manifest.json').read_text());raw=gzip.decompress((source/'instrument.bin.gz').read_bytes())
    def attr(s,w):return np.frombuffer(raw,dtype=s['dtype'],offset=s['offset'],count=s['count']).reshape(-1,w)
    meshes=[]
    for i,m in enumerate(manifest['meshes']):
        if m['material']==7:continue
        meshes.append((i+1,m,attr(m['positions'],3).astype(float),attr(m['indices'],3),attr(m['normals'],3).astype(float)/32767))
    fluid_dir=build/'fluid-v4-contact';fm=json.loads((fluid_dir/'manifest.json').read_text())
    priority=[0,1,6,12,20,28,36,44,48]
    indices=list(dict.fromkeys(priority+list(range(len(path['frames']))))) if args.indices=='all' else [int(i) for i in args.indices.split(',')]
    colors=[(.7,.72,.75),(.8,.81,.83),(.035,.042,.052),(.98,.99,1),(.62,.018,.025),(.66,.48,.23),(.015,.02,.022),(.96,.99,1)]
    def bsdf(mat):
        if mat in (3,7):return {'type':'dielectric','int_ior':1.52 if mat==3 else 1.333,'ext_ior':1.000277}
        return {'type':'principled','base_color':{'type':'rgb','value':colors[mat]},'metallic':[1,1,.75,0,.1,1,0,0][mat],'roughness':[.23,.13,.32,0,.28,.3,.6,0][mat],'anisotropic':.25 if mat in (0,1,5) else 0}
    for index in indices:
        start=time.time();state=path['frames'][index];work=out/f'{index:03d}';work.mkdir(exist_ok=True)
        if args.resume and (work/'receipt.json').exists():
            done=json.loads((work/'receipt.json').read_text())
            if done['width']==args.width and done['spp']==args.spp and done['world']==state['world'] and done['projection']==state['projection'] and done['groups']==state['groups'] and done['objects']==state['objects'] and done['sourceGeometry']==manifest['stats']['sha256']:
                print(json.dumps({'index':index,'stage':'cached'}),flush=True);continue
        w=args.width;h=round(w/1.6);P=np.array(state['projection']).reshape(4,4,order='F');W=np.array(state['world']).reshape(4,4,order='F');V=np.linalg.inv(W)
        eye=W[:3,3].copy();forward=-W[:3,2];up=W[:3,1];perspective=-P[3,2]>1e-9
        if perspective:
            eye+=W[:3,2]*(P[3,3]/(-P[3,2]));fov=np.degrees(2*np.arctan((-P[3,2])/P[0,0]))
            sensor={'type':'perspective','fov':float(fov),'fov_axis':'x','to_world':mi.ScalarTransform4f.look_at(origin=eye,target=eye+forward,up=up)}
        else:
            sensor={'type':'orthographic','to_world':mi.ScalarTransform4f.look_at(origin=eye,target=eye+forward,up=up) @ mi.ScalarTransform4f.scale([1/P[0,0],1/P[0,0],1])}
        sensor.update(near_clip=.01,far_clip=float(max(50000,np.linalg.norm(eye)+5000)),sampler={'type':'independent','sample_count':args.spp},film={'type':'hdrfilm','width':w,'height':h,'component_format':'float32','rfilter':{'type':'gaussian','stddev':.42}})
        scene={'type':'scene','integrator':{'type':'aov','aovs':'albedo:albedo,normal:sh_normal','beauty':{'type':'path','max_depth':16,'rr_depth':6}},'sensor':sensor,
          'environment':{'type':'envmap','filename':str(build/'v9/assets/small_workshop_2k.hdr'),'scale':.72,'to_world':mi.ScalarTransform4f.rotate([0,0,1],195)}}
        # A physical white card behind the instrument; present in reflections,
        # not an alpha composite. It is not included in the visible surface IDs.
        center=np.array([50.,0,0]);back=center-forward*-800
        scene['backdrop']={'type':'rectangle','to_world':mi.ScalarTransform4f.look_at(origin=back,target=back-forward,up=up) @ mi.ScalarTransform4f.scale([2500,2500,1]),'bsdf':{'type':'diffuse','reflectance':{'type':'rgb','value':[.88,.88,.87]}}}
        offsets={g['name']:g['x'] for g in state['groups']};shifts={o['name']:o['shift'] for o in state['objects']}
        vs=[];fs=[];owners=[];base=0;counter=0
        def add(v,f,n,mat,owner):
            nonlocal base,counter
            ply=work/f'mesh-{counter:03d}.ply';write_binary_ply(ply,v,n,f)
            scene[f'part_{counter}']={'type':'ply','filename':str(ply),'face_normals':False,'bsdf':bsdf(mat)};counter+=1
            if owner:
                vs.append(v);fs.append(f+base);owners.append(np.full(len(f),owner,dtype=np.uint8));base+=len(v)
        for owner,m,v,f,n in meshes:
            shift=offsets[m['module']]+shifts.get(m['module']+'/'+m['feature']+'/'+str(m['material']),0)
            add(v+[shift,0,0],f,n,m['material'],owner)
        for ci,points in enumerate(state['cables']):
            v,f=tube_mesh(points,2.35,16);mesh=trimesh.Trimesh(v,f,process=False);add(v,f,mesh.vertex_normals,4,200+ci)
        fi=round(state['progress']*71);item=fm['frames'][fi];b=gzip.decompress((fluid_dir/item['file']).read_bytes());count=item['count']
        fluid_v=np.frombuffer(b,dtype='<i2',count=count*3).reshape(-1,3).astype(float)/512;fluid_v[:,0]+=offsets['elements']
        fluid_n=np.frombuffer(b,dtype='<i2',offset=count*6).reshape(-1,3)/32767
        add(fluid_v,np.arange(count).reshape(-1,3),fluid_n,7,0)
        # Exact pinhole/orthographic first-surface visibility. No filtered IDs.
        model=trimesh.Trimesh(np.vstack(vs),np.vstack(fs),process=False);face_owners=np.concatenate(owners);ray=RayMeshIntersector(model)
        yy,xx=np.mgrid[0:h,0:w];ndc=np.column_stack(((xx.ravel()+.5)/w*2-1,1-(yy.ravel()+.5)/h*2,np.full(w*h,-1),np.ones(w*h)))
        near=(W@np.linalg.inv(P)@ndc.T).T;near=near[:,:3]/near[:,3,None]
        origins=np.tile(eye,(len(near),1)) if perspective else near
        directions=near-eye if perspective else np.tile(forward,(len(near),1));directions/=np.linalg.norm(directions,axis=1)[:,None]
        depths=np.zeros(w*h);ids=np.zeros(w*h,dtype=np.uint8)
        for first in range(0,w*h,65536):
            o=origins[first:first+65536];d=directions[first:first+65536]
            tri,ridx,points=ray.intersects_id(o,d,multiple_hits=False,return_locations=True)
            depths[first+ridx]=-(points@V[2,:3]+V[2,3]);ids[first+ridx]=face_owners[tri]
        mask=ids>0;lo=float(depths[mask].min()) if mask.any() else 0.;hi=float(depths[mask].max()) if mask.any() else 1.
        encoded=np.round(np.clip((depths-lo)/max(hi-lo,1e-6),0,1)*65535).astype(np.uint16)
        visibility=np.stack((encoded>>8,encoded&255,ids),axis=-1).astype(np.uint8).reshape(h,w,3)
        Image.fromarray(visibility).save(work/'visibility.png')
        # Embree visibility data is no longer needed once its image is saved.
        # Release it before allocating the independent Mitsuba render scene.
        del ray,model,vs,fs,owners,face_owners,yy,xx,ndc,near,origins,directions,depths,ids,mask,encoded,visibility
        import gc
        gc.collect()
        print(json.dumps({'index':index,'stage':'render','progress':state['progress'],'spp':args.spp,'size':[w,h],'surface_pixels':int(mask.sum())}),flush=True)
        if not(args.reuse_beauty and (work/'beauty.png').exists()):
            loaded=mi.load_dict(scene);reported=list(loaded.integrator().aov_names());accum=None;counted=0
            for batch in range(0,args.spp,args.sample_batch):
                samples=min(args.sample_batch,args.spp-batch)
                rendered=np.asarray(mi.render(loaded,spp=samples,seed=batch),dtype=np.float32).copy()
                if accum is None:accum=np.zeros_like(rendered,dtype=np.float64)
                accum+=rendered*samples;counted+=samples
                del rendered
                if counted%32==0 or counted==args.spp:
                    print(json.dumps({'index':index,'stage':'samples','completed':counted,'total':args.spp}),flush=True)
            rendered=(accum/counted).astype(np.float32);names=_reconcile(reported,rendered)
            beauty=_extract(rendered,names,'beauty');albedo=np.clip(_extract(rendered,names,'albedo'),0,1);normal=np.clip(_extract(rendered,names,'normal'),-1,1)
            assert np.isfinite(beauty).all()
            denoised=_oidn(beauty,albedo,normal,work,build/'tools/oidn-2.5.1.x64.windows/bin/oidnDenoise.exe')
            _save_png(denoised,work/'beauty.png',1.04)
        # Lossless storage avoids introducing block artifacts into metal/glass.
        Image.open(work/'beauty.png').save(work/'beauty.webp',lossless=True)
        receipt={**state,'index':index,'width':w,'height':h,'spp':args.spp,'depthRange':[lo,hi],'fluidFrame':fi,'seconds':time.time()-start,'renderer':f'Mitsuba {args.variant} path depth16 + OIDN','sourceGeometry':manifest['stats']['sha256'],'surfaces':{m['module']+'/'+m['feature']+'/'+str(m['material']):owner for owner,m,*_ in meshes},'complete':True}
        (work/'receipt.pending.json').write_text(json.dumps(receipt));(work/'receipt.pending.json').replace(work/'receipt.json')
        print(json.dumps({'index':index,'stage':'complete','seconds':receipt['seconds']}),flush=True)
        if args.publish:subprocess.run([sys.executable,str(Path(__file__).with_name('package_camera_path.py')),'--build',str(build)],check=True)

if __name__=='__main__':main()
