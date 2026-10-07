"""Package existing targeted receipts for staging, never claim final approval."""
from pathlib import Path
import gzip,hashlib,json,shutil
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
BUILD=Path('D:/CYBR-build/exploded-instrument')
source=BUILD/'container-c-targeted/path-bake-light';out=ROOT/'assets/instrument-targeted-path';out.mkdir(exist_ok=True)
old=json.loads((ROOT/'assets/instrument-3d/manifest.json').read_text())
new=json.loads((ROOT/'assets/instrument-cartridges-c/manifest.json').read_text())
native=json.loads((BUILD/'container-c-assembly/native-manifest.json').read_text())
assert new['nativeGeometryHash']==native['stats']['sha256']
original=json.loads((ROOT/'assets/instrument-path-light/manifest.json').read_text())
assert original['sourceGeometry']==old['stats']['sha256']
raw=gzip.decompress((ROOT/'assets/instrument-3d/instrument.bin.gz').read_bytes())
nativeFile=source/'006/native-geometry.bin'
assert nativeFile.is_file()
mapped=np.memmap(nativeFile,dtype='u1',mode='r')
assert hashlib.sha256(mapped).hexdigest()==native['stats']['sha256']
def attr(buffer,record,key):
    s=record[key];return np.frombuffer(buffer,dtype={'float32':'<f4','int16':'<i2','uint32':'<u4'}[s['dtype']],offset=s['offset'],count=s['count'])
verified=[]
for m in old['meshes']:
    if m['module'] not in ('geo','light','elements','song'):continue
    match=next(x for x in native['meshes'] if (x['module'],x['feature'],x['material'])==(m['module'],m['feature'],m['material']))
    for key in ('positions','indices','normals','uv'):
        a=attr(raw,m,key);b=attr(mapped,match,key)
        assert len(a)==len(b)
        for start in range(0,len(a),8192):
            part=a[start:start+8192]
            if key=='normals':part=part.astype('float32')/32767
            assert np.array_equal(part,b[start:start+8192]),(m['module'],key)
    verified.append('/'.join(map(str,(m['module'],m['feature'],m['material']))))
proof=dict(geometryVerified=True,originalGeometry=original['sourceGeometry'],targetGeometry=new['stats']['sha256'],verifiedSurfaces=verified,indirectLightingReviewPending=True)
path=json.loads((source/'path.json').read_text());frames=[];surfaces=None
for index,state in enumerate(path['frames']):
    folder=source/f'{index:03d}'
    if not (folder/'receipt.json').is_file():break
    r=json.loads((folder/'receipt.json').read_text())
    assert r['complete'] and not r['draft'] and r['sourceGeometry']==new['stats']['sha256']
    assert (r['width'],r['height'],r['spp'],r['bands'])==(1280,800,128,8)
    assert r['nativeReport']['gpu_execution'] and r['nativeReport']['invalid_path_samples']==0
    for key in ('world','projection','groups','objects','renderRegion'):assert r[key]==state[key]
    if surfaces is not None:assert r['surfaces']==surfaces
    surfaces=r['surfaces'];assert all(n.split('/')[0] in ('combat','scenes') for n in surfaces)
    frame={k:r[k] for k in ('index','progress','world','projection','groups','objects','depthRange','width','height','spp')}
    hashes=[]
    for key,name in [('color','beauty.webp'),('visibility','visibility.png')]:
        file=folder/name;assert file.stat().st_size>0
        hashes.append(hashlib.sha256(file.read_bytes()).hexdigest());frame[key]=f'{index:03d}-{name}'
        shutil.copyfile(file,out/frame[key])
    frame['hash']=hashlib.sha256(''.join(hashes).encode()).hexdigest()[:16];frames.append(frame)
assert frames
result=dict(version=2,complete=False,renderComplete=len(frames)==len(path['frames']),frames=frames,surfaces=surfaces,sourceGeometry=new['stats']['sha256'],expectedFrames=len(path['frames']),visualApproval=False,stagingOnly=True)
(out/'reuse-proof.json').write_text(json.dumps(proof,indent=2))
temp=out/'manifest.pending.json';temp.write_text(json.dumps(result));temp.replace(out/'manifest.json')
print(json.dumps(dict(frames=len(frames),verifiedSurfaces=len(verified),stagingOnly=True)))
