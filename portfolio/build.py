"""Build the curated portfolio from existing local project outputs. No source outputs are changed."""
from pathlib import Path
from html import escape as esc
import hashlib
import json
from PIL import Image
from evidence import REPORTS, evidence_html, compare_html, derive_media
from exhibition import layout, front_page, detail_page
from motion import prepare_previews, cinema

SITE = Path(__file__).resolve().parent
ROOT = SITE.parent
ASSETS = SITE / 'assets'
ASSETS.mkdir(exist_ok=True)
E = 'cybr-elements/outputs/cybrdelic-type'
S = E + '/elements/motion/bending/sigils/02'
projects = []

def group(title, items):
    return (title, [(p, label) for p, label in items if (ROOT / p).is_file()])

def files(folder, pattern, prefix=''):
    return [(p.relative_to(ROOT).as_posix(), prefix + p.stem.replace('_', ' ').replace('-', ' ').title()) for p in sorted((ROOT / folder).glob(pattern))]

def add(slug, name, field, intro, facts, story, groups, links=(), videos=(), audio=None):
    projects.append(dict(slug=slug, name=name, field=field, intro=intro, facts=facts, story=story, groups=groups, links=links, videos=videos, audio=audio))

add('geo', 'CYBR GEO', 'Geometry / mechanisms / engineering studies',
    'From a single involute tooth to a serviceable 148-component wrist. A procedural geometry practice that makes the outside, the inside and the assembly sequence equally visible.',
    ['148 components in ORBIT', '331 service operations', 'CAD · STEP · GLB'],
    [('The assembly is the subject', 'ORBIT combines a geared inspection wrist, opposed-screw gripper, hollow palm, bearing raceways and removable housing. Named parts make it possible to move between a photographic view, internal inspection and an exploded assembly.'), ('A shared geometry workshop', 'The same toolkit extends to differential mechanisms, motor and belt-drive concepts, a nitinol fiber actuator, ROAM workshop mechanisms and a mobile workstation. Recipes describe parts and motion; shared tools handle drawings, catalogues, export and rendering.'), ('Scope of the studies', 'These are nominal geometry and prescribed kinematic studies. Clearance checks and assembly paths do not establish physical load capacity, manufacturing tolerances or prototype performance.')],
    [group('ORBIT — form, internals & assembly', files('cybr-geo/media', 'orbit*.jpg')), group('Differential & ROAM workshop', files('cybr-geo/media', 'differential*.jpg') + files('cybr-geo/examples/roam/media', '*.jpg'))],
    [('Design and source notes','cybr-geo/README.md'), ('ORBIT service procedure','cybr-geo/docs/ORBIT_SERVICE.md')])

scene_items = [('cybr-scenes/scenes/observatory-iv/renders/Observatory_IV.png','Quiet Observatory IV — finished render')]
for slug, name in [('sandstone-passage','Sandstone Passage'),('basalt-tide','Basalt Tide'),('fernwater','Fernwater'),('desert-hot-springs','Desert Hot Springs'),('obsidian-reach','Obsidian Reach'),('drowned-geode','Drowned Geode')]:
    path = f'cybr-scenes/environments/renders/{slug}/hero/hero.png'
    if not (ROOT/path).exists():
        path = f'cybr-scenes/docs/recovery-proof/{slug}/hero.png'
        name += ' — verification render'
    scene_items.append((path,name))
add('scenes','CYBR Scenes','Architecture / terrain / native rendering',
    'A collection of places built from geometry: vaulted rooms, mineral pools, basalt shores, flooded crystal and forest water.',
    ['6 recovered environments', 'Quiet Observatory IV', 'Native CPU rendering'],
    [('Rooms for light', 'Quiet Observatory IV brings together a brass armillary, dispersive quartz globe, telescope and two-lens optical bench beneath a vaulted ceiling. Books, cloth and surface materials give the optical instruments a setting and scale.'), ('Six different landscapes', 'Sandstone Passage, Basalt Tide, Fernwater, Desert Hot Springs, Obsidian Reach and Drowned Geode explore distinct terrain and material problems. Procedural builders, mineral surface maps and native transport backends are retained with the scenes.'), ('Below the finished image', 'Normal, depth and light-component outputs reveal the structure beneath the beauty render. These are diagnostic views of geometry and transport, useful for inspecting what the renderer actually computed.')],
    [group('The environments',scene_items), group('Render anatomy', [('cybr-scenes/scenes/observatory-iv/renders/Observatory_IV_unfiltered.png','Observatory — unfiltered sampling')]+[(f'cybr-scenes/environments/renders/drowned-geode/hero/hero_{kind}.png', 'Drowned Geode — '+kind.replace('_',' ')) for kind in ['normal','depth','reflection','transmission_and_surfaces','volume']])],
    [('Scene documentation','cybr-scenes/README.md'), ('Environment catalogue','cybr-scenes/environments/gallery.html')])

