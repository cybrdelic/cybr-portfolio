"""Same instrument geometry, CYBR GEO V9 Mitsuba/OIDN transport helpers.
Explicit dielectric BSDFs are required: the stock V9 opaque principled adapter
does not itself model the vessel's nested glass and water interfaces.
"""
from pathlib import Path
import sys,json,gzip,argparse
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-geo/src'))
from mechanism_lab.core import load_cache
from mechanism_lab.geometry import tube_mesh
from mechanism_lab.v9 import _mitsuba,write_binary_ply,_render_linear,_oidn,_save_png
p=argparse.ArgumentParser();p.add_argument('--build',type=Path,required=True);p.add_argument('--spp',type=int,default=96);args=p.parse_args()
build=args.build;out=build/'reference-v4';out.mkdir(exist_ok=True)
import mitsuba as mi
# LLVM-C.dll is unavailable and the CUDA/OptiX compiler failed on this host.
# Use the portable scalar CPU backend with the same transport integrator.
mi.set_variant('scalar_rgb');variant=mi.variant()
routes=json.loads((build/'routes-v4.json').read_text());state=routes['states'][0]
target=np.array([35.,0,0]);direction=np.array([50.,-80,50]);direction/=np.linalg.norm(direction);eye=target+direction*1800
scene={'type':'scene','integrator':{'type':'aov','aovs':'albedo:albedo,normal:sh_normal','beauty':{'type':'path','max_depth':16,'rr_depth':6}},
 'sensor':{'type':'thinlens','fov':24,'fov_axis':'x','to_world':mi.ScalarTransform4f.look_at(origin=eye,target=target,up=[0,0,1]),'focus_distance':1800,'aperture_radius':.35,'sampler':{'type':'independent','sample_count':args.spp},'film':{'type':'hdrfilm','width':1200,'height':760,'component_format':'float32','rfilter':{'type':'gaussian','stddev':.42}}},
 'environment':{'type':'envmap','filename':str(build/'v9/assets/small_workshop_2k.hdr'),'scale':.72,'to_world':mi.ScalarTransform4f.rotate([0,0,1],195)}}
scene['backdrop']={'type':'rectangle','to_world':mi.ScalarTransform4f.look_at(origin=target-direction*180,target=eye,up=[0,0,1]) @ mi.ScalarTransform4f.scale([1600,1600,1]),'bsdf':{'type':'diffuse','reflectance':{'type':'rgb','value':[.88,.88,.87]}}}
colors=[(.7,.72,.75),(.8,.81,.83),(.035,.042,.052),(.98,.99,1),(.62,.018,.025),(.66,.48,.23),(.015,.02,.022),(.96,.99,1)]
def bsdf(mat):
 if mat in (3,7):return {'type':'dielectric','int_ior':1.52 if mat==3 else 1.333,'ext_ior':1.000277}
 return {'type':'principled','base_color':{'type':'rgb','value':colors[mat]},'metallic':[1,1,.75,0,.1,1,0,0][mat],'roughness':[.23,.13,.32,0,.28,.3,.6,0][mat],'anisotropic':.25 if mat in (0,1,5) else 0}
counter=0
def add(v,f,n,mat,label):
 global counter
 path=out/f'{counter:03d}.ply';write_binary_ply(path,v,n,f)
 scene[f'part_{counter}']={'type':'ply','filename':str(path),'face_normals':False,'bsdf':bsdf(mat)};counter+=1
for name,offset in zip(routes['spec']['ports'],state['offsets']):
 a=load_cache(build/'geometry-v4'/name)
 for mat in range(8):
  parts=[p for p in a.parts if p.material==mat and not(mat==7 and name=='elements')]
  if not parts:continue
  v=[];n=[];f=[];base=0
  for part in parts:v.append(part.vertices+[offset,0,0]);n.append(part.normals);f.append(part.faces+base);base+=len(part.vertices)
  add(np.vstack(v),np.vstack(f),np.vstack(n),mat,name)
for route in state['parts']:
 if route['name']!='geo' and '-' not in route['name']:continue
 v,f=tube_mesh(route['points'],2.35,20)
 import trimesh
 mesh=trimesh.Trimesh(v,f,process=False);add(v,f,mesh.vertex_normals,4,route['name'])
m=json.loads((build/'fluid-v4-contact/manifest.json').read_text());frame=m['frames'][24];raw=gzip.decompress((build/'fluid-v4-contact'/frame['file']).read_bytes());count=frame['count']
v=np.frombuffer(raw,dtype='<i2',count=count*3).reshape(-1,3).astype(float)/512;v[:,0]+=state['offsets'][2]
n=np.frombuffer(raw,dtype='<i2',offset=count*6).reshape(-1,3).astype(float)/32767
add(v,np.arange(count).reshape(-1,3),n,7,'fluid')
beauty,albedo,normal,channels=_render_linear(mi,scene,args.spp)
_save_png(beauty,out/'instrument-noisy.png',1.04)
denoised=_oidn(beauty,albedo,normal,out,build/'tools/oidn-2.5.1.x64.windows/bin/oidnDenoise.exe')
_save_png(denoised,out/'instrument.png',1.04)
(out/'receipt.json').write_text(json.dumps({'variant':variant,'spp':args.spp,'depth':16,'shapes':counter,'same_geometry_cache':'geometry-v4','fluid_frame':24,'renderer':'CYBR GEO V9 Mitsuba/OIDN helpers; explicit dielectric extension','caveat':'Reference render, not browser output or a measured optical system'},indent=2))
print(str(out/'instrument.png'))
