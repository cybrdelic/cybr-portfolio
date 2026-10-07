"""Structural acceptance gate; image/motion QA is separately required."""
from pathlib import Path
import json,hashlib,numpy as np,sys
from PIL import Image
root=Path(__file__).resolve().parents[1];folder=root/'assets'/('instrument-path-light' if '--cybr-light' in sys.argv else 'instrument-path')
m=json.loads((folder/'manifest.json').read_text());geometry=json.loads((root/'assets/instrument-3d/manifest.json').read_text())
assert m['sourceGeometry']==geometry['stats']['sha256']
assert len(m['modules'])==6 and len(set(m['surfaces'].values()))==len(m['surfaces'])
assert len({n.split('/')[0] for n in m['surfaces']})==6
previous=-1;total=0
for f in m['frames']:
    assert f['progress']>previous;previous=f['progress']
    assert f['spp']>=128 and f['width']>=1280
    assert np.isfinite(f['projection']).all() and np.isfinite(f['world']).all()
    assert np.linalg.det(np.array(f['projection']).reshape(4,4))!=0
    assert f['depthRange'][1]>f['depthRange'][0]
    hashes=[]
    for key in ['color','visibility']:
        b=(folder/f[key]).read_bytes();total+=len(b);hashes.append(hashlib.sha256(b).hexdigest())
        with Image.open(folder/f[key]) as image:assert image.size==(f['width'],f['height'])
    assert hashlib.sha256(''.join(hashes).encode()).hexdigest()[:16]==f['hash']
    ids=np.asarray(Image.open(folder/f['visibility']))[:,:,2]
    assert np.all(np.isin(np.unique(ids),[0,*m['surfaces'].values(),*range(200,206)]))
assert total==m['bytes']
if m['complete']:assert len(m['frames'])==m['expectedFrames'] and m['frames'][0]['progress']==0 and m['frames'][-1]['progress']==1
print(json.dumps({'frames':len(m['frames']),'expected':m['expectedFrames'],'complete':m['complete'],'modules':6,'bytes':total,'hashes':True,'geometry_match':True,'visual_approval':False}))
