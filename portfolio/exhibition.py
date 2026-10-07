"""A spatial portfolio: project wall, screening rooms and image essays."""
from html import escape as esc
from motion import cinema, preview_url

NAMES = {'geo':'GEO', 'scenes':'Scenes', 'light':'Light', 'elements':'Elements',
         'combat':'CONTACT', 'song':'Lacuna', 'caldera':'Sunken Caldera', 'tidal':'Tidal Engine'}
KINDS = {'geo':'Mechanisms & geometry', 'scenes':'Constructed environments', 'light':'Spectral rendering',
         'elements':'Material films & type', 'combat':'Character motion', 'song':'Scores & instruments',
         'caldera':'A flooded volcanic gorge', 'tidal':'Architecture & machinery'}

def layout(title, content, projects):
    mark='<svg viewBox="400 425 1120 500" role="img" aria-label="Cybrdelic approved sigil 02"><image href="../cybr-elements/outputs/cybrdelic-type/elements/motion/bending/sigils/02/artwork-02.png" width="1920" height="1080"/></svg>'
    for original, replacement in {
        'BENCH NOTES / TRACEABLE RESULTS':'PROJECT RECORDS',
        'Show the workings.':'Measurements & checks',
        'RETAINED PROJECT EVIDENCE':'Original reports',
        'Follow the transformation.':'Film sampling',
        'Each film below has five frames':'Each film has five frames',
        'Every note has a place.':'Lantern Steps: event timing',
        'Designed to come apart.':'ORBIT service sequence',
        'Seven images. Seven receipts.':'Recorded render settings',
        'More than playback.':'Workbench interaction checks',
    }.items():
        content=content.replace(original,replacement)
    current = next((p['slug'] for p in projects if p['name']==title), 'home' if title=='Portfolio' else 'notes')
    live_head = '<link rel="stylesheet" href="live.css">' if current=='home' else ''
    live_script = '<script src="live.js"></script>' if current=='home' else ''
    links = ''.join(f'<a href="{p["slug"]}.html" {("aria-current=page" if current==p["slug"] else "")}><span>{i+1:02}</span>{NAMES[p["slug"]]}</a>' for i,p in enumerate(projects))
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="{esc(title)} — geometry, rendering, motion and music by Cybrdelic.">
<title>{esc(title)} / Cybrdelic</title><link rel="stylesheet" href="exhibition.css">{live_head}</head>
<body class="page-{current}"><a class="skip-link" href="#top">Skip to content</a>
<header class="studio-rail"><a class="rail-logo" href="index.html" aria-label="Cybrdelic home">{mark}</a>
<p class="rail-description">Independent work in<br>geometry, motion,<br>light & sound.</p>
<nav class="rail-projects" aria-label="Projects"><a class="all-work" href="index.html#work">All work <span>↗</span></a>{links}</nav>
<div class="rail-bottom"><a href="index.html#render-index">Image archive ↗</a><a href="evidence.html">Technical records ↗</a><span>8 projects / an ongoing practice</span></div>
<details class="mobile-menu"><summary>Projects +</summary><nav>{links}<a href="evidence.html">Technical records</a></nav></details></header>
<main id="top">{content}</main>
<footer><a href="index.html" class="footer-name" aria-label="Cybrdelic home">{mark}</a><a href="#top">Back to top ↑</a></footer>
<dialog id="lightbox" aria-label="Render viewer"><button class="close-view" aria-label="Close viewer">Close ×</button><button class="prev-view" aria-label="Previous image">←</button><img alt=""><button class="next-view" aria-label="Next image">→</button><div class="viewer-caption"></div><a class="original-link" target="_blank" rel="noopener">Open original ↗</a></dialog>
<script src="archive.js"></script><script src="motion.js"></script>{live_script}</body></html>'''

def live_opening():
    return '''<section class="live-stage" aria-label="Interactive field studies">
