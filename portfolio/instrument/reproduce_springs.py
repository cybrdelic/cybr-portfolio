"""Recover the original full-resolution hot-springs baseline without approximation.

Runs in an isolated build directory. Does not touch the released portfolio bakes.
Native source is compiled as-is with MSVC; reference self-tests must pass first.
"""
from pathlib import Path
import os,sys,json,subprocess,time,hashlib,argparse,shutil

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'cybr-scenes/environments'
HOT=SOURCE/'engines/hot/cybr-geo'
RECIPE=HOT/'examples/desert_hot_springs'

def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(8<<20),b''):h.update(block)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--build',type=Path,required=True);args=ap.parse_args()
    work=args.build.resolve();work.mkdir(parents=True,exist_ok=True)
    status=work/'status.json';lock=work/'job.lock'
    # Exclusive creation; never start a second render or overwrite a live lock.
    with lock.open('x') as f:json.dump({'pid':os.getpid(),'started':time.time()},f)
    start=time.time();state={'pid':os.getpid(),'started':start,'production_unchanged':True,'reference_renderer':'CYBR GEO hot native spectral (not CYBR LIGHT)'}
    def update(phase,**values):
        state.update(phase=phase,updated=time.time(),**values);temp=status.with_suffix('.pending');temp.write_text(json.dumps(state,indent=2));temp.replace(status);print(phase,flush=True)
    def run(phase,command,env=None):
        update(phase,command=[str(v) for v in command])
        with (work/(phase+'.log')).open('w') as log:
            p=subprocess.Popen([str(v) for v in command],stdout=log,stderr=subprocess.STDOUT,cwd=work,env=env)
            update(phase,child_pid=p.pid)
            code=p.wait()
        if code:raise RuntimeError(f'{phase} exited {code}; log: {work/(phase+".log")}')
    try:
        env=os.environ.copy();env.update(OPENBLAS_NUM_THREADS='1',OMP_NUM_THREADS='4',NUMBA_NUM_THREADS='5',CYBR_SURFACE_ATLAS=str(SOURCE/'assets/mineral_detail.cdt'))
        exe=work/'hot-reference.exe'
        overlay=work/'native-overlay';overlay.mkdir(exist_ok=True)
        original_header=(HOT/'native/spectral_geometry.h').read_text()
        declaration='std::vector<Tri> tris;std::vector<int> order;std::vector<Node> nodes;'
        replacement='std::vector<Tri,SpringsDiskAllocator<Tri>> tris;std::vector<int,SpringsDiskAllocator<int>> order;std::vector<Node,SpringsDiskAllocator<Node>> nodes;'
        assert original_header.count(declaration)==1
        (overlay/'spectral_geometry.h').write_text('#include "springs_disk_allocator.h"\n'+original_header.replace(declaration,replacement))
        shutil.copy2(ROOT/'portfolio/instrument/springs_disk_allocator.h',overlay/'springs_disk_allocator.h')
        shutil.copy2(HOT/'native/spectral_desert.cpp',overlay/'spectral_desert.cpp')
        update('prepare-file-backed-storage',storage_change='Only vector allocator for triangles, index order and BVH nodes; all geometry and transport code preserved')
        run('compile',['cmd.exe','/d','/c',ROOT/'portfolio/instrument/compile_springs.cmd',SOURCE,HOT,work],env)
        run('self-test',[exe,'--self-test'],env)
        test=json.loads((work/'self-test.log').read_text())
        if not test.get('passed'):raise RuntimeError('Native optical self-test did not pass')
        geometry=work/'geometry';mesh=geometry/'scene.meshbin';verification=geometry/'geometry_verification.json'
        if not mesh.exists() or not verification.exists():run('build-original',[sys.executable,RECIPE/'build_scene.py','--out',geometry,'--seed','20260914','--no-glb'],env)
        report=json.loads(verification.read_text());assert report['triangles']==23690858,report['triangles']
        update('verify-original',triangles=report['triangles'],geometry_sha256=digest(mesh))
        sys.path.insert(0,str(SOURCE/'tools'));import enhance_geometry
        enhance_geometry.ROOT=work
        upgraded=work/'geometry-r2/scene.meshbin'
        update('enhance-original')
        upgraded.parent.mkdir(parents=True,exist_ok=True)
        with (work/'enhance-original.log').open('w') as log:
            from contextlib import redirect_stdout
            with redirect_stdout(log):enhance_geometry.enhance('desert-hot-springs',mesh,upgraded)
        reference=SOURCE/'evidence/geometry/hot.json';old=json.loads(reference.read_text())
        source_match=digest(mesh)==old['source_sha256'];r2_match=digest(upgraded)==old['result_sha256']
        update('geometry-verified',source_hash_matches=source_match,r2_hash_matches=r2_match)
        # Cross-platform float differences are reported; never called bit-identical.
        output=work/'hero'
        run('render-reference',[exe,upgraded,output,'--w','960','--h','640','--spp','64','--depth','12','--threads','4','--water-spp','128','--indirect-clamp','0','--no-clouds','--grain',RECIPE/'assets/gravel_periodic.pgm','--relief',RECIPE/'assets/granular_relief.bin','--view','hero','--seed','20260914','--exposure','1.9','--sun','-0.80,0.40,0.28','--aperture','0.001','--water-absorption','1'],env)
        run('finish-reference',[sys.executable,SOURCE/'tools/finish_r2.py','--backend','hot',output,'--passes','2','--white-balance','5750','--opaque-filter-strength','.50'],env)
        from PIL import Image
        import numpy as np
        original=SOURCE/'renders/desert-hot-springs/hero/hero.png'
        a=np.asarray(Image.open(original).convert('RGB'),dtype=float);b=np.asarray(Image.open(output.with_suffix('.png')).convert('RGB'),dtype=float)
        assert a.shape==b.shape and np.isfinite(b).all()
        delta=np.abs(a-b)
        comparison={'reference':str(original),'reproduced':str(output.with_suffix('.png')),'size':[a.shape[1],a.shape[0]],'mean_absolute_error_255':float(delta.mean()),'p99_absolute_error_255':float(np.quantile(delta,.99)),'source_hash_matches':source_match,'r2_hash_matches':r2_match,'renderer':'Original CYBR GEO hot spectral / MSVC LLVM OpenMP','visual_approval':False,'note':'Image metrics are diagnostic, not visual acceptance. No relighting or scene compression.'}
        (work/'comparison.json').write_text(json.dumps(comparison,indent=2))
        publish=ROOT/'portfolio/assets/springs-faithful';publish.mkdir(exist_ok=True)
        shutil.copy2(output.with_suffix('.png'),publish/'reproduced.png')
        shutil.copy2(work/'comparison.json',publish/'comparison.json')
        update('complete',seconds=time.time()-start,image=str(output.with_suffix('.png')),binary_sha256=digest(exe),visual_approval=False)
    except Exception as error:
        update('failed',error=str(error));raise
    finally:
        lock.unlink()

if __name__=='__main__':main()
