"""Command-line workflow for native CYBR scenes and the checked compatibility subset."""
from __future__ import annotations
import argparse
from dataclasses import asdict
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from . import load_file, render, bundle_scene, rebuild_shaders
from .workflow import plugins, validate_scene


def main(argv: list[str]|None=None) -> int:
    parser=argparse.ArgumentParser(prog='cybrlight',description=__doc__)
    commands=parser.add_subparsers(dest='action',required=True)
    commands.add_parser('features',help='Report implemented backends and explicit capability limits')
    commands.add_parser('plugins',help='List the accepted XML/dictionary plugin names')
    validate=commands.add_parser('validate',help='Compile and validate an XML/dictionary/snapshot scene')
    validate.add_argument('scene',type=Path)
    bundle=commands.add_parser('bundle',help='Freeze a scene with assets and shader sources')
    bundle.add_argument('scene',type=Path);bundle.add_argument('directory',type=Path)
    rebuild=commands.add_parser('rebuild-shaders',help='Recompile trusted bundled C++ shaders')
    rebuild.add_argument('directory',type=Path)
    drawing=commands.add_parser('render',help='Render actual light transport')
    drawing.add_argument('scene',type=Path);drawing.add_argument('--out',required=True,type=Path)
    drawing.add_argument('--backend',choices=['native','portable-cpu','portable-cuda'],default='native')
    drawing.add_argument('--cuda-simulator',action='store_true',help='Explicit CPU simulation; NOT hardware GPU execution')
    drawing.add_argument('--executable',type=Path)
    drawing.add_argument('--spp',type=int);drawing.add_argument('--bands',type=int)
    drawing.add_argument('--size',nargs=2,type=int,metavar=('WIDTH','HEIGHT'))
    drawing.add_argument('--threads',type=int);drawing.add_argument('--resume',type=Path)
    drawing.add_argument('--checkpoint',type=Path)
    args=parser.parse_args(argv)
    try:
        if args.action=='features':
            print(json.dumps({'renderer':'CYBR LIGHT 0.2',
              'native':'C++17/OpenMP spectral/polarized reference renderer',
              'compiler':'Independent elementwise expression graph -> C++17, reverse AD and symbolic higher derivatives',
              'portable':'Numba shared CPU/CUDA surface path tracer; not all native features',
              'numba_installed':importlib.util.find_spec('numba') is not None,
              'gpu_validation':'Hardware GPU execution is not established by the delivered CPU/simulator tests',
              'limits':['Only the documented scene vocabulary is supported','No general scene/visibility-aware AD',
                        'No OptiX/RTX backend','No general unbiased BDPT/VCM/MLT integrator',
                        'No general GPU array compiler/runtime']},indent=2))
        elif args.action=='plugins':print(json.dumps(plugins(),indent=2))
        elif args.action=='rebuild-shaders':print(json.dumps(rebuild_shaders(args.directory),indent=2))
        elif args.action in ('validate','bundle'):
            scene=load_file(args.scene);validate_scene(scene)
            if args.action=='bundle':print(bundle_scene(scene,args.directory))
            else:print(json.dumps({'valid':True,'name':scene.name,'materials':len(scene.materials),
                                  'primitives':len(scene.primitives),'volumes':len(scene.volumes),
                                  'settings':asdict(scene.settings)},indent=2))
        else:
            source=args.scene if args.scene.suffix.lower()=='.cys' else load_file(args.scene)
            if args.backend=='native':
                if args.cuda_simulator:raise ValueError('--cuda-simulator requires --backend portable-cuda')
                report=render(source,args.out,executable=args.executable,spp=args.spp,bands=args.bands,
                              size=tuple(args.size) if args.size else None,threads=args.threads,
                              resume=args.resume,checkpoint=args.checkpoint)
            else:
                if isinstance(source,Path):raise ValueError('Portable rendering requires XML, a dictionary JSON, or a .cybr.json snapshot, not native .cys text')
                if args.resume or args.checkpoint:raise ValueError('Checkpoint/resume belongs to the native backend')
                for key in ('spp','bands','threads'):
                    if getattr(args,key) is not None:setattr(source.settings,key,getattr(args,key))
                if args.size:source.settings.width,source.settings.height=args.size
                validate_scene(source)
                if args.cuda_simulator:
                    if args.backend!='portable-cuda':raise ValueError('CUDA simulator requires the portable-cuda backend')
                    os.environ['NUMBA_ENABLE_CUDASIM']='1'
                from .portable import render_portable
                _,report=render_portable(source,args.out,backend='cpu' if args.backend=='portable-cpu' else 'cuda')
            print(json.dumps(report,indent=2))
        return 0
    except (ValueError,FileNotFoundError,RuntimeError,subprocess.CalledProcessError) as exc:
        print(f'ERROR: {exc}',file=sys.stderr);return 2

if __name__=='__main__':raise SystemExit(main())
