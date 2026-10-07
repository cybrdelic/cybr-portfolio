"""Conservative screen bounds for changed modules; never discard transport geometry."""
from pathlib import Path
import itertools,json
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
BUILD=Path('D:/CYBR-build/exploded-instrument')
source=json.loads((BUILD/'container-c-bake/path-bake-light/path.json').read_text())
manifest=json.loads((ROOT/'assets/instrument-cartridges-c/manifest.json').read_text())
targets=[m for m in manifest['modules'] if m['name'] in ('combat','scenes')]
frames=[];skipped=[]
for index,state in enumerate(source['frames']):
    projection=np.array(state['projection']).reshape(4,4,order='F')
    view=np.linalg.inv(np.array(state['world']).reshape(4,4,order='F'))
    offsets={g['name']:g['x'] for g in state['groups']};rects=[]
    for module in targets:
        lo,hi=np.array(module['bounds']);points=np.array(list(itertools.product(*zip(lo,hi))))
        points[:,0]+=offsets[module['name']]
        clip=np.c_[points,np.ones(8)]@(projection@view).T
        if np.all(clip[:,3]<=0):continue
        if np.any(clip[:,3]<=0):rects.append([0,0,1280,800]);continue
        ndc=clip[:,:2]/clip[:,3,None]
        pixels=(ndc*np.array([.5,-.5])+.5)*[1280,800]
        low=np.floor(pixels.min(0)-32).astype(int);high=np.ceil(pixels.max(0)+32).astype(int)
        low=np.maximum(low,[0,0]);high=np.minimum(high,[1280,800])
        if np.all(high>low):rects.append([*low.tolist(),*high.tolist()])
    if not rects:skipped.append(index);continue
    region=[min(r[0] for r in rects),min(r[1] for r in rects),max(r[2] for r in rects),max(r[3] for r in rects)]
    frames.append(dict(state,originalIndex=index,renderRegion=region,targetedModules=['combat','scenes']))
out=BUILD/'container-c-targeted/path-bake-light';out.mkdir(parents=True,exist_ok=True)
result=dict(source,frames=frames,targetedModules=['combat','scenes'],skippedOffscreen=skipped,fullSceneTransport=True,visualApproval=False)
(out/'path.json').write_text(json.dumps(result))
areas=[(f['renderRegion'][2]-f['renderRegion'][0])*(f['renderRegion'][3]-f['renderRegion'][1])/(1280*800) for f in frames]
print(json.dumps(dict(views=len(frames),skipped=skipped,meanPixelFraction=float(np.mean(areas)),firstRegion=frames[0]['renderRegion'])))
