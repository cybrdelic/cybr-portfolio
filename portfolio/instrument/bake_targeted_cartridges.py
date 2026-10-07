"""Targeted optical layers, full surrounding transport geometry, isolated outputs."""
from pathlib import Path
import argparse,hashlib,json,subprocess,sys,time

def sha(file):
    h=hashlib.sha256()
    with file.open('rb') as f:
        while b:=f.read(1024*1024):h.update(b)
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser()
    for name in ('build','assembly','out','gpu'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--index',type=int,required=True)
    for name,default in [('width',1280),('spp',128),('bands',8),('tile',2048)]:p.add_argument('--'+name,type=int,default=default)
    p.add_argument('--stage',choices=['run','export','finish'],default='run');a=p.parse_args()
    work=a.out/f'{a.index:03d}';work.mkdir(exist_ok=True,parents=True)
    state=json.loads((a.out/'path.json').read_text())['frames'][a.index]
    assert state['targetedModules']==['combat','scenes'] and len(state['renderRegion'])==4
    scripts=Path(__file__).parent
    identity=dict(assembly=sha(a.assembly/'native-manifest.json'),path=sha(a.out/'path.json'),gpu=sha(a.gpu),ptx=sha(a.gpu.with_name('device.ptx')),width=a.width,spp=a.spp,bands=a.bands,scripts={n:sha(scripts/n) for n in ('bake_targeted_cartridges.py','bake_light_path.py','finish.py','module_materials.py','studio.py','metal_finish.py')})
    if a.stage=='export':
        if (work/'export.json').exists():
            info=json.loads((work/'export.json').read_text());assert info['identity']==identity;assert sha(Path(info['scenePath']))==info['sceneSHA256'];return
        old=a.build/'container-c-bake/path-bake-light'/f"{state['originalIndex']:03d}"
        if (old/'export.json').exists():
            info=json.loads((old/'export.json').read_text());oldstate=json.loads((old.parent/'path.json').read_text())['frames'][state['originalIndex']]
            assert all(state[k]==oldstate[k] for k in ('projection','world','groups','objects','cables','progress'))
            assert info['identity']['assembly']==identity['assembly']
            assert all(info['identity']['scripts'][n]==identity['scripts'][n] for n in identity['scripts'] if n!='bake_targeted_cartridges.py')
            scene=Path(info.get('scenePath',old/'scene.cys'));assert sha(scene)==info['sceneSHA256']
        else:
            from bake_light_path import export
            geometry,surfaces,fluid=export(a.build,work,state,a.width,a.spp,a.bands,8,a.assembly)
            scene=work/'scene.cys';info=dict(geometry=geometry,surfaces=surfaces,fluid=fluid,sceneSHA256=sha(scene))
        info.update(identity=identity,scenePath=str(scene));(work/'export.json').write_text(json.dumps(info));return
    info=json.loads((work/'export.json').read_text()) if (work/'export.json').exists() else None
    if a.stage=='finish':
        from bake_light_path import finish
        from PIL import Image
        import numpy as np
        report=json.loads((work/'native.json').read_text());assert info['identity']==identity and report['gpu_execution'] and report['invalid_path_samples']==0
        assert (report['width'],report['height'],report['packets_per_pixel'],report['wavelengths_per_packet'])==(a.width,round(a.width/1.6),a.spp,a.bands)
        depth=finish(work,state,a.build)
        surfaces={k:v for k,v in info['surfaces'].items() if k.split('/')[0] in state['targetedModules']}
        visibility=np.array(Image.open(work/'visibility.png'));visibility[~np.isin(visibility[:,:,2],list(surfaces.values()))]=0
        Image.fromarray(visibility).save(work/'visibility.png')
        receipt=dict(state,index=a.index,width=a.width,height=round(a.width/1.6),spp=a.spp,bands=a.bands,depthRange=depth,sourceGeometry=info['geometry'],surfaces=surfaces,nativeReport=report,complete=True,draft=a.width<1280 or a.spp<128,visualApproval=False,fullSceneTransport=True,renderer='CYBR LIGHT native OptiX targeted spectral + OIDN',identity=identity)
        (work/'receipt.json').write_text(json.dumps(receipt));return
    base=[sys.executable,str(Path(__file__).resolve()),'--build',str(a.build),'--assembly',str(a.assembly),'--out',str(a.out),'--gpu',str(a.gpu),'--index',str(a.index),'--width',str(a.width),'--spp',str(a.spp),'--bands',str(a.bands)]
    subprocess.run(base+['--stage','export'],check=True)
    if (work/'receipt.json').exists():
        r=json.loads((work/'receipt.json').read_text());assert r['identity']==identity and r['complete'];return
    info=json.loads((work/'export.json').read_text())
    command=[str(a.gpu),'--scene',info['scenePath'],'--out',str(work/'native'),'--size',str(a.width),str(round(a.width/1.6)),'--spp',str(a.spp),'--bands',str(a.bands),'--tile',str(a.tile),'--inflight','4','--refractive-nee','--render-region',*map(str,state['renderRegion'])]
    if (work/'native.gpu-checkpoint').exists():command+=['--resume',str(work/'native.gpu-checkpoint')]
    with (work/f'render-{time.time_ns()}.log').open('w') as log:subprocess.run(command,stdout=log,stderr=log,check=True)
    subprocess.run(base+['--stage','finish'],check=True)

if __name__=='__main__':main()
