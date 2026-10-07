"""CYBR Light offline studio bake from individually named CYBR GEO parts.

Raw floats, object-ID masks and render reports stay on the build drive.
Only the compact RGBA WebP is intended for browser delivery.
"""
from pathlib import Path
from dataclasses import replace
import sys,json,subprocess,time,hashlib,argparse
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-geo/src'))
sys.path.insert(0,str(ROOT/'cybr-light/python'))
from mechanism_lab.core import load_cache,Assembly,mesh_part
from mechanism_lab.geometry import tube_mesh
from cybrlight import Scene,Settings,Camera,read_pfm
from studio import write_studio
from finish import denoise,display

MODULES=('geo','light','elements','song','combat','scenes')
OFFSETS=(-245,-104,9,111,220,345)

def load_instrument(folder,name):
    if name!='instrument':return load_cache(folder/'geometry-v3'/name)
    parts=[];materials=None
    for module,x in zip(MODULES,OFFSETS):
        a=load_cache(folder/'geometry-v3'/module);materials=a.materials
        parts.extend(p.moved((x,0,0)) for p in a.parts)
    # Discrete flexible spans. Each lands on a bore/connector, never crosses an
    # optical solid, and has a horizontal tangent at its strain relief.
    spans=[((-90,-36,18),(-26,-8,-2.5),8),((44,-8,-2.5),(76,0,0),5),((147,0,0),(186,0,0),7),((255,0,0),(309,0,0),10)]
    for cable,(start,end,sag) in enumerate(spans):
        t=np.linspace(0,1,160);smooth=t*t*(3-2*t)
        points=np.array(start)+(np.array(end)-start)*smooth[:,None]
        points[:,0]=start[0]+(end[0]-start[0])*t
        points[:,2]-=sag*np.sin(np.pi*t)**2
        v,f=tube_mesh(points,2.35,16)
        parts.append(mesh_part(f'conduit_{cable}',v,f,4,group='conduit',role='Continuous red woven conduit'))
        for strand in range(8):
            phase=points[:,0]*.95+strand*np.pi/4
            v,f=tube_mesh(points+np.column_stack((t*0,2.4*np.cos(phase),2.4*np.sin(phase))),.13,5)
            parts.append(mesh_part(f'conduit_{cable}_braid_{strand}',v,f,4,group='conduit'))
    return Assembly('exploded_instrument',parts,materials)

