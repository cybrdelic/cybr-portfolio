"""Same authored scene/finish contract, executed by native CYBR LIGHT OptiX."""
from pathlib import Path
import argparse,hashlib,json,subprocess,time,sys
from light_bake_contract import REVISION,signature


def gpu_signature(build):
    h=hashlib.sha256()
    for name in ('cybr-light-optix.exe','device.ptx'):
        h.update((build/'native-optix'/name).read_bytes())
    return h.hexdigest()


def main():
    p=argparse.ArgumentParser();p.add_argument('--build',type=Path,required=True);p.add_argument('--index',type=int,required=True)
    p.add_argument('--tile',type=int,default=2048,help='Pixels per GPU launch; does not change sample quality')
    p.add_argument('--fresh',action='store_true');a=p.parse_args();build=a.build.resolve()
    start=time.time();folder=build/'path-bake-light';state=json.loads((folder/'path.json').read_text())['frames'][a.index]
    work=folder/f'{a.index:03d}';work.mkdir(exist_ok=True)
    stage=Path(__file__).with_name('optix_bake_stage.py')
    subprocess.run([sys.executable,str(stage),'--build',str(build),'--index',str(a.index),'--stage','export'],check=True)
    exported=json.loads((work/'gpu-export.json').read_text())
    geometry,surfaces,fluid=exported['geometry'],exported['surfaces'],exported['fluid']
    exe=build/'native-optix/cybr-light-optix.exe';prefix=work/'native'
    command=[str(exe),'--scene',str(work/'scene.cys'),'--out',str(prefix),'--tile',str(a.tile)]
    checkpoint=prefix.with_suffix('.gpu-checkpoint')
    if checkpoint.exists() and not a.fresh:command+=['--resume',str(checkpoint)]
    print(json.dumps({'index':a.index,'stage':'render','renderer':'CYBR LIGHT OptiX','resuming':checkpoint.exists() and not a.fresh}),flush=True)
    with (work/'native.log').open('w') as log:subprocess.run(command,stdout=log,stderr=log,check=True)
    report=json.loads(prefix.with_suffix('.json').read_text())
    assert report['gpu_execution'] and report['invalid_path_samples']==0
    assert (report['width'],report['height'],report['packets_per_pixel'],report['wavelengths_per_packet'])==(1280,800,128,8)
    subprocess.run([sys.executable,str(stage),'--build',str(build),'--index',str(a.index),'--stage','finish'],check=True)
    depth=json.loads((work/'gpu-finish.json').read_text())['depthRange']
    receipt={**state,'index':a.index,'width':1280,'height':800,'spp':128,'bands':8,'depthRange':depth,
             'fluidFrame':fluid,'seconds':time.time()-start,'renderer':'CYBR LIGHT OptiX spectral + OIDN',
             'revision':REVISION,'pipelineSHA256':signature(build),'gpuPipelineSHA256':gpu_signature(build),
             'sourceGeometry':geometry,'surfaces':surfaces,'nativeReport':report,
             'sceneSHA256':hashlib.sha256((work/'scene.cys').read_bytes()).hexdigest(),'complete':True,'draft':False}
    temp=work/'receipt.pending.json';temp.write_text(json.dumps(receipt));temp.replace(work/'receipt.json')
    print(json.dumps({'index':a.index,'stage':'complete','seconds':receipt['seconds']}),flush=True)


if __name__=='__main__':main()
