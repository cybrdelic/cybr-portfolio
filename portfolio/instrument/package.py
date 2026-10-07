"""Publish compact render layers to the local preview; never publish raw buffers."""
from pathlib import Path
from PIL import Image
import shutil,json,hashlib,sys,argparse
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('prefix',type=Path);parser.add_argument('--suffix',default='');parser.add_argument('--optic',type=Path);parser.add_argument('--cage',type=Path);args=parser.parse_args()
prefix=args.prefix;suffix=args.suffix
out=ROOT/'portfolio/assets/instrument';out.mkdir(parents=True,exist_ok=True)
receipt=[];layout=[];decoded_pixels=0
for name in ('geo','light','elements','song','combat','scenes','conduit'):
    source=prefix.with_name(prefix.name+'-'+name+suffix+'.webp')
    target=out/(name+'.webp')
    image=Image.open(source).convert('RGBA');box=image.getchannel('A').getbbox()
    frame_width,frame_height=image.size
    placement=box
    if name=='scenes' and args.cage:
        source=args.cage;image=Image.open(source).convert('RGBA');box=image.getchannel('A').getbbox()
        info=json.loads((prefix.parents[2]/'geometry-v2/scenes/manifest.json').read_text())
        bounds=np.array([p['bounds_mm'] for p in info['parts']]);local_center=(bounds[:,0].min(0)+bounds[:,1].max(0))/2
        direction=np.array([-50,80,-50.]);direction/=np.linalg.norm(direction)
        right=np.cross(direction,[0,0,1]);right/=np.linalg.norm(right);up=np.cross(right,direction)
        delta=local_center+np.array([345,0,0])-np.array([35,0,0])
        center=np.array([frame_width/2+np.dot(delta,right)*frame_height/(9.1*40),frame_height/2-np.dot(delta,up)*frame_height/(9.1*40)])
        scale=(frame_height/9.1)/(image.height/3)
        corner=center+(np.array(box[:2])-np.array(image.size)/2)*scale
        placement=(*corner,*(corner+(np.array(box[2:])-np.array(box[:2]))*scale))
    if box is None:raise ValueError('Empty component '+name)
    crop=image.crop(box)
    crop.save(target,'WEBP',quality=94,method=6)
    decoded_pixels+=crop.width*crop.height
    selector='.conduit' if name=='conduit' else f'[data-part="{name}"]'
    layout.append(f'.sculpture .piece{selector}'+'{'+f'left:{placement[0]/frame_width*100:.6f}%;top:{placement[1]/frame_height*100:.6f}%;width:{(placement[2]-placement[0])/frame_width*100:.6f}%;height:{(placement[3]-placement[1])/frame_height*100:.6f}%;object-fit:contain;'+'}')
    if name=='light':crop.save(out/'optic.webp','WEBP',quality=96,method=6)
    if name!='conduit':
        crop.thumbnail((100,70));crop.save(out/('thumb-'+name+'.webp'),'WEBP',quality=92,method=6)
    receipt.append({'name':name,'source':str(source),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bounds_px':placement,'source_crop_px':box})
(out/'layout.css').write_text('\n'.join(layout))
if args.optic:
    optic=Image.open(args.optic).convert('RGBA');box=optic.getchannel('A').getbbox()
    optic.crop(box).save(out/'optic.webp','WEBP',quality=96,method=6)
(out/'provenance.json').write_text(json.dumps({'source_prefix':str(prefix),'layers':receipt,'decoded_rgba_bytes':decoded_pixels*4,'note':'Cropped baked image layers; inter-component reflections are not recomputed during slider use.'},indent=2))
print(json.dumps({'files':len(list(out.glob('*.webp'))),'total_webp_bytes':sum(p.stat().st_size for p in out.glob('*.webp')),'provenance':str(out/'provenance.json')}))
