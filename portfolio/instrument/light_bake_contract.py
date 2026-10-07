"""Small, dependency-free identity used by the worker and supervisor."""
from pathlib import Path
import hashlib

REVISION='cybr-light-path-1'

def signature(build):
    scripts=Path(__file__).resolve().parent
    files=[scripts/name for name in ('bake_light_path.py','finish.py','studio.py','metal_finish.py')]
    files += [build/'native-msvc/Release/cybr-light.exe',build/'fluid-v4-contact/manifest.json']
    files += [build/'studio/optical-constants'/name for name in ('Al.yml','Cr.yml','Ni.yml')]
    result=hashlib.sha256()
    for path in files:
        result.update(path.name.encode());result.update(hashlib.sha256(path.read_bytes()).digest())
    return result.hexdigest()
