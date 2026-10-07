"""Short-lived export/finish stages; release geometry libraries before GPU work."""
from pathlib import Path
import argparse,json

p=argparse.ArgumentParser();p.add_argument('--build',type=Path,required=True);p.add_argument('--index',type=int,required=True)
p.add_argument('--stage',choices=['export','finish'],required=True);a=p.parse_args()
build=a.build.resolve();folder=build/'path-bake-light';work=folder/f'{a.index:03d}';work.mkdir(exist_ok=True)
state=json.loads((folder/'path.json').read_text())['frames'][a.index]
if a.stage=='export':
    from bake_light_path import export
    geometry,surfaces,fluid=export(build,work,state,1280,128,8,8)
    (work/'gpu-export.json').write_text(json.dumps({'geometry':geometry,'surfaces':surfaces,'fluid':fluid}))
else:
    import numpy as np
    from PIL import Image
    from finish import denoise,display
    from cybrlight import read_pfm
    rgb=display(denoise(work/'native',build/'tools/oidn-2.5.1.x64.windows/bin/oidnDenoise.exe'))
    Image.fromarray(rgb).save(work/'beauty.png');Image.fromarray(rgb).save(work/'beauty.webp',lossless=True)
    positions=read_pfm(work/'native_position.pfm').astype(float)*40
    ids=np.rint(read_pfm(work/'native_object.pfm')[:,:,0]).astype(np.uint16);ids[ids>205]=0
    view=np.linalg.inv(np.array(state['world']).reshape(4,4,order='F'))
    depth=-(positions@view[2,:3]+view[2,3]);mask=ids>0
    assert mask.any() and np.isfinite(depth).all()
    lo,hi=float(depth[mask].min()),float(depth[mask].max())
    encoded=np.round(np.clip((depth-lo)/max(hi-lo,1e-6),0,1)*65535).astype(np.uint16)
    Image.fromarray(np.stack((encoded>>8,encoded&255,ids),axis=-1).astype(np.uint8)).save(work/'visibility.png')
    (work/'gpu-finish.json').write_text(json.dumps({'depthRange':[lo,hi]}))