def bake(folder,name,width,spp,bands,exe,revision='v7',threads=4,finish='legacy'):
    assembly=load_instrument(folder,name)
    out=folder/'renders'/name;out.mkdir(parents=True,exist_ok=True)
    scene=Scene('Portfolio instrument / '+name)
    scene.settings=Settings(width=width,height=round(width*(.625 if name=='instrument' else .8)),spp=spp,bands=bands,threads=threads,max_depth=18,rr_depth=6,filter='tent',seed=1307,exposure=.8)
    center=np.array([35/40,0,0]) if name=='instrument' else (assembly.bounds[0]+assembly.bounds[1])/80
    scene.camera=Camera(origin=center+np.array([50,-80,50]),target=center,up=(0,0,1),orthographic=True,ortho_scale=9.1 if name=='instrument' else 3.0)
    scene.material(name='Satin aluminium',type='metal',eta=.24,k=3.5,roughness=.18,alpha_u=.025,alpha_v=.065)
    scene.material(name='Polished steel',type='metal',eta=.2,k=3.8,roughness=.07)
    scene.material(name='Graphite anodized metal',type='plastic',color=(.028,.036,.045),roughness=.22)
    scene.material(name='Dispersive optical glass',type='glass',ior_a=1.48,ior_b=.012,absorption=(.004,.002,.001))
    scene.material(name='Enamel red',type='plastic',color=(.65,.014,.018),roughness=.18)
    scene.material(name='Satin nickel cymbal',type='plastic',color=(.72,.67,.54),roughness=.26)
    scene.material(name='Engraved notation',type='diffuse',color=.009)
    scene.material(name='Water',type='glass',ior_a=1.324,ior_b=.003,absorption=(.12,.024,.006))
    red_spectrum=folder/'studio'/'red-jacket.spd';red_spectrum.parent.mkdir(parents=True,exist_ok=True)
    wavelengths=np.arange(360,831,5)
    np.savetxt(red_spectrum,np.column_stack((wavelengths,.003+.6/(1+np.exp(-(wavelengths-625)/7)))),fmt='%.6f')
    scene.materials[4].spectra['color']=str(red_spectrum.resolve())
    coated=scene.material(name='Dichroic optical lens',type='glass',ior_a=1.48,ior_b=.008,absorption=(.001,.001,.001),film_nm=380,film_ior=2.8,film_gradient=(0,140,90))
    finish_materials={}
    if finish != 'legacy':
        from metal_finish import configure, machining_uv
        finish_materials=configure(scene,folder,microfinish=finish=='machined')
    # An HDR light rig cannot occlude the primary camera or the object-ID mask.
    graded=finish in ('studio','machined')
    studio=write_studio(folder/'studio'/('product-graded-v9.pfm' if graded else 'product-strips-v5.pfm'),graded=graded)
    scene.environment.update(texture=str(studio.resolve()),strength=1,flat=True)
    scene.notes=['Geometry from CYBR GEO recipe.py; standalone optical studio bake.','Transparent alpha uses primary visibility IDs; backdrop reflections are baked, not recomputed by the browser.']
    prefix=out/f'{name}-{revision}-{width}-{spp}spp'
    path=scene.save(prefix.with_suffix('.cys'))
    # Stream native triangles. Scene.mesh expands each triangle to Python
    # dictionaries; a full instrument would otherwise need several GB of RAM.
    with path.open('a') as f:
        primitive=0
        for i,p in enumerate(assembly.parts):
            material=coated if p.name.startswith('light__') and p.material==3 else p.material
            material=finish_materials.get(material,material)
            positions=(p.vertices[p.faces]/40).reshape(-1,9)
            normals=p.normals[p.faces].reshape(-1,9)
            rows=np.column_stack((positions,normals,np.ones(len(p.faces)),np.zeros((len(p.faces),3))))
            np.savetxt(f,rows,fmt=f'triangle {material} {i+1} '+' '.join(['%.8g']*18+['%d']*4))
            if finish != 'legacy' and p.material in (0,1,5):
                uv=machining_uv(p)
                np.savetxt(f,np.column_stack((np.arange(primitive,primitive+len(p.faces)),uv)),fmt='surface_uv %d '+' '.join(['%.8g']*9))
            primitive+=len(p.faces)
    started=time.perf_counter()
    with prefix.with_suffix('.log').open('w') as log:
        subprocess.run([str(exe),'--scene',str(path),'--out',str(prefix)],stdout=log,stderr=log,check=True)
    # Neutralize illuminant E before the display transform. The native XYZ to
    # sRGB matrix assumes D65, otherwise neutral studio metal acquires a pink cast.
    oidn=folder/'tools/oidn-2.5.1.x64.windows/bin/oidnDenoise.exe'
    rgb=display(denoise(prefix,oidn))
    ids=read_pfm(prefix.with_name(prefix.name+'_object').with_suffix('.pfm'))[:,:,0]
    alpha=((ids>=1)&(ids<=len(assembly.parts))).astype(np.uint8)*255
    rgba=Image.fromarray(np.dstack((rgb,alpha)))
    # Store full-framing transparent sprite, plus a neutral review composite.
    webp=prefix.with_suffix('.webp');rgba.save(webp,'WEBP',quality=94,method=6)
    if name=='instrument':
        for group in MODULES+('conduit',):
            members=[i+1 for i,p in enumerate(assembly.parts) if p.group==group]
            mask=np.isin(ids,members).astype(np.uint8)*255
            Image.fromarray(np.dstack((rgb,mask))).save(prefix.with_name(prefix.name+'-'+group).with_suffix('.webp'),'WEBP',quality=94,method=6)
    review=Image.new('RGB',rgba.size,(244,244,242));review.paste(rgba,mask=rgba.getchannel('A'));review.save(prefix.with_name(prefix.name+'-review').with_suffix('.jpg'),quality=94)
    report=json.loads(prefix.with_suffix('.json').read_text())
    result={'module':name,'parts':len(assembly.parts),'triangles':sum(len(p.faces) for p in assembly.parts),'width':width,'height':rgba.height,'spp':spp,'bands':bands,'wall_seconds':round(time.perf_counter()-started,2),'postprocess':'OIDN 2.5.1 normal+albedo guided; illuminant-E white balance; ACES display transform','browser_bytes':webp.stat().st_size,'sha256':hashlib.sha256(webp.read_bytes()).hexdigest(),'native_report':report,'file':str(webp)}
    result['finish_profile']=finish
    result['machining_uv']=finish!='legacy'
    prefix.with_name(prefix.name+'-bake').with_suffix('.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({k:v for k,v in result.items() if k!='native_report'}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--folder',type=Path,required=True);p.add_argument('--module',default='light');p.add_argument('--width',type=int,default=600);p.add_argument('--spp',type=int,default=24);p.add_argument('--bands',type=int,default=8);p.add_argument('--revision',default='v7');p.add_argument('--threads',type=int,default=4);p.add_argument('--exe',type=Path,default=Path('D:/CYBR-build/exploded-instrument/native-msvc/Release/cybr-light.exe'));p.add_argument('--finish',choices=['legacy','measured','studio','machined'],default='legacy');a=p.parse_args()
    bake(a.folder,a.module,a.width,a.spp,a.bands,a.exe,a.revision,a.threads,getattr(a,'finish','legacy'))
