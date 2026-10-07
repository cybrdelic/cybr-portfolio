"""Serial, resumable bake supervisor. One fresh renderer process per checkpoint.

The supervisor never imports Mitsuba, trimesh, or NumPy. Native render/Embree
allocations are released by process exit before the next checkpoint starts.
"""
from pathlib import Path
import argparse,ctypes,json,os,subprocess,sys,time
from datetime import datetime,timezone

def memory():
    class Status(ctypes.Structure):
        _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong),*[(n,ctypes.c_ulonglong) for n in ('physical','available','pagefile','available_pagefile','virtual','available_virtual','extended')]]
    s=Status();s.length=ctypes.sizeof(s)
    if os.name=='nt' and ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s)):
        return {'ramGiB':round(s.physical/2**30,2),'availableRamGiB':round(s.available/2**30,2),'availableCommitGiB':round(s.available_pagefile/2**30,2)}
    return {}

def main():
    p=argparse.ArgumentParser();p.add_argument('--build',type=Path,required=True);p.add_argument('--limit',type=int,default=0);args=p.parse_args()
    build=args.build.resolve();folder=build/'path-bake';logs=build/'logs';logs.mkdir(exist_ok=True)
    lock=(folder/'isolated-bake.lock').open('a+b');lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
    if os.name=='nt':
        import msvcrt
        try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:raise SystemExit('A checkpoint supervisor already holds the bake lock.')
    script=Path(__file__).resolve().parent;root=script.parents[1]
    path=json.loads((folder/'path.json').read_text())
    geometry=json.loads((root/'portfolio/assets/instrument-3d/manifest.json').read_text())['stats']['sha256']
    def valid(index):
        work=folder/f'{index:03d}';receipt=work/'receipt.json'
        try:
            r=json.loads(receipt.read_text());state=path['frames'][index]
            return r.get('complete') and r['width']==1280 and r['spp']==128 and r['sourceGeometry']==geometry and all(r[k]==state[k] for k in ('progress','projection','world','groups','objects')) and all((work/f).is_file() for f in ('beauty.webp','visibility.png'))
        except (OSError,ValueError,KeyError):return False
    state={'pid':os.getpid(),'started':datetime.now(timezone.utc).isoformat(),'expected':len(path['frames']),'policy':'one renderer process per checkpoint; serial; 1280x800, 128 spp'}
    def status(phase,**extra):
        state.update(phase=phase,updated=datetime.now(timezone.utc).isoformat(),completed=sum(valid(i) for i in range(len(path['frames']))),memory=memory(),**extra)
        temp=folder/'job-status.pending.json';temp.write_text(json.dumps(state,indent=2));temp.replace(folder/'job-status.json')
        print(json.dumps(state),flush=True)
    env=os.environ.copy();env['DRJIT_LIBLLVM_PATH']=str(build/'tools/llvm18/package/runtimes/win-x64/native/libLLVM.dll')
    order=list(dict.fromkeys([48]+list(range(len(path['frames'])))))
    rendered=0;status('starting',checkpoint=None)
    for index in order:
        if valid(index):continue
        success=False
        for attempt,(batch,threads) in enumerate(((4,8),(2,4)),1):
            log=logs/f'camera-path-isolated-{index:03d}-attempt{attempt}.log'
            command=[sys.executable,str(script/'bake_camera_path.py'),'--build',str(build),'--indices',str(index),'--width','1280','--spp','128','--variant','llvm_ad_rgb','--sample-batch',str(batch),'--threads',str(threads)]
            with log.open('w') as stream:
                process=subprocess.Popen(command,cwd=root,env=env,stdout=stream,stderr=subprocess.STDOUT)
                status('rendering',checkpoint=index,attempt=attempt,workerPid=process.pid,log=str(log))
                code=process.wait()
            if code==0 and valid(index):success=True;break
            status('retrying' if attempt==1 else 'failed',checkpoint=index,exitCode=code,workerPid=None)
        if not success:return 1
        status('packaging',checkpoint=index,workerPid=None)
        package=subprocess.run([sys.executable,str(script/'package_camera_path.py'),'--build',str(build)],cwd=root,env=env)
        if package.returncode:status('failed',error='Packaging failed');return 1
        rendered+=1;status('checkpoint-complete',checkpoint=index)
        if args.limit and rendered>=args.limit:status('limited-run-complete');return 0
    gate=subprocess.run([sys.executable,str(script/'verify_camera_path.py')],cwd=root,env=env)
    if gate.returncode:status('failed',error='Final structural verification failed');return 1
    status('complete',checkpoint=None,workerPid=None,visualReviewPending=True);return 0

if __name__=='__main__':raise SystemExit(main())
