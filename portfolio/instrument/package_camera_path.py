"""Package completed camera checkpoints. Partial bakes are explicitly labelled."""
from pathlib import Path
import argparse,hashlib,json,shutil
p=argparse.ArgumentParser();p.add_argument('--build',type=Path,required=True);p.add_argument('--min-spp',type=int,default=128);p.add_argument('--min-width',type=int,default=1280);p.add_argument('--cybr-light',action='store_true');args=p.parse_args()
source=args.build/('path-bake-light' if args.cybr_light else 'path-bake');root=Path(__file__).resolve().parents[1];out=root/'assets'/('instrument-path-light' if args.cybr_light else 'instrument-path');out.mkdir(exist_ok=True)
path=json.loads((source/'path.json').read_text());frames=[];surfaces=None;total=0
geometry=json.loads((root/'assets/instrument-3d/manifest.json').read_text())['stats']['sha256']
for index,state in enumerate(path['frames']):
    folder=source/f'{index:03d}';receipt=folder/'receipt.json'
    if not receipt.exists():continue
    r=json.loads(receipt.read_text());assert r['complete'] and r['sourceGeometry']==geometry
    if args.cybr_light:
        assert r['renderer'].startswith('CYBR LIGHT') and r['bands']>=8 and not r.get('draft')
    if r['spp']<args.min_spp or r['width']<args.min_width:continue
    assert abs(r['progress']-state['progress'])<1e-9
    assert r['projection']==state['projection'] and r['world']==state['world']
    assert r['groups']==state['groups'] and r['objects']==state['objects']
    if surfaces is not None:assert surfaces==r['surfaces']
    surfaces=r['surfaces'];assert len(set(surfaces.values()))==len(surfaces)
    assert len({name.split('/')[0] for name in surfaces})==6
    entry={k:r[k] for k in ['index','progress','projection','world','groups','objects','depthRange','width','height','spp']}
    hashes=[]
    for key,filename in [('color','beauty.webp'),('visibility','visibility.png')]:
        dest=f'{index:03d}-{filename}';shutil.copyfile(folder/filename,out/dest);b=(out/dest).read_bytes();total+=len(b);hashes.append(hashlib.sha256(b).hexdigest());entry[key]=dest
    entry['hash']=hashlib.sha256(''.join(hashes).encode()).hexdigest()[:16];frames.append(entry)
manifest={'version':1,'complete':len(frames)==len(path['frames']),'frames':frames,'surfaces':surfaces,'sourceGeometry':geometry,'expectedFrames':len(path['frames']),'bytes':total,'modules':['geo','light','elements','song','combat','scenes'],'transport':'Offline whole-assembly path tracing, per-view depth/ID-gated geometry reprojection. Fixed authored camera path; not arbitrary-view rendering.'}
manifest['renderer']='CYBR LIGHT 0.2 native spectral' if args.cybr_light else 'Mitsuba'
(out/'manifest.pending.json').write_text(json.dumps(manifest));(out/'manifest.pending.json').replace(out/'manifest.json')
print(json.dumps({'frames':len(frames),'expected':len(path['frames']),'complete':manifest['complete'],'bytes':total,'out':str(out)}))
