"""Isolated native CYBR LIGHT OptiX material reference, not a production bake."""
from pathlib import Path
import sys,json,hashlib,subprocess,time,argparse
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-light/python'))
from cybrlight import Scene,Settings,Camera
from studio import write_studio
from finish import denoise,display
from module_materials import measured_metals,hardware_material

p=argparse.ArgumentParser();p.add_argument('label',nargs='?',default='combat-light-reference');p.add_argument('--source',type=Path,default=ROOT/'portfolio/output/combat-native-source-v3.json');p.add_argument('--out',type=Path);p.add_argument('--prepare-only',action='store_true');args=p.parse_args()
out=(args.out or ROOT/'portfolio/output'/args.label).resolve();out.mkdir(parents=True,exist_ok=True)
src=args.source;doc=json.loads(src.read_text());optical=measured_metals(out)
s=Scene('Current Combat mannequin / native material reference')
s.settings=Settings(width=960,height=800,spp=128,bands=8,max_depth=16,rr_depth=5,filter='tent',seed=1307)
s.camera=Camera(origin=(.58,.45,.89),target=(0,.065,0),up=(0,1,0),fov=38)
# Rotate the existing Z-up instrument studio into this Y-up miniature.
studio=write_studio(out/'studio-z.pfm',graded=True)
from cybrlight import read_pfm
rgb=read_pfm(studio);h,w=rgb.shape[:2]
u=(np.arange(w)+.5)/w*2*np.pi;v=(np.arange(h)+.5)/h*np.pi
x=np.sin(v[:,None])*np.cos(u);y=np.broadcast_to(np.cos(v[:,None]),(h,w));z=np.sin(v[:,None])*np.sin(u)
oldx=x;oldy=-z;oldz=y
uu=np.mod(np.arctan2(oldz,oldx),2*np.pi)/(2*np.pi);vv=np.arccos(np.clip(oldy,-1,1))/np.pi
mapped=rgb[np.minimum((vv*h).astype(int),h-1),np.minimum((uu*w).astype(int),w-1)]
with (out/'studio.pfm').open('wb') as f:f.write(f'PF\n{w} {h}\n-1.0\n'.encode());f.write(mapped[::-1].astype('<f4').tobytes())
s.environment.update(texture=str(out/'studio.pfm'),strength=1,flat=True)
red_spectrum=out/'cable-reflectance.spd';wavelengths=np.arange(360,831,5)
np.savetxt(red_spectrum,np.column_stack((wavelengths,.003+.6/(1+np.exp(-(wavelengths-625)/7)))),fmt='%.9g')
floor=s.material(name='Warm neutral cyclorama',type='diffuse',color=(.72,.71,.69))
s.quad((-50,-.118,-50),(0,0,100),(100,0,0),floor,object_id=0)
cache={};audit=[]
for i,m in enumerate(doc['meshes']):
    a=m['material'];c=np.array(a['color']);name=m['name'];key=(name,tuple(c),a['metalness'],a['roughness'])
    if key not in cache:
        if name in ('shirt','shorts'):
            kw=dict(type='landscape',color=c,roughness=.86,ior_a=1.46)
        elif name=='body':
            kw=dict(type='plastic',color=c*.78,roughness=.42,ior_a=1.46)
        else:
            kw=hardware_material(a,optical,red_spectrum)
        cache[key]=s.material(name=name or f'Hardware {i}',**kw)
        audit.append(dict(name=name or f'Hardware {i}',**{k:np.asarray(v).tolist() if isinstance(v,np.ndarray) else v for k,v in kw.items()}))
    v=np.array(m['position']).reshape(-1,3);n=np.array(m['normal']).reshape(-1,3);world=np.array(m['world']).reshape(4,4,order='F')
    v=(v@world[:3,:3].T+world[:3,3])*.1;n=n@np.linalg.inv(world[:3,:3]);n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
    f=np.array(m['index'] if m['index'] is not None else np.arange(len(v))).reshape(-1,3)
    area=np.linalg.norm(np.cross(v[f[:,1]]-v[f[:,0]],v[f[:,2]]-v[f[:,0]]),axis=1);f=f[area>1e-12]
    uv=np.asarray(m['uv']).reshape(-1,2) if m.get('uv') else None
    s.mesh(v,f,cache[key],normals=n,uv=uv,object_id=i+1)
scene=s.save(out/'scene.cys');(out/'materials.json').write_text(json.dumps(audit,indent=2))
if args.prepare_only:
    print(json.dumps(dict(prepared=True,productionApproved=False,scene=str(scene),sourceSHA256=hashlib.sha256(src.read_bytes()).hexdigest())),flush=True);sys.exit(0)
exe=ROOT/'portfolio/output/optix-water-nee-v7/cybr-light-optix.exe';prefix=out/'native';started=time.time()
print('CYBR LIGHT OptiX: reference scene exported; rendering 960x800, 128 packets, 8 bands',flush=True)
with (out/'render.log').open('w') as log:subprocess.run([str(exe),'--scene',str(scene),'--out',str(prefix),'--tile','2048'],stdout=log,stderr=log,check=True)
report=json.loads(prefix.with_suffix('.json').read_text());assert report['gpu_execution'] and report['invalid_path_samples']==0
film=denoise(prefix,Path('D:/CYBR-build/exploded-instrument/tools/oidn-2.5.1.x64.windows/bin/oidnDenoise.exe'))
Image.fromarray(display(film)).save(out/'reference.png')
receipt=dict(renderer='CYBR LIGHT native OptiX + OIDN',sourceSHA256=hashlib.sha256(src.read_bytes()).hexdigest(),seconds=time.time()-started,native=report,complete=True,visualApproval=False,limitations=['Static current-rig pose retains garment intersection defects.','Rough-diffuse cloth; no dedicated micro-fiber BSDF or polymer subsurface scattering.','Bronze-like ports use illustrative optical constants.','Not a production camera-path bake.'])
(out/'receipt.json').write_text(json.dumps(receipt,indent=2));print(str(out/'reference.png'),flush=True)
