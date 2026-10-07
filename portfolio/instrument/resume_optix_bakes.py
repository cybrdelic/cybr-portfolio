"""Serial OptiX queue. Accepts completed CPU views from the same scene contract.

The CPU supervisor must be stopped separately and its active worker allowed to
finish. This program never kills processes or changes renderer quality.
"""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,sys,time
from datetime import datetime,timezone
from light_bake_contract import REVISION,signature
from resume_camera_bakes import memory


def publish_status(file,state):
    """A transient Windows reader lock must not abandon a running render."""
    temp=file.with_suffix('.pending.json')
    for attempt in range(30):
        try:
            temp.write_text(json.dumps(state,indent=2));temp.replace(file)
            return True
        except PermissionError:
            time.sleep(.1)
    print(json.dumps({'warning':'Progress file locked; bake continues','path':str(file)}),file=sys.stderr,flush=True)
    return False


def main():
    p=argparse.ArgumentParser();p.add_argument('--build',type=Path,required=True);p.add_argument('--limit',type=int,default=0)
    p.add_argument('--defer-cpu-index',type=int,action='append',default=[],help='Never overwrite an already-running CPU frame')
    p.add_argument('--tile',type=int,default=2048)
    a=p.parse_args();build=a.build.resolve();folder=build/'path-bake-light';script=Path(__file__).resolve().parent;root=script.parents[1]
    lock=(folder/'batch.lock').open('a+b');lock.seek(0)
    if os.name=='nt':
        import msvcrt
        msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    path=json.loads((folder/'path.json').read_text());base_hash=signature(build)
    geometry=json.loads((root/'portfolio/assets/instrument-3d/manifest.json').read_text())['stats']['sha256']
    gpu_hash=hashlib.sha256()
    for n in ('cybr-light-optix.exe','device.ptx'):gpu_hash.update((build/'native-optix'/n).read_bytes())
    gpu_hash=gpu_hash.hexdigest()
    def valid(i):
        try:
            work=folder/f'{i:03d}';r=json.loads((work/'receipt.json').read_text());s=path['frames'][i]
            return (r['complete'] and not r.get('draft') and r['revision']==REVISION and r['pipelineSHA256']==base_hash
                    and r['sourceGeometry']==geometry and r['renderer'].startswith('CYBR LIGHT')
                    and (r['width'],r['height'],r['spp'],r['bands'])==(1280,800,128,8)
                    and all(r[k]==s[k] for k in ('progress','world','projection','groups','objects'))
                    and all((work/n).is_file() for n in ('beauty.webp','visibility.png'))
                    and ('gpuPipelineSHA256' not in r or r['gpuPipelineSHA256']==gpu_hash))
        except (OSError,ValueError,KeyError):return False
    state={'pid':os.getpid(),'renderer':'CYBR LIGHT OptiX spectral','backend':'optix','expected':len(path['frames']),
           'started':datetime.now(timezone.utc).isoformat(),'width':1280,'spp':128,'bands':8}
    def status(phase,**extra):
        state.update(phase=phase,completed=sum(valid(i) for i in range(len(path['frames']))),
                     updated=datetime.now(timezone.utc).isoformat(),memory=memory(),**extra)
        for file in (folder/'job-status.json',root/'portfolio/assets/instrument-path-light/job-status.json'):
            publish_status(file,state)
        print(json.dumps(state),flush=True)
    status('starting',checkpoint=None,workerPid=None);finished=0
    deferred=set(a.defer_cpu_index)
    for i in [i for i in range(len(path['frames'])) if i not in deferred]+sorted(deferred):
        if valid(i):continue
        if i in deferred:
            status('failed',error=f'Deferred CPU frame {i} has not completed; inspect it before resuming without the defer flag',checkpoint=i,workerPid=None);return 1
        log=build/'logs'/f'optix-path-{i:03d}.log'
        with log.open('w') as stream:
            worker=subprocess.Popen([sys.executable,str(script/'bake_optix_path.py'),'--build',str(build),'--index',str(i),'--tile',str(a.tile)],cwd=root,stdout=stream,stderr=subprocess.STDOUT)
            status('rendering',checkpoint=i,workerPid=worker.pid,log=str(log),sampleProgress=str(folder/f'{i:03d}'/'native-progress.json'))
            code=worker.wait()
        if code or not valid(i):status('failed',exitCode=code,workerPid=None);return 1
        code=subprocess.run([sys.executable,str(script/'package_camera_path.py'),'--build',str(build),'--cybr-light'],cwd=root).returncode
        if code:status('failed',error='Packaging failed',workerPid=None);return 1
        finished+=1;status('checkpoint-complete',workerPid=None)
        if a.limit and finished>=a.limit:status('limited-run-complete');return 0
    code=subprocess.run([sys.executable,str(script/'verify_camera_path.py'),'--cybr-light'],cwd=root).returncode
    if code:status('failed',error='Structural validation failed');return 1
    status('complete',checkpoint=None,workerPid=None,visualReviewPending=True);return 0


if __name__=='__main__':raise SystemExit(main())