add('light','CYBR Light','Spectral transport / optics / materials',
    'Light as a material. A native spectral renderer for metal highlights, absorbing glass, caustics and the atmosphere between objects.',
    ['C++ engine', 'Python scene API', 'Wavelength-dependent transport'],
    [('Beyond surface color', 'Wavelength sampling, Cauchy dispersion and Beer–Lambert absorption describe how light moves through glass and other materials. Anisotropic metal, rough and smooth dielectrics, textures and material mixtures provide contrasting surface responses.'), ('The space between surfaces', 'Homogeneous and bounded heterogeneous volumes extend the renderer into clouds and participating media. Perspective, orthographic, spherical and thin-lens cameras provide different ways to observe the scene.'), ('Inspectable outputs', 'The renderer saves floating-point films and diagnostic buffers alongside display previews. The gallery images use a display transform without denoising; the project records settings, timing and image hashes.')],
    [group('Seven studies in light',[(f'cybr-light/docs/media/{key}.png', label) for key,label in [('caustics','Dispersive glass — spectral caustics'),('anisotropy','Anisotropic metals — directional highlights'),('dielectrics','Nested glass — absorption and air inclusions'),('materials','Surface textures and material mixtures'),('cornell','Indirect illumination — diffuse color bleeding'),('cloud','Heterogeneous volume scattering'),('xml','Scene loading — transformed mesh instances')]])],
    [('Renderer documentation','cybr-light/README.md'),('Capability matrix','cybr-light/docs/CAPABILITY_MATRIX.md')])

films = [('fire','Fire','fire-02.mp4','poster.jpg'),('water','Water','water-02-r8.mp4','water-r8-poster.jpg'),('earth','Earth','earth-02-r6.mp4','earth-r6-poster.jpg'),('air','Air','air-02.mp4','air-poster.jpg'),('ice','Ice','ice-02.mp4','ice-poster.jpg'),('lava','Lava','lava-02.mp4','lava-poster.jpg'),('lightning','Lightning','lightning-02-r5.mp4','lightning-r5-poster.jpg')]
add('elements','CYBR Elements','Material motion / identity / type',
    'Seven materials. One mark. The same interlocked silhouette ignites, suspends, fractures, disperses and falls.',
    ['7 elemental films', '1920 × 1080 · 30 fps', '2 custom display families'],
    [('A different behavior for every material', 'Fire follows an ignition front; water sags and recovers before spreading across the floor; earth and ice release as fragments. Smoke curls through the mark, lava carries incandescent seams and lightning illuminates a moving gas volume.'), ('Identity with a physical presence', 'The source artwork stays recognizable through each material transformation. The Sigil and Cut typefaces extend the wordmarks into uppercase, lowercase, figures, punctuation and Latin accents.'), ('Art direction and simulation', 'Water uses APIC/FLIP and reconstructed liquid surfaces. Rigid fragments use Bullet collisions; gas is advected in three dimensions. Bending is authored. Ice and lava are material effects, and lightning is a visual discharge model.')],
    [group('Seven material portraits',[(f'{S}/{poster}',name+' — film poster') for _,name,_,poster in films]), group('Custom type & identity',files(E+'/typefaces/specimens','*.png')+[(f'{E}/exploration-v{n}/cybrdelic-brandmark-refined.png',f'Brandmark exploration — revision {n}') for n in [3,4,5,6]]), group('Earlier material studies',[(f'{E}/elements/{material}-02-poster.jpg',material.title()+' — earlier material study') for material in ['water','earth','air']]+files(E+'/elements/motion','*-material-poster.jpg'))],
    [('Seven-element player',S+'/index.html'),('Typeface specimen',E+'/typefaces/index.html'),('Pipeline documentation','cybr-elements/docs/PIPELINES.md')],
    videos=[(name,f'{S}/{file}',f'{S}/{poster}') for _,name,file,poster in films])