<canvas tabindex="0" role="img" aria-label="Live particle sculpture. Drag to disturb the field, or focus and use arrow keys. Use the controls below to change the form or pause.">Interactive particle studies. Use the project links below if canvas is unavailable.</canvas>
<div class="live-title"><p>CYBRDELIC / INTERACTIVE STUDY 001</p><h1>Field<br> studies.</h1><p class="live-instruction">Move through the form.<br>Press and drag to pull it apart.</p></div>
<span class="live-hint">PROCEDURAL FORM / LIVE MOTION</span>
<div class="live-bottom"><div class="live-controls"><div class="live-modes" role="group" aria-label="Choose a live study"><button data-live-mode="orbit" aria-pressed="true"><small>01</small>Orbit</button><button data-live-mode="sigil" aria-pressed="false"><small>02</small>Sigil</button><button data-live-mode="tide" aria-pressed="false"><small>03</small>Tide</button></div>
<div class="live-tools"><button data-live-scatter>Scatter</button><button data-live-reset>Reset</button><button data-live-pause aria-pressed="false">Pause motion</button><label>Force <input data-live-force type="range" min="0" max="100" value="50"><output class="force-value">50%</output></label></div>
<p class="live-status" role="status">Loading the live study…</p></div><a class="live-enter" href="#work"><span><strong>Enter the work</strong>8 projects / films, renders & sound</span><i>↓</i></a></div>
<noscript><p class="live-noscript">Enable JavaScript for the live studies, or explore the projects below.</p></noscript></section>
<div class="live-credit"><span>A site-native experiment: spring-driven points, a torus knot, travelling waves and the original Cybrdelic Sigil lettering. Not a preview of the projects’ simulation engines.</span><a href="elements.html">Explore the original material films ↗</a></div>
<section class="work-opening" id="work"><h2>The work.</h2><p>Geometry, motion, light and sound.<br>Eight projects, with the process left in.</p></section>'''

def front_page(projects, thumb, count):
    pmap = {p['slug']:p for p in projects}
    covers = {'scenes':'cybr-scenes/scenes/observatory-iv/renders/Observatory_IV.png',
              'geo':'cybr-geo/media/orbit_internal.jpg', 'light':'cybr-light/docs/media/caustics.png',
              'song':'portfolio/assets/velvet-score.png', 'caldera':'grotto/renders/caldera.png',
              'tidal':'rebuild/renders/tidal-engine.png'}
    out = live_opening()+'<section class="project-wall" aria-label="Selected projects">'
    for slug in ['scenes','geo','elements','light','combat','song','caldera','tidal']:
        p = pmap[slug]
        if p['videos']:
            title, source, poster = p['videos'][1 if slug=='elements' else 0]
            url = preview_url(slug,source)
            media = f'<video muted loop playsinline preload="metadata" src="{url}" data-preview="{url}" poster="{thumb(poster)}" aria-label="{esc(title)} film preview"></video><span class="tile-media-label">PLAYING FILM / <button class="wall-motion-toggle" type="button" aria-label="Pause {NAMES[slug]} preview">Pause</button></span>'
        else:
            media = f'<img src="{thumb(covers[slug])}" alt="{esc(p["cover"][1])}" loading="lazy">'
        media_count = f'{p["count"]} images' + (f' / {len(p["videos"])} films' if p['videos'] else '')
        out += f'<article class="wall-tile tile-{slug}"><div class="tile-visual">{media}<a class="tile-open" href="{slug}.html" aria-label="Open {NAMES[slug]}">↗</a></div><a class="tile-caption" href="{slug}.html"><h2>{NAMES[slug]}</h2><span>{KINDS[slug]}<small>{media_count}</small></span></a></article>'
    return out+f'''</section><aside class="archive-door"><span>Keep looking.</span><p>{count} renders, frames and studies.<br>Finished work alongside the things that led to it.</p><a href="#render-index">Open the image archive ↓</a></aside>'''

def detail_page(p, i, nxt, thumb, image, compare_html, evidence_html, root):
    slug=p['slug']; name=NAMES[slug]
    heading=f'<div class="project-heading"><a href="index.html#work">All work / {i+1:02}</a><h1>{name}</h1><p>{esc(p["field"])}</p></div>'
    if p['videos']:
        out='<section class="screening-room">'+heading+cinema(p,thumb)+'</section>'
    elif p['audio']:
        out=heading+f'<section class="score-room"><div class="score-art"><p class="score-label">Score / Velvet Switchblade</p>{image(*p["cover"])}</div><div class="record-label"><span>LISTEN / LANTERN STEPS</span><h2>Lantern<br><em>Steps.</em></h2><p>Four bars. Piano & clean electric guitar.</p><audio controls preload="metadata" src="../{p["audio"]}"></audio><a href="../{p["audio"]}" download>Download lossless recording ↗</a></div></section>'
    else:
        out=f'<section class="image-room">{heading}<div class="detail-cover">{image(*p["cover"])}</div></section>'
    out+=f'<section class="project-context"><div><span class="section-number">About the work</span><p class="context-lead">{esc(p["intro"])}</p></div><ul class="project-facts">'+''.join(f'<li>{esc(f)}</li>' for f in p['facts'])+'</ul></section>'
    out+='<nav class="chapter-nav" aria-label="Project sections">'+''.join(f'<a href="#gallery-{n}">{esc(title)} <small>{len(items)}</small></a>' for n,(title,items) in enumerate(p['groups']))+'<a href="#evidence">Technical records ↘</a></nav>'
    # The visual work precedes the long report trail.
    for n,(title,items) in enumerate(p['groups']):
        cls='render-grid sequence-grid' if 'contact sheet' in title.lower() or 'frame' in title.lower() else 'render-grid'
        out+=f'<section class="detail-section gallery-chapter chapter-{n}" id="gallery-{n}"><div class="gallery-heading"><span class="chapter-number">{n+1:02}</span><h2>{esc(title)}</h2><span>{len(items)} images</span></div><div class="{cls}">'+''.join(image(*item) for item in items)+'</div></section>'
        if n<len(p['story']):
            h,t=p['story'][n]
            out+=f'<article class="process-note"><span>Project notes / {n+1:02}</span><h2>{esc(h)}</h2><p>{esc(t)}</p></article>'
    if len(p['story'])>len(p['groups']):
        out+='<section class="project-story">'+''.join(f'<article><h2>{esc(h)}</h2><p>{esc(t)}</p></article>' for h,t in p['story'][len(p['groups']):])+'</section>'
    out+=compare_html(slug,thumb)+evidence_html(slug)
    out+='<section class="resources"><h2>Source material</h2>'+''.join(f'<a href="../{esc(path)}">{esc(label)} ↗</a>' for label,path in p['links'] if (root/path).exists())+'</section>'
    out+=f'<a class="next-project" href="{nxt["slug"]}.html"><span>Up next / {KINDS[nxt["slug"]]}</span><strong>{NAMES[nxt["slug"]]}</strong><span>↗</span></a>'
    return out
