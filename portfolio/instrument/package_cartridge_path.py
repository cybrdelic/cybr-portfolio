"""Publish only a complete, reviewed, geometry-matched replacement path.

Approval file: {"sourceGeometry": "...", "approvedIndices": [0,...,48]}.
Rendering completion and numerical validity are not visual approval.
"""
from pathlib import Path
import argparse,hashlib,json,shutil

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--approval',type=Path,required=True);a=p.parse_args()
    root=Path(__file__).resolve().parents[1];geometry=json.loads((root/'assets/instrument-cartridges-v1/manifest.json').read_text())['stats']['sha256']
    path=json.loads((a.source/'path.json').read_text());approval=json.loads(a.approval.read_text());count=len(path['frames'])
    assert count==49 and approval['sourceGeometry']==geometry
    assert sorted(set(approval['approvedIndices']))==list(range(count)),'All camera states require review'
    records=[];surfaces=None
    for index,state in enumerate(path['frames']):
        folder=a.source/f'{index:03d}';r=json.loads((folder/'receipt.json').read_text())
        assert r['complete'] and not r['draft'] and r['sourceGeometry']==geometry
        assert r['width']>=1280 and r['spp']>=128 and r['bands']>=8
        assert r['nativeReport']['gpu_execution'] and r['nativeReport']['invalid_path_samples']==0
        for field in ('progress','projection','world','groups','objects','cables'):assert r[field]==state[field]
        if surfaces is not None:assert surfaces==r['surfaces']
        surfaces=r['surfaces'];assert len(set(surfaces.values()))==len(surfaces)
        entry={k:r[k] for k in ('index','progress','projection','world','groups','objects','depthRange','width','height','spp')}
        hashes=[]
        for key,name in [('color','beauty.webp'),('visibility','visibility.png')]:
            file=folder/name;assert file.stat().st_size>0
            hashes.append(hashlib.sha256(file.read_bytes()).hexdigest());entry[key]=f'{index:03d}-{name}'
        entry['hash']=hashlib.sha256(''.join(hashes).encode()).hexdigest()[:16];records.append((folder,entry))
    # Validate every receipt/file before the first publication write.
    out=root/'assets/instrument-cartridges-path';out.mkdir(exist_ok=True);total=0
    for folder,entry in records:
        for key,name in [('color','beauty.webp'),('visibility','visibility.png')]:
            shutil.copyfile(folder/name,out/entry[key]);total+=(out/entry[key]).stat().st_size
    result=dict(version=2,complete=True,frames=[e for _,e in records],surfaces=surfaces,sourceGeometry=geometry,expectedFrames=count,bytes=total,renderer='CYBR LIGHT native OptiX spectral + OIDN',transport='Real mesh, fixed authored camera path, depth/ID-gated optical bake',visualApproval=approval)
    pending=out/'manifest.pending.json';pending.write_text(json.dumps(result));pending.replace(out/'manifest.json')
    print(json.dumps(dict(frames=count,bytes=total,output=str(out))))

if __name__=='__main__':main()
