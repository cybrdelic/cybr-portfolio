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
packed=gzip.compress(encoded,compresslevel=9,mtime=0)
name='instrument.lossless-v1.bin.gz'
(BASE/name).write_bytes(packed)
manifest['losslessTransfer']=dict(format='attribute-xor-byteplanes-gzip-v1',file=name,bytes=len(packed),
    sha256=hashlib.sha256(packed).hexdigest(),originalCompressedBytes=len(original),
    decodedSHA256=manifest['stats']['sha256'])
# GEO is the contiguous native prefix. Require this layout explicitly;
# future exports must not silently bundle another component into the starter.
geo=[mesh for mesh in manifest['meshes'] if mesh['module']=='geo']
segments=[(spec['offset'],spec['offset']+spec['count']*(2 if spec['dtype']=='int16' else 4))
    for mesh in geo for key,spec in mesh.items() if key in strides]
geo_end=max(end for start,end in segments)
assert min(start for start,end in segments)==0
assert all(spec['offset']>=geo_end for mesh in manifest['meshes'] if mesh['module']!='geo'
    for key,spec in mesh.items() if key in strides)
geo_raw=raw[:geo_end];geo_packed=gzip.compress(encoded[:geo_end],compresslevel=9,mtime=0)
geo_name='geo.lossless-v1.bin.gz';(BASE/geo_name).write_bytes(geo_packed)
manifest['progressiveGeo']=dict(format='attribute-xor-byteplanes-gzip-v1',file=geo_name,
    bytes=len(geo_packed),sha256=hashlib.sha256(geo_packed).hexdigest(),
    sha256Decoded=hashlib.sha256(geo_raw).hexdigest(),decodedBytes=geo_end,meshes=len(geo))
path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(manifest['losslessTransfer'],indent=2))