add('combat','CYBR Combat / CONTACT','Authored motion / rigging / performance',
    'A sequence of cleaves, counters, bounds and recoveries. Original movement built around contact, balance and a readable silhouette.',
    ['4 takes', '30 frames per second', '469 exported poses'],
    [('Four distinct performances', 'The sequence moves from a passing cleave and guarded counter into a forward bound, lateral evade and compact turning leap. Each take uses a fixed camera, with explicit cuts between performances.'), ('Movement from the body', 'Authored controls drive body posture, forearm roll, wrist flex, gaze and foot contact. Two-bone inverse kinematics and skinning turn those controls into exported poses. Flight uses a segment-mass surrogate as an authoring constraint.'), ('Authorship and assets', 'The movement is original; the character, helmet and surface maps are third-party visuals. The source repository retains their terms. Buffer checks inspect crossings and floor contact, but the performance is not a full inverse-dynamics simulation.')],
    [group('Pose & camera studies',files('cybr-combat/demo-output/inspector','0*.png')),group('Leap — selected frames',files('cybr-combat/demo-output/frames','*.png')),group('Interactive workbench',files('cybr-combat/demo-output/workbench','*.png'))],
    [('Open motion inspector','cybr-combat/CONTACT_Inspector.html'),('Credits and asset notices','cybr-combat/THIRD_PARTY_NOTICES.md')],
    videos=[('Side-view leap study','cybr-combat/demo-output/side-leap-study.mp4','cybr-combat/demo-output/frames/frame_0178.png'),('Counter study','cybr-combat/demo-output/workbench/counter-study.mp4','cybr-combat/demo-output/workbench/counter-contact.png')])

add('song','CYBR Song / Lacuna','Composition / instrument design / notation',
    'Music with a readable structure: original scores, calibrated sample instruments and performances that can be traced back to each note.',
    ['Lantern Steps · 17.635 s', '33 attacks', 'Piano & clean electric guitar'],
    [('Listen to Lantern Steps', 'A new four-bar miniature rendered through the recovered Lacuna instruments and calibrated mix. The committed lossless performance is playable below; score and performance data retain its note schedule.'), ('Two longer compositions', 'Velvet Switchblade and The Orchard Keeps the Rain are preserved as printable scores and guitar tablature. Their full original audio and score videos are not in this checkout, so this page presents the retained notation alongside the available miniature.'), ('Instrument and mix work', 'The engine uses Slender Salamander piano and BJAM clean-electric recordings. A repaired velocity crossfade restores the faded contribution to quiet guitar notes, while fixed instrument gains preserve the calibrated relationship between parts.')],
    [],[(p.stem.replace('_',' '),p.relative_to(ROOT).as_posix()) for p in sorted((ROOT/'cybr-song/scores').glob('*.pdf'))]+[('Instrument credits','cybr-song/README.md')],audio='cybr-song/demo-output/lantern-steps.flac')

for slug,name,folder,hero,intro,story in [
    ('caldera','The Sunken Caldera','grotto','caldera','A flooded volcanic gorge with a natural rock bridge, submerged shorelines, rooted vegetation and a distant cascade.', [('A shared visual language','Scenes supplies spectral transport and material recipes; GEO contributes rock geometry and the sunlight-to-water connection; Elements reconstructs water geometry; Light supplies the interface index.'),('Water and rock','Fractured walls frame a channel of turquoise water. Carbonate shelves, eroded boulders, ferns and shrubs create changes in scale. Waves are deterministically authored geometry for the still.'),('Iteration record','The gallery retains the finished image, earlier compositions, lighting studies and an unfiltered image. Process views are labeled so the development can be followed without confusing them with final deliverables.')]),
    ('tidal','The Tidal Engine','rebuild','tidal-engine','A hydraulic hall built around a bronze tidewheel, shuttered daylight and a water channel running beneath a timber bridge.', [('Four systems, one room','GEO generates the 72/28-tooth drive, Scenes supplies spectral transport and geometry helpers, Elements smooths the liquid surface, and Light contributes the water index model.'),('Architecture around a mechanism','A gear and pipe assembly, falling water sheet, pressure gauge and service bench give the hall a practical organization. Stone, timber and bronze respond to the same lighting.'),('Authored motion in a still','Ripples and spill geometry are authored for this image. All shadows, reflections and refractions are rendered together. Separate non-neural reconstruction preserves the raw films.')])]:
    add(slug,name,'Integrated worlds / geometry / light',intro,['4 CYBR projects connected','Native spectral rendering','Geometry + materials + light'],story,
        [group('Finished render',[(f'{folder}/renders/{hero}.png','Finished composition')]), group('Development & lighting',files(folder+'/renders','preview*.png')+files(folder+'/renders','lighting*.png')),group('Render inspection',[(f'{folder}/renders/{hero}_unfiltered.png','Unfiltered render — retained sampling noise')])], [('Scene documentation',folder+'/README.md')])

