"""Publish the instrument entry without losing the project wall and archive."""
from pathlib import Path
import re, hashlib
from urllib.parse import urlsplit, unquote

SITE=Path(__file__).resolve().parent

def repair_retained_links(html):
    for name in ('export_geometry_step1.json','audit_60hz.json'):
        html=html.replace('../cybr-combat/evidence/'+name,'../cybr-combat/archive/source-led-2026-09-22/evidence/'+name)
    def missing(url):
        parts=urlsplit(url)
        return not parts.scheme and not parts.netloc and bool(parts.path) and not (SITE/unquote(parts.path)).exists()
    def cached(url):
        key=url.removeprefix('../')
        candidate='assets/'+hashlib.sha1(key.encode()).hexdigest()[:12]+'.webp'
        return candidate if (SITE/candidate).is_file() else None
    def anchor(match):
        before,url,after,body=match.groups()
        if not missing(url):return match.group(0)
        preview=cached(url)
        if preview:return f'<a {before}href="{preview}" {after} title="Retained preview; original source is unavailable">{body}</a>'
        return '<span class="source-unavailable">'+body+' <small>(source unavailable)</small></span>'
    html=re.sub(r'<a\s+([^>]*?)href="([^"]+)"([^>]*)>([\s\S]*?)</a>',anchor,html)
    def img(match):
        before,url,after=match.groups()
        if not missing(url):return match.group(0)
        preview=cached(url)
        return f'<img {before}src="{preview}"{after}>' if preview else '<span class="source-unavailable">Original comparison image unavailable</span>'
    return re.sub(r'<img\s+([^>]*?)src="([^"]+)"([^>]*)>',img,html)

def publish():
    index=SITE/'index.html'
    source=index.read_text(encoding='utf-8')
    if 'class="page-home"' in source:
        work=re.sub(r'<section class="live-stage"[\s\S]*?<section class="work-opening"', '<section class="work-opening"',source,count=1)
        work=work.replace('<link rel="stylesheet" href="live.css">','')
        work=re.sub(r'<script[^>]+src="live.js[^"\n]*"[^>]*></script>','',work)
        (SITE/'work.html').write_text(work,encoding='utf-8')
    assert (SITE/'work.html').exists(), 'Generate the project index before publishing'
    for page in list(SITE.glob('*.html')):
        if page.name=='index.html':continue
        html=page.read_text(encoding='utf-8').replace('index.html#work','work.html#work').replace('index.html#render-index','work.html#render-index')
        html=repair_retained_links(html)
        html=re.sub(r'instrument-3d.js\?v=\d+','instrument-3d.js?v=14',html)
        if 'exhibition.css' in html and 'portfolio-finish.css' not in html:
            html=html.replace('</head>','<link rel="stylesheet" href="portfolio-finish.css"></head>')
        page.write_text(html,encoding='utf-8')
    home=(SITE/'instrument-3d.html').read_text(encoding='utf-8')
    home=home.replace('<title>Persistent instrument / Cybrdelic</title>','<title>Cybrdelic — Sound / Systems / Worlds</title><meta name="description" content="Explore an instrument in six parts. Geometry, spectral light, fluid motion, sound, combat and constructed worlds by Cybrdelic.">')
    home=re.sub(r'instrument-3d.js\?v=\d+','instrument-3d.js?v=14',home)
    home=home.replace('<body>','<body><h1 class="sr-only">Cybrdelic — Sound, systems and worlds</h1>')
    home=home.replace('<a class="skip" href="#projects">Skip to projects</a>','<a class="skip" href="work.html#work">Skip the instrument and explore projects</a>')
    home=home.replace('<script src="instrument-qa.js"></script>','<script src="instrument-qa.js"></script><noscript><p class="instrument-footer">Enable JavaScript to load the 3D instrument. <a href="work.html#work">Explore all projects, films and images →</a></p></noscript>')
    index.write_text(home,encoding='utf-8')
    print('Published baked instrument homepage; preserved work.html and project pages.')

if __name__=='__main__':publish()
