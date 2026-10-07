"""Package and validate the actual completed CYBR FLIP vessel simulation."""
from pathlib import Path
import argparse, gzip, hashlib, json, shutil
import numpy as np

root = Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=root/'portfolio/assets/instrument-fluid');p.add_argument('--out',type=Path,default=root/'portfolio/assets/instrument-elements-bake/water');a=p.parse_args()
source,out=a.source.resolve(),a.out.resolve()
out.mkdir(parents=True, exist_ok=True)
manifest = json.loads((source/'manifest.json').read_text())
assert manifest['complete'] and len(manifest['frames']) >= 2
worst_wall = -1e9
for frame in manifest['frames']:
    packed = (source/frame['file']).read_bytes()
    assert hashlib.sha256(packed).hexdigest() == frame['sha256']
    raw = gzip.decompress(packed)
    assert len(raw) == frame['count']*12
    p = np.frombuffer(raw, dtype='<i2', count=frame['count']*3).reshape(-1,3)/manifest['positionScale']
    assert np.isfinite(p).all() and frame['pressure']['converged'] and frame['solidViolations'] == 0
    # Recipe: 53 x 55 x 59 mm inner cavity with a 10 mm corner radius.
    q = np.abs(p)-np.array([16.5,17.5,19.5])
    sdf = np.linalg.norm(np.maximum(q,0),axis=1)+np.minimum(q.max(axis=1),0)-10
    worst_wall = max(worst_wall, float(sdf.max()))
    assert sdf.max() < .25, 'Water intersects the retained CAD vessel wall'
    shutil.copyfile(source/frame['file'], out/frame['file'])
manifest['lineage'] = {
    'source': str(source.relative_to(root)/'manifest.json'),
    'sourceSHA256': hashlib.sha256((source/'manifest.json').read_bytes()).hexdigest(),
    'solver': 'cybr-elements/work/flip-lettering/vendor/src/flip.js',
    'adapter': 'portfolio/instrument/bake_flip.mjs',
    'cadCavityMM': [53,55,59], 'cadCornerRadiusMM': 10,
    'allFramesVerified': True, 'worstCavitySDFMM': worst_wall,
    'playback': 'shared fire media clock; eased forward/back recorded surface; no live fluid solve',
}
(out/'manifest.json').write_text(json.dumps(manifest))
print(json.dumps({'frames':len(manifest['frames']),'worstCavitySDFMM':worst_wall,'out':str(out)}))
