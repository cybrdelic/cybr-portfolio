"""Bake object-space bed height/radiance for terrain-anchored water optics."""
from pathlib import Path
import json,gzip
import numpy as np
from stitch_springs_cartridge import raster

p=Path(__file__).resolve().parents[1]/'assets/springs-cartridge-v3'
doc=json.loads((p/'manifest.json').read_text())
data=gzip.decompress((p/'geometry.bin.gz').read_bytes())
m=next(m for m in doc['meshes'] if m['name']=='Continuous fused terrain and ridge')
def attr(key):
    s=m[key]
    return np.frombuffer(data,'<u4' if key=='index' else '<f4',s['count'],s['offset']).reshape(-1,s['size'])
h,c=raster(attr('position'),attr('color'),attr('index').reshape(-1,3),901,2.265)
h[h<-1e8]=-.5
field=np.concatenate([c,h[:,:,None]],axis=2).astype('<f4')
(p/'pool-field.bin.gz').write_bytes(gzip.compress(field.tobytes(),6,mtime=0))
print(json.dumps(dict(size=901,bytes=field.nbytes,minHeight=float(h.min()),maxHeight=float(h.max()),finite=bool(np.isfinite(field).all()))))
