"""Check local links and browser film integrity without rerendering source projects."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import json
import subprocess

SITE = Path(__file__).resolve().parent

class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        self.paths.extend(value for key, value in attrs if key in
                          {'href', 'src', 'poster', 'data-preview', 'data-movie', 'data-original', 'data-poster'} and value)

checked = 0
missing = []
for page in SITE.glob('*.html'):
    parser = References()
    parser.feed(page.read_text(encoding='utf-8'))
    for ref in parser.paths:
        url = urlsplit(ref)
        if url.scheme or url.netloc or not url.path:
            continue
        checked += 1
        if not (page.parent / unquote(url.path)).exists():
            missing.append({'page': page.name, 'path': ref})

films = []
for entry in json.loads((SITE / 'motion-previews.json').read_text()):
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json',
        str(SITE / entry['preview'])], capture_output=True, text=True, check=True)
    metadata = json.loads(probe.stdout)
    assert float(metadata['format']['duration']) > 0
    films.append({'title': entry['title'], **metadata['streams'][0],
                  'duration': metadata['format']['duration']})

result = {'pages': len(list(SITE.glob('*.html'))), 'local_references': checked,
          'missing': missing, 'films': films}
(SITE / 'validation-report.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({'pages': result['pages'], 'local_references': checked,
                  'missing': len(missing), 'valid_films': len(films)}))
assert not missing, missing
