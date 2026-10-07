from pathlib import Path
import json
import numpy as np
from finish import read_pfm,display
from PIL import Image
root=Path(__file__).resolve().parents[1]/'output/optix-targeted-v1'
full=read_pfm(root/'test-full.pfm');region=read_pfm(root/'test-region.pfm');old=read_pfm(root/'test-v8.pfm')
mask=np.zeros(full.shape[:2],bool);mask[12:36,16:48]=True
assert np.array_equal(full,old),'Uncropped renderer changed'
assert np.array_equal(full[mask],region[mask]),'Region changed samples'
assert np.count_nonzero(region[~mask])==0,'Outside region was traced'
for suffix in ('position','normal','albedo','object','depth'):
    a=read_pfm(root/f'test-full_{suffix}.pfm');b=read_pfm(root/f'test-region_{suffix}.pfm')
    assert np.array_equal(a[mask],b[mask]),suffix
Image.fromarray(display(full)).resize((640,480)).save(root/'test-full.png')
Image.fromarray(display(region)).resize((640,480)).save(root/'test-region.png')
result=dict(fullMatchesV8=True,regionExact=True,outsideZero=True,aovsExact=True)
(root/'validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
