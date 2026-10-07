"""Bounded two-worker bake queue. Native reports and logs stay on the build drive."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import argparse, subprocess, sys, json

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--folder',type=Path,required=True)
    p.add_argument('--modules',nargs='+',required=True)
    p.add_argument('--width',type=int,default=640)
    p.add_argument('--spp',type=int,default=64)
    p.add_argument('--revision',default='v7')
    p.add_argument('--finish',choices=['legacy','measured','studio','machined'],default='legacy')
    a=p.parse_args()
    def run(module):
        logs=a.folder/'logs';logs.mkdir(exist_ok=True)
        log=logs/f'{module}-{a.revision}-{a.width}-{a.spp}.log'
        with log.open('w') as f:
            r=subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('bake.py')),'--folder',str(a.folder),'--module',module,'--width',str(a.width),'--spp',str(a.spp),'--revision',a.revision,'--finish',a.finish],stdout=f,stderr=f)
        if r.returncode:
            raise RuntimeError(f'{module}: '+log.read_text()[-1800:])
        return {'module':module,'log':str(log),'complete':True}
    with ThreadPoolExecutor(max_workers=2) as pool:
        for job in as_completed([pool.submit(run,m) for m in a.modules]):
            print(json.dumps(job.result()),flush=True)
