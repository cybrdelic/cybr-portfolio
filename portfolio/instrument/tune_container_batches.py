"""Bounded scheduling-only benchmark; retain exact film and resume production."""
from pathlib import Path
import hashlib,json,shutil,struct,subprocess,sys,time
import psutil
from resume_optix_bakes import publish_status

ROOT=Path(__file__).resolve().parents[2]
BUILD=Path('D:/CYBR-build/exploded-instrument')
OUT=BUILD/'container-c-bake'
FOLDER=OUT/'path-bake-light'
WORK=OUT/'batch-benchmark'
GPU=ROOT/'portfolio/output/optix-water-nee-v8/cybr-light-optix.exe'

def main():
    WORK.mkdir(exist_ok=True)
    result=dict(phase='waiting-for-checkpoint',qualityUnchanged=True,variants=[])
    def note(**kw):
        result.update(kw);publish_status(WORK/'status.json',result)
    state=json.loads((FOLDER/'job-status.json').read_text())
    assert state['checkpoint']==0 and state['completed']==0
    root=psutil.Process(state['pid'])
    assert 'queue_container_bakes.py' in ' '.join(root.cmdline())
    work=FOLDER/'000';checkpoint=work/'native.gpu-checkpoint'
    deadline=time.monotonic()+600
    while not checkpoint.exists():
        if not root.is_running() or time.monotonic()>deadline:raise RuntimeError('No safe checkpoint; queue was not stopped')
        note();time.sleep(2)
    children=root.children(recursive=True)
    for child in children:
        command=' '.join(child.cmdline())
        assert 'bake_cartridge_path.py' in command or str(GPU).lower() in command.lower(),command
    root.terminate();root.wait(timeout=10)
    for child in reversed(children):
        try:child.terminate();child.wait(timeout=10)
        except psutil.NoSuchProcess:pass
    saved=WORK/'production-start.gpu-checkpoint';shutil.copy2(checkpoint,saved)
    initial=struct.unpack('<5Q',saved.read_bytes()[:40])[2]
    assert 0<initial<126
    state.update(phase='benchmarking',workerPid=None,error='Scheduling benchmark; production checkpoint preserved.')
    publish_status(FOLDER/'job-status.json',state)
    selected=512
    try:
        for tile in (512,2048,1024):
            if tile==1024 and selected==2048:break
            prefix=WORK/f'tile-{tile}'
            command=[str(GPU),'--scene',str(work/'scene.cys'),'--out',str(prefix),'--size','1280','800','--spp','128','--bands','8','--tile',str(tile),'--inflight','4','--refractive-nee','--resume',str(saved),'--stop-after',str(initial+2)]
            note(phase='benchmarking',currentTile=tile,initialSamples=initial)
            started=time.monotonic();trace_start=None
            with prefix.with_suffix('.log').open('w') as log:
                proc=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
                while proc.poll() is None:
                    progress=Path(str(prefix)+'-progress.json')
                    if trace_start is None and progress.exists():trace_start=time.monotonic()
                    if time.monotonic()-started>1200:
                        proc.terminate();proc.wait();raise RuntimeError('Benchmark timed out')
                    time.sleep(.2)
            duration=time.monotonic()-(trace_start or started)
            progress=json.loads(Path(str(prefix)+'-progress.json').read_text()) if Path(str(prefix)+'-progress.json').exists() else {}
            record=dict(tile=tile,exitCode=proc.returncode,traceSeconds=duration,wallSeconds=time.monotonic()-started,progress=progress)
            output=Path(str(prefix)+'.gpu-checkpoint')
            if proc.returncode==0 and output.exists():
                record['checkpointSHA256']=hashlib.sha256(output.read_bytes()).hexdigest()
                record['exact']=tile==512 or record['checkpointSHA256']==result['variants'][0]['checkpointSHA256']
                record['speedup']=result['variants'][0]['traceSeconds']/duration if result['variants'] else 1
                if record['exact'] and record['speedup']>1.10 and progress['maxLaunchMs']<800:selected=tile
            result['variants'].append(record);note()
            if tile==512 and proc.returncode:raise RuntimeError('Baseline benchmark failed')
        note(phase='tested',selectedTile=selected)
    except Exception as exc:
        selected=512;note(phase='benchmark-failed',error=str(exc),selectedTile=selected)
    finally:
        # Preserve the original production film; benchmark outputs never overwrite it.
        assert hashlib.sha256(checkpoint.read_bytes()).digest()==hashlib.sha256(saved.read_bytes()).digest()
        command=[sys.executable,str(Path(__file__).with_name('queue_container_bakes.py')),'--build',str(BUILD),'--assembly',str(BUILD/'container-c-assembly'),'--out',str(OUT),'--gpu',str(GPU),'--tile',str(selected)]
        with (OUT/'supervisor-tuned.log').open('a') as log:
            resumed=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,cwd=ROOT)
        note(phase='production-resumed',selectedTile=selected,queuePid=resumed.pid)

if __name__=='__main__':main()
