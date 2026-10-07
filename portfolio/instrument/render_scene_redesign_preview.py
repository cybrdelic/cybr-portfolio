"""Render the literal redesigned CAD cartridge to an isolated QA folder."""
import importlib.util, json
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('working_thumbs',Path(__file__).with_name('render-working-thumbs.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.OUT=ROOT/'portfolio/output/geo-working/scenes-redesign/preview'
organic=m.load_cache(m.WORK/'organics/cache')
with np.load(m.WORK/'organics/albedo.npz') as colors:
    row=m.render('scenes',organic,colors,800)
print(json.dumps({k:row[k] for k in ('file','preview','size','CADParts','organicParts')}))
