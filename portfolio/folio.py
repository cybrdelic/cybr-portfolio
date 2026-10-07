"""Portfolio presentation: original identity, image-led project index."""
from html import escape as esc
from motion import cinema, loop_preview

def layout(title, content, projects):
    # Consistent, descriptive labels across the retained project sections.
    for original, edited in {
      'BENCH NOTES / TRACEABLE RESULTS':'Project records',
      'Show the workings.':'Measurements & checks',
      'RETAINED PROJECT EVIDENCE':'Original reports',
      'Every note has a place.':'Lantern Steps: event timing',
      'Designed to come apart.':'ORBIT service sequence',
      'Seven images. Seven receipts.':'Recorded render settings',
      'More than playback.':'Workbench interaction checks',
      'Follow the transformation.':'Frames from the delivered films',
      'The assembly is the subject':'ORBIT assembly',
      'A shared geometry workshop':'Mechanism toolkit',
      'Rooms for light':'Quiet Observatory IV',
      'Beyond surface color':'Spectral material models',
      'The space between surfaces':'Volumes and cameras',
    }.items():
        content=content.replace(original,edited)
    links=''.join(f'<a href="{p["slug"]}.html">{esc(p["name"].replace("CYBR ",""))}</a>' for p in projects)
    content+='<script src="motion.js" defer></script>'
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="{esc(title)}. Geometry, rendering, animation and music by Cybrdelic."><title>{esc(title)} / Cybrdelic</title><link rel="stylesheet" href="folio.css"><link rel="stylesheet" href="motion.css"></head><body><a class="skip-link" href="#top">Skip to content</a><header class="folio-header"><a href="index.html" class="small-brand" aria-label="Cybrdelic home">cybrdelic</a><nav aria-label="Main navigation"><a href="index.html#work">Projects</a><a href="index.html#render-index">Images</a><a href="evidence.html">Technical notes</a></nav><details class="project-menu"><summary>Index</summary><div>{links}</div></details></header><main id="top">{content}</main><footer><a href="index.html" class="small-brand">cybrdelic</a><p>Geometry, rendering, animation & music.</p><a href="#top">Back to top ↑</a></footer><dialog id="lightbox" aria-label="Render viewer"><button class="close-view" aria-label="Close viewer">Close ×</button><button class="prev-view" aria-label="Previous image">←</button><img alt=""><button class="next-view" aria-label="Next image">→</button><div class="viewer-caption"></div><a class="original-link" target="_blank" rel="noopener">Open original ↗</a></dialog><script src="archive.js"></script></body></html>'''

def front_page(projects, thumb, count):
    pmap={p['slug']:p for p in projects}
    covers={
      'geo':('cybr-geo/media/orbit_v3_hero.jpg','cybr-geo/media/orbit_internal.jpg'),
      'scenes':('cybr-scenes/scenes/observatory-iv/renders/Observatory_IV.png','cybr-scenes/environments/renders/drowned-geode/hero/hero.png'),
      'light':('cybr-light/docs/media/caustics.png','cybr-light/docs/media/anisotropy.png'),
      'elements':('cybr-elements/outputs/cybrdelic-type/elements/motion/bending/sigils/02/water-r8-poster.jpg','cybr-elements/outputs/cybrdelic-type/elements/motion/bending/sigils/02/lava-poster.jpg'),
      'combat':('cybr-combat/demo-output/inspector/0040_front.png','cybr-combat/demo-output/frames/frame_0178.png'),
      'song':('portfolio/assets/velvet-score.png','portfolio/assets/orchard-score.png'),
      'caldera':('grotto/renders/caldera.png','grotto/renders/lighting-01.png'),
      'tidal':('rebuild/renders/tidal-engine.png','rebuild/renders/preview-03.png')
    }
    descriptions={
      'geo':'ORBIT, differential mechanisms and the ROAM workshop. Models, assembly sequences and internal views.',
      'scenes':'Quiet Observatory IV and six landscapes. Finished images, render components and optical tests.',
      'elements':'Fire, water, earth, air, ice, lava and lightning. Seven films built around the same drawn mark.',
      'light':'A spectral renderer, seen through metal, glass, caustics and clouds. Seven studies with their render settings.',
      'combat':'Four authored combat takes, an interactive inspector and a sequence workbench. Character asset credits included.',
      'song':'Lacuna instruments, Lantern Steps, two full scores and guitar tablature. Listen and inspect the note timings.',
      'caldera':'A flooded gorge assembled from four CYBR projects. Rock, water, vegetation and a natural bridge.',
      'tidal':'A bronze tidewheel and gear train in a stone hall. One rendered scene combining four project toolkits.'
    }
    html='<section class="motion-front"><h1 class="motion-wordmark">cybrdelic</h1>'+cinema(pmap['elements'],thumb,home=True)+'</section><section id="work" class="work-list"><div class="section-line"><h2>Work</h2><span>Geometry, motion, light & sound</span></div>'
    for i,slug in enumerate(['scenes','geo','elements','combat','light','song','caldera','tidal']):
        p=pmap[slug]; first,second=covers[slug]
        short=p['name'].replace('CYBR ','')
        media=loop_preview(p,thumb) if p['videos'] else f'<a class="project-spread" href="{slug}.html" aria-label="View {esc(p["name"])}"><img class="spread-main" src="{thumb(first)}" alt="{esc(short)} — main view" loading="lazy"><img class="spread-detail" src="{thumb(second)}" alt="{esc(short)} — additional study" loading="lazy"></a>'
        html+=f'<article class="project-row project-{slug}"><div class="project-caption"><span class="project-no">{i+1:02}</span><h3><a href="{slug}.html">{esc(short)}</a></h3><p>{descriptions[slug]}</p><a class="text-link" href="{slug}.html">View project ↗</a><small>{p["count"]} images & studies</small></div>{media}</article>'
    return html+'</section><aside class="notes-link"><h2>Working notes</h2><p>Assembly audits, render settings, film measurements and score data, collected by project.</p><a href="evidence.html">Read the technical notes ↗</a></aside>'
