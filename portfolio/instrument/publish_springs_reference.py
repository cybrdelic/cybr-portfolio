"""Finish and publish only a completed source-native reference, never a mockup."""
from pathlib import Path
import json,subprocess,sys,os,shutil
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'cybr-scenes/environments'
work=Path(sys.argv[1]).resolve();status=json.loads((work/'status.json').read_text())
if status['phase']!='complete':
    # A completed film can be recovered after the separately recorded allocator
    # shutdown fault, but only after a clean lifetime regression test is present.
    proof=work/'allocator-cleanup-test.json'
    if not proof.exists():
        with (work/'allocator-cleanup-test.log').open('w') as log:
            result=subprocess.run(['cmd.exe','/d','/c',str(ROOT/'portfolio/instrument/test_springs_allocator.cmd'),str(work)],cwd=work,stdout=log,stderr=log)
        proof.write_text(json.dumps({'passed':result.returncode==0,'exit_code':result.returncode,'scope':'Global vector destruction, growth/reallocation, multiple mapped element types'}))
    if not proof.exists() or not json.loads(proof.read_text()).get('passed'):raise RuntimeError('Reference render is not complete and has no cleanup validation')
    report=json.loads((work/'hero.json').read_text())
    assert report['nonfinite_path_samples']==0 and report['width']==960 and report['height']==640
    for suffix,channels,size,header in [('.guides',9,4,8),('.samples',1,2,8)]:
        assert (work/('hero'+suffix)).stat().st_size==header+960*640*channels*size
    with (work/'hero.pfm').open('rb') as stream:
        assert stream.readline().strip()==b'PF';assert stream.readline().strip()==b'960 640';stream.readline()
        raw=np.fromfile(stream,dtype='<f4');assert raw.size==960*640*3 and np.isfinite(raw).all()
env=os.environ.copy();env.update(NUMBA_NUM_THREADS='5',OMP_NUM_THREADS='4',OPENBLAS_NUM_THREADS='1')
with (work/'finish-r2.log').open('w') as log:
    subprocess.run([sys.executable,str(SOURCE/'tools/finish_r2.py'),'--backend','hot',str(work/'hero'),'--passes','2','--white-balance','5750','--opaque-filter-strength','.50'],env=env,stdout=log,stderr=log,check=True)
original=SOURCE/'renders/desert-hot-springs/hero/hero.png'
a=np.asarray(Image.open(original).convert('RGB'),dtype=float);b=np.asarray(Image.open(work/'hero.png').convert('RGB'),dtype=float)
assert a.shape==b.shape and np.isfinite(b).all()
report=json.loads((work/'hero.json').read_text());assert report['nonfinite_path_samples']==0
delta=np.abs(a-b)
comparison={'reference':str(original),'reproduced':str(work/'hero.png'),'size':[a.shape[1],a.shape[0]],'mean_absolute_error_255':float(delta.mean()),'p99_absolute_error_255':float(np.quantile(delta,.99)),'source_hash_matches':status['source_hash_matches'],'r2_hash_matches':status['r2_hash_matches'],'renderer':report['renderer'],'visual_approval':False,'recovered_after_shutdown_error':status['phase']!='complete','note':'Original R2 finish, original full geometry recipe. No compression, texture projection or image generation.'}
(work/'comparison.json').write_text(json.dumps(comparison,indent=2))
publish=ROOT/'portfolio/assets/springs-faithful';publish.mkdir(exist_ok=True)
shutil.copy2(work/'hero.png',publish/'reproduced.png');shutil.copy2(work/'comparison.json',publish/'comparison.json')
print(json.dumps(comparison))
