from pathlib import Path
import json,gzip,hashlib,struct,sys
import numpy as np
base=Path(sys.argv[1]);m=json.loads((base/'manifest.json').read_text());assert m['complete'] and len(m['frames'])==72
total=0
for item in [*m['static'].values(),*m['frames']]:
 packed=(base/item['file']).read_bytes();assert len(packed)==item['bytes'] and hashlib.sha256(packed).hexdigest()==item['sha256'];total+=len(packed)
 raw=gzip.decompress(packed);size=struct.unpack_from('<I',raw)[0];meta=json.loads(raw[4:4+size]);start=4+(size+3)//4*4
 assert set(meta)=={'index','position','bvhBounds','bvhContents','normal','material'}
 for key,s in meta.items():
  dtype={'Float32Array':'<f4','Uint32Array':'<u4','Uint16Array':'<u2','Uint8Array':'u1','Int32Array':'<i4','Int16Array':'<i2','Int8Array':'i1'}[s['dtype']]
  a=np.frombuffer(raw,dtype=dtype,count=s['length'],offset=start+s['offset']);assert np.isfinite(a).all();assert s['width']>0 and s['height']>0
print(json.dumps({'static_modules':len(m['static']),'fluid_states':len(m['frames']),'validated_bytes':total,'finite_textures':True,'hashes':True}))
