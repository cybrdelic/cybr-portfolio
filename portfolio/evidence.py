"""Source-backed portfolio evidence and derived media. Imported by build.py."""
from pathlib import Path
from html import escape as esc
import json
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'portfolio'

REPORTS = {
 'geo': [
  ('Assembly geometry','cybr-geo/docs/validation/orbit_v3/geometry-summary.json','148 named parts and the exported triangle count. Geometry evidence for the inspection wrist.'),
  ('Service-path audit','cybr-geo/docs/validation/orbit_v3/ORBIT_service_validation.json','Sampled CAD overlaps and tool access across the complete service sequence; not a continuous-motion or load certificate.'),
  ('Static assembly audit','cybr-geo/docs/validation/orbit_v3/ORBIT_static_validation.json','Nominal assembly checks retained with revision 3.'),
  ('Animation validation','cybr-geo/docs/validation/orbit_v3/ORBIT_animation_validation.json','Checks for the exported motion study.'),
  ('ROAM manufacturing map','cybr-geo/examples/roam/MANUFACTURING.md','Which workshop mechanisms cover each operation, and what is still outside their capability.')],
 'scenes': [
  ('Geometry & transport','cybr-scenes/scenes/observatory-iv/verification/geometry_and_transport.json','Authored triangle count, part count and closed quartz boundary checks.'),
  ('Optical numerical tests','cybr-scenes/scenes/observatory-iv/verification/numeric_tests.json','Portal PDF integration, Fresnel reflectance and wavelength-dependent quartz indices.'),
  ('Delivered image verification','cybr-scenes/scenes/observatory-iv/verification/delivery_verification.json','Checks retained alongside the Observatory delivery.'),
  ('Environment reproduction','cybr-scenes/docs/recovery-proof/README.md','Six fresh full-geometry verification renders and their receipts; distinct from production images.')],
 'light': [(name.title()+' render receipt',f'cybr-light/docs/media/{name}.json','Native backend, sample settings, render time and raw-film integrity for this study.') for name in ['caustics','anisotropy','dielectrics','materials','cornell','cloud','xml']],
 'elements': [
  ('Water film audit','cybr-elements/work/element-motion/sigil-02-active-elements/water-audit.json','336 decoded frames, dimensions and per-frame luminance/motion measurements. Agent review is recorded; user acceptance is not.'),
  ('Ice film audit','cybr-elements/work/element-motion/sigil-02-active-elements/ice-audit.json','Decoded frames and visual measurements for the fractured ice study.'),
  ('Lava film audit','cybr-elements/work/element-motion/sigil-02-active-elements/lava-audit.json','Decoded frames and visual measurements for the lava study.'),
  ('Lightning film audit','cybr-elements/work/element-motion/sigil-02-active-elements/lightning-audit.json','Retained audit of the electrical-volume film.'),
  ('Player verification','cybr-elements/work/element-motion/sigil-02-active-elements/browser-verification.json','Film dimensions, readiness and matching download links in the original player.'),
  ('Simulation & authored controls','cybr-elements/docs/PIPELINES.md','The precise boundaries between gas/liquid/rigid calculations and art-directed behavior.')],
 'combat': [
  ('Motion workbench verification','cybr-combat/demo-output/workbench/verification.json','15 interaction checks including schedule parity, edits, persistence and JSON round trips.'),
  ('Side-leap capture receipt','cybr-combat/demo-output/side-leap-study.capture.json','The actual frames, dimensions and capture checks for the side-view clip.'),
  ('Exported geometry audit','cybr-combat/evidence/export_geometry_step1.json','Historical checks on the exported buffers consumed by the renderer.'),
  ('60 Hz motion audit','cybr-combat/evidence/audit_60hz.json','Independent sampling of the authored motion path.'),
  ('Character & visual attribution','cybr-combat/THIRD_PARTY_NOTICES.md','Original choreography is distinguished from the licensed third-party character visuals.')],
 'song': [
  ('Lantern Steps measurement','cybr-song/demo-output/verification.json','Measured duration, note attacks, loudness, peak level and clipping count for the available FLAC.'),
  ('Note-by-note score','cybr-song/demo-output/score.json','Pitches, instruments, tempo map and event timing behind the performance.'),
  ('Source integrity','cybr-song/tests/source_integrity.json','Retained source hash checks for the restored instrument engine.'),
  ('Audio validation','cybr-song/tests/validation.json','Historical full-delivery validation and isolated attack-envelope tests.')],
 'caldera': [
  ('Image & transport verification','grotto/verification.json','Native resolution, finite radiance, BVH checks and water enclosure; includes remaining visual limits.'),
  ('Native self-tests','grotto/native-tests.json','Retained numerical tests for the renderer used by the scene.'),
  ('Production render settings','grotto/renders/caldera.json','Actual sampling and timing for this render.'),
  ('Visual review','grotto/REVIEW.md','Image observations recorded separately from numerical verification.')],
 'tidal': [
  ('Geometry & image verification','rebuild/verification.json','292,746 triangles, closed water and gear meshes, native dimensions and reconstruction settings.'),
  ('Native self-tests','rebuild/native-tests.json','Numerical checks for the integrated native renderer.'),
  ('Production render settings','rebuild/renders/tidal-engine.json','Actual camera, sampling and timing metadata.'),
  ('Source integration ledger','rebuild/provenance.json','Which source repositories and components contribute to the hall.'),
  ('Visual review','rebuild/REVIEW.md','Review of the finished image, including the corrected gear-normal defect.')]
}