def thumb(path):
    out = ASSETS / (hashlib.sha1(path.encode()).hexdigest()[:12]+'.webp')
    if not out.exists() or out.stat().st_mtime < (ROOT/path).stat().st_mtime:
        with Image.open(ROOT/path) as im:
            im.thumbnail((1500,1200))
            im.convert('RGB').save(out,'WEBP',quality=86)
    return 'assets/'+out.name

def image(path,label):
    with Image.open(ROOT/path) as im: w,h=im.size
    return f'<figure class="gallery-item"><a class="zoom" href="../{esc(path)}" data-label="{esc(label)}"><img src="{thumb(path)}" width="{w}" height="{h}" alt="{esc(label)}" loading="lazy" decoding="async"><span class="zoom-label">View render ↗</span></a><figcaption>{esc(label)}<small>{w} × {h}</small></figcaption></figure>'

def shell(title,content):
    return layout(title,content,projects)

prepare_previews(projects)
derived_frames=derive_media(projects)
all_images=[]
for i,p in enumerate(projects):
    if p['slug']=='song':
        p['groups']=[group('Scores & tablature — opening pages', [('portfolio/assets/velvet-score.png','Velvet Switchblade — score, page 1'),('portfolio/assets/orchard-score.png','The Orchard Keeps the Rain — score, page 1'),('portfolio/assets/velvet-tab.png','Velvet Switchblade — guitar tablature, page 1')])]
    p['groups']=[(title,[(path,label+' — process') for path,label in items if 'unfiltered' not in path] if title=='Development & lighting' else items) for title,items in p['groups']]
    pics=[item for _,items in p['groups'] for item in items if 'unfiltered' not in item[0]]
    p['cover']=pics[0] if pics else None
    p['count']=sum(len(items) for _,items in p['groups'])
    all_images += [(p,item) for item in pics]
    head=detail_page(p,i,projects[(i+1)%len(projects)],thumb,image,compare_html,evidence_html,ROOT)
    (SITE/(p['slug']+'.html')).write_text(shell(p['name'],head),encoding='utf-8')

home=front_page(projects,thumb,len(all_images))
home+='<section id="render-index" class="detail-section"><div class="gallery-heading"><h2>Image index</h2><span>Renders, process & film frames</span></div><label class="archive-search">Search images<input type="search" id="render-search" placeholder="Water, ORBIT, quartz, score…"></label><div class="filters" aria-label="Filter renders"><button class="active" data-filter="all" aria-pressed="true">All</button>'+''.join(f'<button data-filter="{p["slug"]}" aria-pressed="false">{esc(p["name"].replace("CYBR ",""))}</button>' for p in projects if p['cover'])+'</div><p id="filter-status" role="status"></p><div class="index-grid">'
for p,item in all_images:
    home+=f'<div class="index-item" data-project="{p["slug"]}">{image(*item)}<a class="index-project" href="{p["slug"]}.html">{esc(p["name"])} →</a></div>'
home+='</div></section>'
(SITE/'index.html').write_text(shell('Portfolio',home),encoding='utf-8')
library='<section class="detail-intro"><p class="eyebrow">Project documentation</p><h1>Technical notes</h1><p class="project-lead">Models, measurements and recorded checks. Forty source artifacts organized by project.</p><nav class="library-nav">'+''.join(f'<a href="#proof-{p["slug"]}">{esc(p["name"])} ↘</a>' for p in projects)+'</nav></section>'
for p in projects:
    library+=f'<section class="library-project" id="proof-{p["slug"]}"><a href="{p["slug"]}.html">{esc(p["name"])} / VIEW PROJECT ↗</a>'+evidence_html(p['slug']).replace('id="evidence"','')+'</section>'
(SITE/'evidence.html').write_text(shell('Evidence library',library),encoding='utf-8')
report={'projects':len(projects),'gallery_images':len(all_images),'derived_film_frames':derived_frames,'evidence_artifacts':sum(map(len,REPORTS.values())),'optimized_images':len(list(ASSETS.glob('*.webp'))),'pages':[p['slug']+'.html' for p in projects]+['evidence.html']}
(SITE/'build-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
from publish_home import publish
publish()
