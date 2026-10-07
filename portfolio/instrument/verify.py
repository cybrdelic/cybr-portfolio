"""Bounded asset, source and render verification for the local candidate."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit,unquote
import json,hashlib,sys
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
class Links(HTMLParser):
    def __init__(self):super().__init__();self.links=[]
    def handle_starttag(self,tag,attrs):
        for k,v in attrs:
            if k in ('src','href') and v:self.links.append(v)
page=ROOT/'portfolio/instrument-preview.html';parser=Links();parser.feed(page.read_text())
missing=[]
for value in parser.links:
    u=urlsplit(value)
    if not u.scheme and u.path and not (page.parent/unquote(u.path)).resolve().exists():missing.append(value)
provenance=json.loads((ROOT/'portfolio/assets/instrument/provenance.json').read_text())
assets=[]
for layer in provenance['layers']:
    path=ROOT/'portfolio/assets/instrument'/f"{layer['name']}.webp"
    with Image.open(path) as im:
        im.verify()
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if digest!=layer['sha256']:raise ValueError('Asset checksum mismatch: '+layer['name'])
    assets.append({'name':layer['name'],'bytes':path.stat().st_size})
native=[]
for value in sys.argv[1:]:
    p=Path(value);report=json.loads(p.read_text());r=report['native_report']
    if r['invalid_path_samples']!=0:raise ValueError('Invalid native samples: '+str(p))
    native.append({'module':report['module'],'parts':report['parts'],'triangles':report['triangles'],'size':[report['width'],report['height']],'render_seconds':r['render_seconds'],'invalid_path_samples':r['invalid_path_samples'],'postprocess':report.get('postprocess')})
result={'missing_links':missing,'checked_links':len(parser.links),'assets':assets,'decoded_rgba_bytes':provenance['decoded_rgba_bytes'],'native':native,'homepage_replaced':False}
(ROOT/'portfolio/instrument/verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
if missing:raise SystemExit(1)