def read(path):
    return json.loads((ROOT/path).read_text(encoding='utf-8-sig'))

def metrics(slug):
    if slug=='geo':
        d=read(REPORTS[slug][0][1]); s=read(REPORTS[slug][1][1])
        return [(str(d['parts']),'named CAD parts'),(f"{d['triangles']:,}",'exported triangles'),(str(s['checked_operations']),'sampled service operations'),(str(len(s['collisions'])),'reported sampled collisions')]
    if slug=='scenes':
        d=read(REPORTS[slug][0][1])['geometry']; s=read(REPORTS[slug][1][1])
        return [(f"{d['parts']:,}",'authored parts'),(f"{d['triangles_authored']:,}",'authored triangles'),(f"{s['portal_pdf_integral']:.6f}",'portal PDF integral'),(f"{s['fresnel_normal']:.3f}",'normal-incidence Fresnel')]
    if slug=='light':
        d=read(REPORTS[slug][0][1])
        return [(f"{d['photon_count']:,}",'caustics photons'),(str(d['wavelengths_per_packet']),'wavelengths / packet'),(str(d['packets_per_pixel']),'packets / pixel'),(f"{d['render_seconds']:.2f}s",'caustics preview render')]
    if slug=='elements':
        d=read(REPORTS[slug][0][1]); s=read(REPORTS[slug][1][1])
        return [(str(d['decodedFrames']),'water frames decoded'),(str(s['decodedFrames']),'ice frames decoded'),('1920 × 1080','film dimensions'),('30 fps','frame rate')]
    if slug=='combat':
        d=read(REPORTS[slug][0][1])
        return [(str(len(d['checks'])),'workbench checks'),(str(d['source_recipe_frames']),'workbench recipe frames'),(str(len(d['javascript_errors'])),'reported JavaScript errors'),(str(len(d['webgl_errors'])),'reported WebGL errors')]
    if slug=='song':
        d=read(REPORTS[slug][0][1]); return [(str(d['note_attacks']),'note attacks'),(f"{d['lufs']:.2f}",'integrated LUFS'),(f"{d['true_peak_dbfs']:.2f} dBFS",'true peak'),(str(d['clipped_samples']),'clipped samples')]
    d=read(REPORTS[slug][0][1])
    return [(' × '.join(map(str,d['size'])),'native image dimensions'),(f"{d.get('native_render_seconds',d.get('render_seconds')):.1f}s",'native render time'),(str(d.get('bvh_comparison_rays',d.get('bvh_equivalence_rays'))),'BVH comparison rays'),(str(d.get('nonfinite_paths',d.get('invalid_paths'))),'invalid paths')]

def compact(value,depth=0):
    if isinstance(value,dict):
        return {k:compact(v,depth+1) for k,v in list(value.items())[:24] if k not in ['rows','operations','parts','source_frame_indices','notes','clock_quarters','clock_seconds']}
    if isinstance(value,list):
        return value if len(value)<=8 and all(not isinstance(x,(dict,list)) for x in value) else f'{len(value)} entries — open full report'
    return value

