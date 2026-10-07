"""Serial native CYBR LIGHT batch. Old Mitsuba artifacts remain separate."""
from pathlib import Path
import argparse, json, os, subprocess, sys
from datetime import datetime, timezone
from resume_camera_bakes import memory
from light_bake_contract import REVISION, signature


def main():
    p=argparse.ArgumentParser();p.add_argument('--build',type=Path,required=True)
    p.add_argument('--limit',type=int,default=0);a=p.parse_args()
    build=a.build.resolve();folder=build/'path-bake-light';folder.mkdir(exist_ok=True)
    logs=build/'logs';logs.mkdir(exist_ok=True)
    lock=(folder/'batch.lock').open('a+b');lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
    if os.name=='nt':
        import msvcrt
        msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    script=Path(__file__).resolve().parent;root=script.parents[1]
    path=json.loads((build/'path-bake/path.json').read_text())
    (folder/'path.json').write_text(json.dumps(path))
    geometry=json.loads((root/'portfolio/assets/instrument-3d/manifest.json').read_text())['stats']['sha256']
    pipeline=signature(build)
    def valid(i):
        try:
            work=folder/f'{i:03d}';r=json.loads((work/'receipt.json').read_text());s=path['frames'][i]
            return (r['complete'] and not r.get('draft') and r['revision']==REVISION and r.get('pipelineSHA256')==pipeline
                    and r['renderer'].startswith('CYBR LIGHT') and r['bands']==8
                    and r['width']==1280 and r['spp']==128 and r['sourceGeometry']==geometry
                    and all(r[k]==s[k] for k in ('progress','projection','world','groups','objects'))
                    and all((work/f).is_file() for f in ('beauty.webp','visibility.png')))
        except (OSError,ValueError,KeyError): return False
    statusfile=root/'portfolio/assets/instrument-path-light/job-status.json'
    statusfile.parent.mkdir(exist_ok=True)
    state={'pid':os.getpid(),'renderer':'CYBR LIGHT 0.2 native spectral','expected':len(path['frames']),
           'started':datetime.now(timezone.utc).isoformat(),'width':1280,'spp':128,'bands':8}
    def status(phase,**extra):
        state.update(phase=phase,completed=sum(valid(i) for i in range(len(path['frames']))),
                     updated=datetime.now(timezone.utc).isoformat(),memory=memory(),**extra)
        for file in (folder/'job-status.json',statusfile):
            temp=file.with_suffix('.pending.json');temp.write_text(json.dumps(state,indent=2));temp.replace(file)
        print(json.dumps(state),flush=True)
    status('starting',checkpoint=None)
    count=0
    for i in list(dict.fromkeys([0,20,28,48]+list(range(len(path['frames']))))):
        if valid(i): continue
        log=logs/f'cybr-light-path-{i:03d}.log'
        with log.open('w') as stream:
            process=subprocess.Popen([sys.executable,str(script/'bake_light_path.py'),'--build',str(build),
                                      '--index',str(i)],cwd=root,stdout=stream,stderr=subprocess.STDOUT)
            status('rendering',checkpoint=i,workerPid=process.pid,log=str(log))
            code=process.wait()
        if code or not valid(i):
            status('failed',checkpoint=i,workerPid=None,exitCode=code);return 1
        package=subprocess.run([sys.executable,str(script/'package_camera_path.py'),'--build',str(build),'--cybr-light'],cwd=root)
        if package.returncode:
            status('failed',error='Packaging failed',workerPid=None);return 1
        count+=1;status('checkpoint-complete',checkpoint=i,workerPid=None)
        if a.limit and count>=a.limit:status('limited-run-complete');return 0
    gate=subprocess.run([sys.executable,str(script/'verify_camera_path.py'),'--cybr-light'],cwd=root)
    if gate.returncode:status('failed',error='Structural verification failed');return 1
    status('complete',checkpoint=None,workerPid=None,visualReviewPending=True);return 0


if __name__=='__main__': raise SystemExit(main())
