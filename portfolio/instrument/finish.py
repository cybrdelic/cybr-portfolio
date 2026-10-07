"""Explicit offline denoising and neutral display transform; raw films retained."""
from pathlib import Path
import subprocess,sys,json
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-light/python'))
from cybrlight import read_pfm

def denoise(prefix,tool,guides=None,suffix='denoised'):
    guides=guides or prefix
    normal=read_pfm(guides.with_name(guides.name+'_normal').with_suffix('.pfm'))*2-1
    ids=read_pfm(guides.with_name(guides.name+'_object').with_suffix('.pfm'))[:,:,0]
    normal[ids==0]=0
    guide=prefix.with_name(prefix.name+'-oidn-normal').with_suffix('.pfm')
    with guide.open('wb') as f:
        f.write(f'PF\n{normal.shape[1]} {normal.shape[0]}\n-1.0\n'.encode());f.write(normal[::-1].astype('<f4').tobytes())
    result=prefix.with_name(prefix.name+'-'+suffix).with_suffix('.pfm')
    with prefix.with_name(prefix.name+'-oidn').with_suffix('.log').open('w') as log:
        subprocess.run([str(tool),'-d','cpu','--hdr',str(prefix.with_suffix('.pfm')),'--nrm',str(guide),'--alb',str(guides.with_name(guides.name+'_albedo').with_suffix('.pfm')),'-q','high','-o',str(result)],stdout=log,stderr=log,check=True)
    film=read_pfm(result)
    if not np.isfinite(film).all():raise ValueError('Nonfinite denoised film')
    return film

def display(linear):
    linear=np.maximum(linear,0)/np.array([1.2048,.9483,.9087])*.55
    mapped=np.clip(linear*(2.51*linear+.03)/(linear*(2.43*linear+.59)+.14),0,1)
    srgb=np.where(mapped<=.0031308,12.92*mapped,1.055*mapped**(1/2.4)-.055)
    return np.round(srgb*255).astype(np.uint8)

def display_springs(linear,exposure=1.9):
    """Source Springs camera grade: hue-preserving exponential shoulder.

    Exposure 1.9 is recorded in the original hero.json. The neutral white
    calibration is CYBR LIGHT's, not the source renderer's different film.
    """
    linear=np.maximum(linear,0)/np.array([1.2048,.9483,.9087])*exposure
    peak=np.maximum(linear.max(axis=-1,keepdims=True),1e-6)
    mapped=np.clip(linear*(-np.expm1(-peak))/peak,0,1)
    srgb=np.where(mapped<=.0031308,12.92*mapped,1.055*mapped**(1/2.4)-.055)
    return np.round(srgb*255).astype(np.uint8)

if __name__=='__main__':
    prefix=Path(sys.argv[1]);tool=Path(sys.argv[2]);rgb=display(denoise(prefix,tool))
    sources=[prefix.with_suffix('.webp')]+[p for p in prefix.parent.glob(prefix.name+'-*.webp') if not p.stem.endswith('-polished')]
    for source in sources:
        alpha=np.asarray(Image.open(source).convert('RGBA'))[:,:,3]
        result=Image.fromarray(np.dstack((rgb,alpha)))
        result.save(source.with_name(source.stem+'-polished.webp'),'WEBP',quality=94,method=6)
    rgba=Image.open(prefix.with_name(prefix.name+'-polished.webp')).convert('RGBA')
    review=Image.new('RGB',rgba.size,(244,244,242));review.paste(rgba,mask=rgba.getchannel('A'))
    review.save(prefix.with_name(prefix.name+'-polished-review').with_suffix('.jpg'),quality=94)
    print(json.dumps({'review':str(prefix.with_name(prefix.name+'-polished-review').with_suffix('.jpg')),'denoiser':'OIDN 2.5.1 / normal+albedo guided','raw_preserved':True}))
