"""Unoccluded module sprites and camera-projected connector metadata.

Unlike object-ID cuts from a full scene, these remain complete when rearranged.
"""
from pathlib import Path
from PIL import Image
import argparse, json, hashlib
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
NAMES=('geo','light','elements','song','combat','scenes')
OFFSETS=(-245,-104,9,111,220,345)
PORTS={'light':((14,-36,18),(14,-36,18)), 'elements':((-35,-8,-2.5),(35,-8,-2.5)),
       'song':((-35,0,0),(36,0,0)), 'combat':((-34,0,0),(35,0,0)),
       'scenes':((-36,0,0),(-36,0,0)), 'geo':((0,0,0),(0,0,0))}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--folder',type=Path,required=True)
    p.add_argument('--width',type=int,default=640);p.add_argument('--spp',type=int,default=64)
    p.add_argument('--revision',default='v7')
    p.add_argument('--elements-revision')
    p.add_argument('--light-revision')
    args=p.parse_args();out=ROOT/'portfolio/assets/instrument'
    direction=np.array([-50,80,-50.]);direction/=np.linalg.norm(direction)
    right=np.cross(direction,[0,0,1]);right/=np.linalg.norm(right);up=np.cross(right,direction)
    def project(v):return np.array([800+np.dot(v-[35,0,0],right)*2.5,500-np.dot(v-[35,0,0],up)*2.5])
    layout=[];receipt=[];decoded=0
    for name,offset in zip(NAMES,OFFSETS):
        revision=(args.elements_revision if name=='elements' else args.light_revision if name=='light' else None) or args.revision
        source=args.folder/'renders'/name/f'{name}-{revision}-{args.width}-{args.spp}spp.webp'
        im=Image.open(source).convert('RGBA');box=im.getchannel('A').getbbox()
        info=json.loads((args.folder/'geometry-v3'/name/'manifest.json').read_text())
        bounds=np.array([p['bounds_mm'] for p in info['parts']]);mid=(bounds[:,0].min(0)+bounds[:,1].max(0))/2
        center=project(mid+[offset,0,0]);scale=(1000/10)/(im.height/3)
        corner=center+(np.array(box[:2])-np.array(im.size)/2)*scale
        size=(np.array(box[2:])-box[:2])*scale
        crop=im.crop(box);target=out/f'{name}.webp';crop.save(target,'WEBP',quality=96,method=6)
        decoded+=crop.width*crop.height
        props=f'left:{corner[0]/16:.6f}%;top:{corner[1]/10:.6f}%;width:{size[0]/16:.6f}%;height:{size[1]/10:.6f}%;'
        for label,port in zip(('in','out'),PORTS[name]):
            point=project(np.array(port)+[offset,0,0])
            props+=f'--{label}-x:{point[0]:.5f};--{label}-y:{point[1]:.5f};'
        layout.append(f'.sculpture .piece[data-part="{name}"]'+'{'+props+'object-fit:contain;}')
        if name=='light':crop.save(out/'optic.webp','WEBP',quality=96,method=6)
        crop.thumbnail((120,85));crop.save(out/f'thumb-{name}.webp','WEBP',quality=92,method=6)
        bake_report=source.with_name(source.stem+'-bake.json')
        finish=json.loads(bake_report.read_text()).get('finish_profile','legacy') if bake_report.exists() else 'unknown'
        receipt.append({'name':name,'source':str(source),'finish_profile':finish,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bounds_px':[*corner,*(corner+size)],'source_crop_px':box})
    (out/'layout.css').write_text('\n'.join(layout))
    (out/'provenance.json').write_text(json.dumps({'layers':receipt,'decoded_rgba_bytes':decoded*4,'note':'Independent CYBR Light bakes. SVG external cable spans are length-constrained presentation geometry, not a physics simulation. Reflections are baked.'},indent=2))
    print(json.dumps({'sprites':len(receipt),'bytes':sum(r['bytes'] for r in receipt),'decoded_bytes':decoded*4}))