def evidence_html(slug):
    html='<section class="evidence-section" id="evidence"><div class="gallery-heading"><div><p class="eyebrow">BENCH NOTES / TRACEABLE RESULTS</p><h2>Show the workings.</h2></div><span>RETAINED PROJECT EVIDENCE</span></div><div class="metric-grid">'
    html+=''.join(f'<div><strong>{esc(v)}</strong><span>{esc(label)}</span></div>' for v,label in metrics(slug))
    html+='</div><p class="evidence-note">Values below come from the retained project reports. The original runs have not been rerun for this portfolio; open each artifact to inspect its scope.</p><div class="receipt-list">'
    for n,(title,path,desc) in enumerate(REPORTS[slug]):
        if not (ROOT/path).exists(): raise FileNotFoundError(path)
        preview=json.dumps(compact(read(path)),indent=2) if path.endswith('.json') else '\n'.join((ROOT/path).read_text(encoding='utf-8-sig').splitlines()[:34])
        html+=f'<details class="receipt"><summary><span class="receipt-number">{n+1:02}</span><span><strong>{esc(title)}</strong><small>{esc(desc)}</small></span><span class="receipt-plus">+</span></summary><div class="receipt-body"><p>Artifact preview · <a href="../{path}" target="_blank" rel="noopener">Open complete {Path(path).suffix[1:].upper()} ↗</a></p><pre>{esc(preview[:5500])}</pre></div></details>'
    return html+'</div>'+bench_html(slug)+'</section>'

def bench_html(slug):
    if slug=='song':
        d=read('cybr-song/demo-output/score.json')
        notes=d['notes']; low=min(n['midi'] for n in notes)-2; high=max(n['midi'] for n in notes)+2
        end=max(n['off'] for n in notes); marks=[]
        for second in range(int(end)+1):
            x=55+second/end*920
            marks.append(f'<path d="M{x:.2f} 20V275" stroke="#394832"/><text x="{x:.2f}" y="298" fill="#a7bc98" font-size="10">{second}s</text>')
        for n in notes:
            x=55+n['on']/end*920; y=25+(high-n['midi'])/(high-low)*240
            width=max(3,(n['off']-n['on'])/end*920); color='#ff855d' if n['instrument']=='piano' else '#a8d8ca'
            label=f"{n['instrument']} / {n['pitch']} / {n['on']:.3f}–{n['off']:.3f}s / velocity {n['velocity']}"
            marks.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{width:.2f}" height="6" fill="{color}"><title>{esc(label)}</title></rect>')
        return '<div class="bench"><p class="eyebrow">SCORE → PERFORMANCE</p><h3>Every note has a place.</h3><p>The 33 events in Lantern Steps, plotted from the retained score. Horizontal length shows note duration; height shows MIDI pitch. Hover a note for instrument, pitch, timing and velocity.</p><div class="note-legend"><span>Piano / coral</span><span>Guitar / ice blue</span></div><svg class="piano-roll" role="img" aria-label="Lantern Steps: 33 note events plotted by time and pitch" viewBox="0 0 1000 315">'+''.join(marks)+'</svg><a href="../cybr-song/demo-output/score.json">Open the exact note schedule ↗</a></div>'
    if slug=='geo':
        d=read('cybr-geo/docs/validation/orbit_v3/ORBIT_service_validation.json')
        rows=''.join(f'<tr><td>{esc(op["id"])}</td><td>{esc(op["title"])}</td><td>{op["samples"]}</td><td>{op["max_overlap_mm3"]}</td></tr>' for op in d['operations'][:12])
        return '<div class="bench"><p class="eyebrow">SERVICE / OPERATION LOG</p><h3>Designed to come apart.</h3><p>The first 12 operations of the 331-operation service audit. Every movement has a name and sampled overlap measurement. These discrete checks do not certify continuous clearance.</p><div class="bench-table-wrap"><table><thead><tr><th>Step</th><th>Operation</th><th>Samples</th><th>Max overlap / mm³</th></tr></thead><tbody>'+rows+'</tbody></table></div><a href="../cybr-geo/docs/validation/orbit_v3/ORBIT_service_validation.json">Inspect all 331 operations ↗</a></div>'
    if slug=='light':
        rows=[]
        for title,path,_ in REPORTS['light']:
            d=read(path)
            rows.append(f'<tr><td>{esc(d["name"])}</td><td>{d["width"]} × {d["height"]}</td><td>{d["packets_per_pixel"]}</td><td>{d["render_seconds"]:.2f} s</td><td>{str(d["raw_film_finite"]).lower()}</td></tr>')
        return '<div class="bench"><p class="eyebrow">RENDER / RECORDED RUNS</p><h3>Seven images. Seven receipts.</h3><p>Settings and elapsed times copied from each retained example run. These describe the recorded runs, not a standardized hardware benchmark.</p><div class="bench-table-wrap"><table><thead><tr><th>Study</th><th>Dimensions</th><th>Packets / pixel</th><th>Render time</th><th>Finite raw film</th></tr></thead><tbody>'+''.join(rows)+'</tbody></table></div></div>'
    if slug=='combat':
        d=read(REPORTS[slug][0][1])
        return '<div class="bench"><p class="eyebrow">WORKBENCH / INTERACTION COVERAGE</p><h3>More than playback.</h3><p>The retained browser report records these checks as passed. The source recipe contains 235 frames; that is a separate workbench sequence from the original four-take performance.</p><ul class="check-list">'+''.join(f'<li>{esc(check)}</li>' for check in d['checks'])+'</ul></div>'
    if slug=='elements':
        return '<div class="bench"><p class="eyebrow">SOURCE / MOTION SAMPLING</p><h3>Follow the transformation.</h3><p>Each film below has five frames sampled at 10%, 30%, 50%, 70% and 90% of its duration. The captions preserve the timestamps; the extraction manifest identifies the source clip for every frame.</p><a href="frame-provenance.json">Inspect frame timestamps and source films ↗</a></div>'
    return ''

