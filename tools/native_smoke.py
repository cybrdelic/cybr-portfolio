"""Render a real retained GEO component through the production native CPU entrypoint."""
from pathlib import Path
import argparse,gzip,json,sys,hashlib,subprocess,time
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.local/native-smoke'
OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT/'cybr-light/python'))
from cybrlight import Scene,Camera,Settings,read_pfm
parser=argparse.ArgumentParser();parser.add_argument('--exe',type=Path,required=True);parser.add_argument('--label',required=True);args=parser.parse_args();args.exe=args.exe.resolve()
base=ROOT/'portfolio/assets/instrument-working-v1'
m=json.loads((base/'manifest.json').read_text())
mesh=next(x for x in m['meshes'] if x['module']=='geo' and x['material']==0)
raw=gzip.decompress((base/'instrument.bin.gz').read_bytes())
def array(key,width):
    a=mesh[key];return np.frombuffer(raw,dtype=np.dtype(a['dtype']),count=a['count'],offset=a['offset']).reshape(-1,width)
v=array('positions',3).astype(float);n=array('normals',3).astype(float)/32767;f=array('indices',3)
children=[c for c in mesh['partRanges'] if c['indexCount']>=900 and c['indexCount']<=18000]
part=next((c for c in children if 'housing' in c['name']),children[0])
faces=f.reshape(-1)[part['firstIndex']:part['firstIndex']+part['indexCount']].reshape(-1,3)
used=np.unique(faces);lookup=np.full(len(v),-1);lookup[used]=np.arange(len(used));faces=lookup[faces]
v=v[used];n=n[used];center=(v.min(0)+v.max(0))/2;radius=float(np.max(v.max(0)-v.min(0)))
s=Scene('Current portfolio GEO / '+part['name'])
s.settings=Settings(width=192,height=128,spp=4,bands=4,max_depth=5,threads=1,seed=20261006)
direction=np.array([1.,-1.6,1.]);direction/=np.linalg.norm(direction)
s.camera=Camera(origin=(center+direction*radius*2.8).tolist(),target=center.tolist(),up=[0,0,1],fov=35)
mat=s.material(type='metal',color=[.72,.74,.76],roughness=.23,eta=[1.4,.85,.7],k=[7.5,6.,5.])
s.mesh(v,faces,mat,normals=n)
s.environment={'color':[.8,.85,.95],'strength':.6,'lobes':[]}
light=s.material(type='diffuse',color=[1,1,1],emission=12)
s.rectangle(center+[radius,0,radius*2],[-radius*1.5,0,0],[0,radius*1.5,0],light)
scene=OUT/'current-geo.cys';s.save(scene)
prefix=OUT/args.label
t=time.monotonic()
r=subprocess.run([str(args.exe),'--scene',str(scene),'--out',str(prefix)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=90)
(OUT/(args.label+'.log')).write_text(r.stdout+'\n'+r.stderr,encoding='utf-8')
if r.returncode:raise SystemExit(r.stderr)
pixels=read_pfm(prefix.with_suffix('.pfm'))
assert np.isfinite(pixels).all() and np.max(pixels)>.02 and np.std(pixels)>.005
display=np.clip(pixels/(1+pixels),0,1)**(1/2.2)
Image.fromarray(np.uint8(display*255+.5)).save(prefix.with_suffix('.png'))
proof={'label':args.label,'part':part['name'],'triangles':len(faces),'source_geometry_sha256':hashlib.sha256((base/'instrument.bin.gz').read_bytes()).hexdigest(),
       'exe_sha256':hashlib.sha256(args.exe.read_bytes()).hexdigest(),'scene_sha256':hashlib.sha256(scene.read_bytes()).hexdigest(),
       'seed':20261006,'camera':{'origin':s.camera.origin,'target':s.camera.target,'up':s.camera.up,'fov':35},
       'settings':{'size':[192,128],'spp':4,'bands':4,'max_depth':5,'threads':1},'seconds':time.monotonic()-t,
       'finite_pixels':True,'pixel_std':float(np.std(pixels)),'pixel_sha256':hashlib.sha256(pixels.tobytes()).hexdigest(),
       'scope':'Actual retained GEO component and production CPU renderer; not a full six-module browser render.'}
(OUT/(args.label+'-proof.json')).write_text(json.dumps(proof,indent=2),encoding='utf-8')
print(json.dumps(proof))
