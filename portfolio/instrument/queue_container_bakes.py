"""Serial, checkpoint-preserving container queue compatible with the Windows monitor."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,sys,time
from datetime import datetime,timezone
from resume_optix_bakes import publish_status

def main():
    p=argparse.ArgumentParser()
    for name in ('build','assembly','out','gpu'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--tile',type=int,default=512)
    p.add_argument('--targeted',action='store_true')
    p.add_argument('--start-index',type=int,default=0)
    p.add_argument('--compatible-exporter-sha')
    a=p.parse_args();folder=a.out/'path-bake-light';logs=a.out/'logs';logs.mkdir(exist_ok=True,parents=True)
    lock=(folder/'batch.lock').open('a+b');lock.seek(0)
    import msvcrt
    msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
    path=json.loads((folder/'path.json').read_text())
    assert path['assembly']=='instrument-cartridges-c'
    assert 0<=a.start_index<=len(path['frames'])
    for i in range(a.start_index):
        work=folder/f'{i:03d}';r=json.loads((work/'receipt.json').read_text());identity=r['identity']
        assert r['complete'] and not r['draft'] and r['nativeReport']['invalid_path_samples']==0
        assert (r['width'],r['spp'],r['bands'])==(1280,128,8)
        assert all(r[k]==path['frames'][i][k] for k in ('world','projection','groups','objects','cables','renderRegion'))
        for key,file in [('gpu',a.gpu),('ptx',a.gpu.with_name('device.ptx')),('assembly',a.assembly/'native-manifest.json'),('path',folder/'path.json')]:
            assert identity[key]==hashlib.sha256(file.read_bytes()).hexdigest(),key
        for name,digest in identity['scripts'].items():
            current=hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
            assert digest==current or (name=='bake_light_path.py' and digest==a.compatible_exporter_sha),name
        assert all((work/n).is_file() for n in ('beauty.png','beauty.webp','visibility.png'))
    state=dict(pid=os.getpid(),expected=len(path['frames']),completed=0,checkpoint=None,backend='optix',renderer='CYBR LIGHT OptiX / Concept C',started=datetime.now(timezone.utc).isoformat(),width=1280,spp=128,bands=8)
    def status(phase,**kw):
        state.update(phase=phase,updated=datetime.now(timezone.utc).isoformat(),**kw)
        publish_status(folder/'job-status.json',state)
    status('starting',completed=a.start_index)
    try:
        for i in range(a.start_index,len(path['frames'])):
            work=folder/f'{i:03d}';log=logs/f'optix-path-{i:03d}.log'
            command=[sys.executable,str(Path(__file__).with_name('bake_targeted_cartridges.py' if a.targeted else 'bake_cartridge_path.py')),'--build',str(a.build),'--assembly',str(a.assembly),'--out',str(folder),'--gpu',str(a.gpu),'--index',str(i),'--width','1280','--spp','128','--bands','8','--tile',str(a.tile)]
            start=time.monotonic()
            with log.open('a') as stream:
                worker=subprocess.Popen(command,stdout=stream,stderr=subprocess.STDOUT)
                status('rendering',checkpoint=i,workerPid=worker.pid,log=str(log),tile=a.tile)
                code=worker.wait()
            # Camera views differ in glass/water cost. Revert only a measured
            # launch-safety failure; never hide unrelated renderer errors.
            render_logs=sorted(work.glob('render-*.log'),key=lambda f:f.stat().st_mtime)
            if code and a.tile>512 and render_logs and 'GPU launch exceeded 1s safety gate' in render_logs[-1].read_text(errors='replace'):
                command[-1]='512'
                with log.open('a') as stream:
                    stream.write('\nLarger tile exceeded the launch safety gate; resuming checkpoint with tile 512.\n');stream.flush()
                    worker=subprocess.Popen(command,stdout=stream,stderr=subprocess.STDOUT)
                    status('rendering',checkpoint=i,workerPid=worker.pid,log=str(log),tile=512)
                    code=worker.wait()
            if code:raise RuntimeError(f'View {i} exited {code}; inspect {log}')
            receipt=json.loads((work/'receipt.json').read_text())
            assert receipt['complete'] and not receipt['draft'] and receipt['nativeReport']['invalid_path_samples']==0
            assert all((work/n).is_file() for n in ('beauty.png','beauty.webp','visibility.png'))
            receipt.setdefault('seconds',time.monotonic()-start)
            publish_status(work/'receipt.json',receipt)
            status('checkpoint-complete',completed=i+1,workerPid=None)
        status('complete',checkpoint=None,workerPid=None,visualReviewPending=True)
    except Exception as exc:
        status('failed',workerPid=None,error=str(exc));raise

if __name__=='__main__':main()
