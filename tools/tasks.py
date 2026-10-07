"""Local packaging and CPU-only validation of the retained current portfolio."""
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import urlopen
import argparse,hashlib,json,shutil,subprocess,sys,threading

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('action',choices=['serve','test','check','smoke','build'])
parser.add_argument('--port',type=int,default=4185)
parser.add_argument('--root',type=Path,default=ROOT)
args=parser.parse_args();root=args.root.resolve()

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()

def server(port):
    return ThreadingHTTPServer(('127.0.0.1',port),partial(QuietHandler,directory=str(root)))

if args.action=='serve':
    with server(args.port) as http:
        print(f'Serving current source: {root}\nhttp://127.0.0.1:{args.port}/portfolio/',flush=True)
        try:http.serve_forever()
        except KeyboardInterrupt:pass
elif args.action=='test':
    tests=[str(p.relative_to(root)) for p in sorted((root/'portfolio').glob('*.test.mjs'))]
    tests+=['portfolio/live.test.cjs','portfolio/instrument/test-working-motion.mjs',
      'portfolio/instrument/test-elements-composite.mjs','portfolio/instrument/test-elements-water.mjs',
      'portfolio/instrument/test-path-bake-lifecycle.mjs']
    sys.exit(subprocess.run(['node','--test',*tests],cwd=root).returncode)
elif args.action=='check':
    sys.exit(subprocess.run([sys.executable,'portfolio/validate.py'],cwd=root).returncode)
elif args.action=='smoke':
    # Actual frozen entry, module, packed geometry, HDR and playback manifest.
    paths=['portfolio/index.html','portfolio/instrument-3d.js','portfolio/instrument-3d.css',
      'portfolio/assets/instrument-working-v1/manifest.json',
      'portfolio/assets/instrument-working-v1/instrument.bin.gz',
      'portfolio/assets/instrument-working-v1/instrument.lossless-v1.bin.gz',
      'portfolio/assets/instrument-working-v1/geo.lossless-v1.bin.gz',
      'portfolio/instrument-geo-starter.mjs','portfolio/instrument-mobile.css',
      'portfolio/instrument-render-gate.mjs',
      'portfolio/assets/pbr-metal/studio/studio_small_08-1024x512-rgba.f32.gz',
      'cybr-light/browser/trace.wgsl']
    fire_base='portfolio/assets/instrument-elements-bake/fire/'
    water_base='portfolio/assets/instrument-elements-bake/water-shared-v3/'
    fire=json.loads((root/fire_base/'manifest.json').read_text(encoding='utf-8'))
    water=json.loads((root/water_base/'manifest.json').read_text(encoding='utf-8'))
    paths += [fire_base+'manifest.json',fire_base+fire['video'],water_base+'manifest.json']
    paths += [water_base+water['frames'][i]['file'] for i in [0,len(water['frames'])//2,len(water['frames'])-1]]
    with server(0) as http:
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        receipts=[]
        try:
            for rel in paths:
                source=(root/rel).read_bytes()
                with urlopen(f'http://127.0.0.1:{http.server_port}/{rel}') as response:
                    payload=response.read()
                    assert response.status==200 and payload==source,rel
                    receipts.append({'path':rel,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),
                                     'content_type':response.headers.get('Content-Type')})
        finally:http.shutdown();thread.join()
    print(json.dumps({'root':str(root),'checks':receipts,'scope':'HTTP byte integrity only; browser/visual acceptance is separate.'},indent=2))
elif args.action=='build':
    if root!=ROOT:raise SystemExit('Build runs only against this source root')
    dest=root/'.local/dist'
    if dest.exists():raise SystemExit('Refusing to replace an existing dist; inspect/remove the old local build first')
    manifest=json.loads((root/'docs/source-manifest.json').read_text(encoding='utf-8'))
    selected=[r for r in manifest['files'] if not r['path'].startswith('portfolio/instrument/native-msvc/')]
    # Check every allowlisted source BEFORE writing the new local bundle.
    for row in selected:
        p=root/row['path']
        if p.is_symlink() or not p.is_file():raise SystemExit('Missing/linked source: '+row['path'])
        if hashlib.sha256(p.read_bytes()).hexdigest()!=row['sha256']:raise SystemExit('Source changed since manifest: '+row['path'])
    dest.mkdir(parents=True)
    for row in selected:
        p=root/row['path'];target=dest/row['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    print(json.dumps({'destination':str(dest),'files':len(selected),'bytes':sum(r['bytes'] for r in selected),
                      'runtime_assets_regenerated':False,'publication':False}))
