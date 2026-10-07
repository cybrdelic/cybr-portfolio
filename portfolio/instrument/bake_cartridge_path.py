"""Isolated real-geometry cartridge bake; never publishes or replaces production.

Preparation is a separate process so large geometry buffers are gone before
OptiX builds its acceleration structure. Existing checkpoints are preserved.
"""
from pathlib import Path
import argparse,hashlib,json,subprocess,sys,time

def sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as f:
        while chunk:=f.read(1024*1024):digest.update(chunk)
    return digest.hexdigest()

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--build',type=Path,required=True);p.add_argument('--assembly',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True);p.add_argument('--gpu',type=Path,required=True)
    p.add_argument('--index',type=int,required=True);p.add_argument('--width',type=int,default=640)
    p.add_argument('--spp',type=int,default=32);p.add_argument('--bands',type=int,default=8)
    p.add_argument('--prepared',type=Path,help='Reuse a verified scene export for the same geometry and camera')
    p.add_argument('--tile',type=int,default=128)
    p.add_argument('--stage',choices=['export','finish','run'],default='run');a=p.parse_args()
    work=a.out/f'{a.index:03d}';work.mkdir(parents=True,exist_ok=True)
    path=json.loads((a.out/'path.json').read_text());state=path['frames'][a.index]
    identity=dict(assembly=sha(a.assembly/'native-manifest.json'),path=sha(a.out/'path.json'),gpu=sha(a.gpu),ptx=sha(a.gpu.with_name('device.ptx')),width=a.width,spp=a.spp,bands=a.bands)
    identity['scripts']={f:sha(Path(__file__).with_name(f)) for f in ('bake_cartridge_path.py','bake_light_path.py','module_materials.py','finish.py','metal_finish.py','studio.py')}
    if a.prepared:identity['prepared']=str(a.prepared.resolve())
    if a.stage=='export':
        if (work/'export.json').exists():
            existing=json.loads((work/'export.json').read_text())
            if existing['identity']!=identity:raise RuntimeError('Changed inputs: use a new output folder; preserved existing bake/checkpoint')
            assert sha(Path(existing.get('scenePath',work/'scene.cys')))==existing['sceneSHA256'];return
        if a.prepared:
            previous=json.loads((a.prepared/'export.json').read_text());old=previous['identity']
            assert old['assembly']==identity['assembly'] and old['path']==identity['path']
            for name in identity['scripts']:
                if name!='bake_cartridge_path.py':assert old['scripts'][name]==identity['scripts'][name]
            scene=Path(previous.get('scenePath',a.prepared/'scene.cys')).resolve()
            assert sha(scene)==previous['sceneSHA256']
            result=dict(previous,identity=identity,scenePath=str(scene))
            (work/'export.json').write_text(json.dumps(result));print(json.dumps(dict(stage='reused verified scene',index=a.index)),flush=True);return
        from bake_light_path import export
        geometry,surfaces,fluid=export(a.build,work,state,a.width,a.spp,a.bands,8,a.assembly)
        result=dict(identity=identity,geometry=geometry,surfaces=surfaces,fluid=fluid,sceneSHA256=sha(work/'scene.cys'))
        (work/'export.json').write_text(json.dumps(result));print(json.dumps(dict(stage='exported',index=a.index,geometry=geometry)),flush=True);return
    if a.stage=='finish':
        from bake_light_path import finish
        report=json.loads((work/'native.json').read_text());exported=json.loads((work/'export.json').read_text())
        assert exported['identity']==identity
        assert report['gpu_execution'] and report['invalid_path_samples']==0
        assert (report['width'],report['height'],report['packets_per_pixel'],report['wavelengths_per_packet'])==(a.width,round(a.width/1.6),a.spp,a.bands)
        depth=finish(work,state,a.build)
        receipt=dict(**state,index=a.index,width=a.width,height=round(a.width/1.6),spp=a.spp,bands=a.bands,depthRange=depth,sourceGeometry=exported['geometry'],surfaces=exported['surfaces'],fluidFrame=exported['fluid'],nativeReport=report,complete=True,draft=a.width<1280 or a.spp<128,visualApproval=False,renderer='CYBR LIGHT native OptiX spectral + OIDN',identity=identity)
        (work/'receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(dict(stage='finished',index=a.index,visualApproval=False)),flush=True);return
    base=[sys.executable,str(Path(__file__).resolve()),'--build',str(a.build),'--assembly',str(a.assembly),'--out',str(a.out),'--gpu',str(a.gpu),'--index',str(a.index),'--width',str(a.width),'--spp',str(a.spp),'--bands',str(a.bands)]
    if a.prepared:base+=['--prepared',str(a.prepared)]
    subprocess.run(base+['--stage','export'],check=True)
    if (work/'receipt.json').exists():
        receipt=json.loads((work/'receipt.json').read_text());assert receipt['identity']==identity and receipt['complete'];return
    exported=json.loads((work/'export.json').read_text())
    command=[str(a.gpu),'--scene',str(exported.get('scenePath',work/'scene.cys')),'--out',str(work/'native'),'--size',str(a.width),str(round(a.width/1.6)),'--spp',str(a.spp),'--bands',str(a.bands),'--tile',str(a.tile),'--inflight','4','--refractive-nee']
    checkpoint=work/'native.gpu-checkpoint'
    if checkpoint.exists():command+=['--resume',str(checkpoint)]
    print(json.dumps(dict(stage='render',index=a.index,resume=checkpoint.exists())),flush=True)
    with (work/f'render-{time.time_ns()}.log').open('w') as log:subprocess.run(command,stdout=log,stderr=log,check=True)
    subprocess.run(base+['--stage','finish'],check=True)

if __name__=='__main__':main()
