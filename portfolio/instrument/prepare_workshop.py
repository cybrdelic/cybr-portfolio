"""Package captured V9 illumination, retaining linear HDR values and provenance."""
from pathlib import Path
import sys,json,gzip,hashlib
import mitsuba as mi,numpy as np
mi.set_variant('scalar_rgb')
build=Path(sys.argv[1]);out=Path(sys.argv[2]);source=build/'v9/assets/small_workshop_2k.hdr'
bitmap=mi.Bitmap(str(source)).convert(mi.Bitmap.PixelFormat.RGB,mi.Struct.Type.Float32,False)
env=np.array(bitmap);env=(env[0::2,0::2]+env[1::2,0::2]+env[0::2,1::2]+env[1::2,1::2])*.25
rgba=np.concatenate([env,np.ones((*env.shape[:2],1))],axis=2).astype('<f4')
raw=gzip.compress(rgba[::-1].tobytes(),compresslevel=9,mtime=0);(out/'workshop.f32.gz').write_bytes(raw)
m=json.loads((out/'manifest.json').read_text());m['environment']={'width':rgba.shape[1],'height':rgba.shape[0],'file':'workshop.f32.gz','format':'linear RGBA float32, bottom-up','rotationZ':195,'intensity':.72,'source':'Poly Haven small_workshop 2k, CC0, CYBR GEO V9 asset','sha256':hashlib.sha256(raw).hexdigest()};(out/'manifest.json').write_text(json.dumps(m,separators=(',',':')))
print(json.dumps(m['environment']))
