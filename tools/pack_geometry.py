"""Reproduce the lossless browser transfer from the retained original CAD gzip."""
from pathlib import Path
import gzip, hashlib, json
import numpy as np

BASE=Path(__file__).resolve().parents[1]/'portfolio/assets/instrument-working-v1'
path=BASE/'manifest.json'
manifest=json.loads(path.read_text(encoding='utf-8'))
original=(BASE/'instrument.bin.gz').read_bytes()
raw=gzip.decompress(original)
assert len(raw)==manifest['stats']['decodedGeometryBytes']
assert hashlib.sha256(raw).hexdigest()==manifest['stats']['sha256']
strides=dict(positions=3,normals=3,indices=1,uv=2,occlusion=1,finish=2,colors=3)
encoded=bytearray(raw)
for mesh in manifest['meshes']:
    for key,stride in strides.items():
        if key not in mesh: continue
        spec=mesh[key];off,n=spec['offset'],spec['count']
        width=2 if spec['dtype']=='int16' else 4
        words=np.frombuffer(raw,dtype=f'<u{width}',offset=off,count=n)
        predicted=words.copy();predicted[stride:]=words[stride:]^words[:-stride]
        encoded[off:off+n*width]=predicted.view(np.uint8).reshape(-1,width).T.copy().tobytes()
packed=gzip.compress(encoded,compresslevel=6,mtime=0)
name='instrument.lossless-v1.bin.gz'
(BASE/name).write_bytes(packed)
manifest['losslessTransfer']=dict(format='attribute-xor-byteplanes-gzip-v1',file=name,bytes=len(packed),
    sha256=hashlib.sha256(packed).hexdigest(),originalCompressedBytes=len(original),
    decodedSHA256=manifest['stats']['sha256'])
path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest['losslessTransfer'],indent=2))
