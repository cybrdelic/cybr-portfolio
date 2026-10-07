"""Use the actual project films as the portfolio's primary media."""
from pathlib import Path
from html import escape as esc
import subprocess
import json

ROOT=Path(__file__).resolve().parent.parent
SITE=ROOT/'portfolio'

def prepare_previews(projects):
    manifest=[]
    for project in projects:
        for title,source,poster in project['videos']:
            target=SITE/'assets'/f"play-{project['slug']}-{Path(source).stem}.mp4"
            if not target.exists() or target.stat().st_mtime < (ROOT/source).stat().st_mtime:
                subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(ROOT/source),'-vf','scale=min(1280\\,iw):-2','-c:v','libx264','-preset','veryfast','-crf','24','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart','-an','-y',str(target)],check=True,capture_output=True)
            manifest.append({'title':title,'project':project['slug'],'original':source,'preview':target.relative_to(SITE).as_posix(),'bytes':target.stat().st_size,'audio':'silent browser preview; original linked separately'})
    (SITE/'motion-previews.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')

def preview_url(slug,path):
    return f'assets/play-{slug}-{Path(path).stem}.mp4'

def cinema(project,thumb,home=False):
    films=project['videos']; first=films[1] if project['slug']=='elements' else films[0]
    title,source,poster=first
    heading='Elements' if home else project['name'].replace('CYBR ','')
    choices=''
    for n,(label,path,still) in enumerate(films):
        selected=label==title
        choices+=f'<button class="film-choice{(" selected" if selected else "")}" data-movie="{preview_url(project["slug"],path)}" data-original="../{path}" data-poster="{thumb(still)}" data-title="{esc(label)}" aria-pressed="{str(selected).lower()}"><img src="{thumb(still)}" alt="" loading="lazy"><span>{esc(label)}</span></button>'
    return f'''<section class="cinema" aria-label="{esc(heading)} films"><div class="cinema-heading"><h2>{esc(heading)}</h2><span>{len(films)} films</span></div><div class="screen"><video class="featured-film" controls muted loop playsinline preload="metadata" poster="{thumb(poster)}" data-preview="{preview_url(project['slug'],source)}" src="{preview_url(project['slug'],source)}" aria-label="{esc(title)} film"></video></div><div class="screen-caption"><span class="now-playing">{esc(title)}</span><div><button class="motion-toggle" type="button">Play film</button><a class="film-original" href="../{source}" target="_blank" rel="noopener">Original film ↗</a>{('<a href="elements.html">Project details ↗</a>' if home else '')}</div></div><div class="film-selection" aria-label="Choose a film">{choices}</div><p class="motion-state" role="status">Silent preview. Playback controls appear on the film.</p></section>'''

def loop_preview(project,thumb):
    title,source,poster=project['videos'][0]
    return f'<div class="motion-preview"><video class="inline-film" muted loop playsinline controls preload="none" poster="{thumb(poster)}" data-preview="{preview_url(project["slug"],source)}" src="{preview_url(project["slug"],source)}" aria-label="{esc(project["name"])} — {esc(title)}"></video><a href="{project["slug"]}.html">{esc(project["name"])} / All films ↗</a></div>'