COMPARE={
 'scenes':('cybr-scenes/scenes/observatory-iv/renders/Observatory_IV.png','cybr-scenes/scenes/observatory-iv/renders/Observatory_IV_unfiltered.png','Observatory IV: finished / unfiltered'),
 'caldera':('grotto/renders/caldera.png','grotto/renders/caldera_unfiltered.png','Caldera: finished / unfiltered'),
 'tidal':('rebuild/renders/tidal-engine.png','rebuild/renders/tidal-engine_unfiltered.png','Tidal Engine: finished / unfiltered'),
}

def compare_html(slug,thumb):
    if slug not in COMPARE: return ''
    finished,raw,title=COMPARE[slug]
    return f'<section class="compare-section" id="compare"><div class="gallery-heading"><div><p class="eyebrow">IMAGE / RECONSTRUCTION</p><h2>{esc(title)}</h2></div></div><p>Move the divider to inspect reconstruction against the retained unfiltered image. The viewer uses reduced-size previews; both native files are linked below.</p><div class="compare-frame"><img src="{thumb(raw)}" alt="Unfiltered native render preview"><img class="compare-front" src="{thumb(finished)}" alt="Finished native render preview"><div class="compare-line"></div><span class="compare-left">FINISHED</span><span class="compare-right">UNFILTERED</span></div><label class="compare-control">Image divider <input type="range" min="0" max="100" value="50" aria-label="Finished versus unfiltered image divider"><output>50%</output></label><div class="compare-sources"><a href="../{finished}">Original finished image ↗</a><a href="../{raw}">Original unfiltered image ↗</a></div></section>'

def derive_media(projects):
    """Extract genuine frames from existing films; retain their timestamps and paths."""
    manifest=[]
    for p in projects:
        if p['slug'] not in ['elements','combat']: continue
        groups=[]
        for title,path,_ in p['videos']:
            duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(ROOT/path)],text=True).strip())
            items=[]
            for n,fraction in enumerate([.1,.3,.5,.7,.9]):
                time=duration*fraction
                out=SITE/'assets'/f"sequence-{p['slug']}-{Path(path).stem}-{n}.jpg"
                if not out.exists():
                    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(time),'-i',str(ROOT/path),'-frames:v','1','-vf','scale=960:-2','-q:v','3',str(out)],check=True,capture_output=True)
                item=(out.relative_to(ROOT).as_posix(),f'{title} / {time:.2f} s — extracted film frame')
                items.append(item); manifest.append({'source':path,'seconds':time,'frame_preview':item[0]})
            groups.append((title+' — motion contact sheet',items))
        p['groups'].extend(groups)
    (SITE/'frame-provenance.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    return len(manifest)
