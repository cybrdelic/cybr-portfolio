"""CYBR LIGHT spectral camera-path bake on the current CYBR GEO mesh.

Native position/object AOVs supply reprojection visibility: no Mitsuba or
Embree. Each invocation exports and renders one checkpoint, then exits.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, shutil, subprocess, sys, time
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'cybr-light/python'))
sys.path.insert(0, str(ROOT/'cybr-geo/src'))
from cybrlight import Scene, Settings, Camera, read_pfm
from mechanism_lab.geometry import tube_mesh
from studio import write_studio
from metal_finish import configure
from finish import denoise, display
from light_bake_contract import REVISION, signature

SCALE = 40.0


def camera_from_state(state):
    p = np.array(state['projection']).reshape(4, 4, order='F')
    world = np.array(state['world']).reshape(4, 4, order='F')
    eye = world[:3, 3].copy()
    perspective = -p[3, 2] > 1e-9
    if perspective:
        eye += world[:3, 2]*(p[3, 3]/(-p[3, 2]))
    return Camera(origin=eye/SCALE, target=eye/SCALE-world[:3, 2],
                  up=world[:3, 1], orthographic=not perspective,
                  ortho_scale=2/p[1, 1]/SCALE,
                  fov=float(np.degrees(2*np.arctan(-p[3, 2]/p[1, 1]))) if perspective else 40)


def materials(scene, build):
    scene.material(name='Aluminium', type='metal', eta=.24, k=3.5, roughness=.18)
    scene.material(name='Chromium finish', type='metal', eta=.2, k=3.8, roughness=.07)
    scene.material(name='Graphite', type='metal', eta=(2.2,2.4,2.7), k=(1.8,1.9,2), roughness=.24)
    scene.material(name='Optical glass', type='glass', ior_a=1.48, ior_b=.008, absorption=(.004,.002,.001))
    scene.material(name='Red cable', type='plastic', color=(.62,.009,.014), roughness=.24)
    scene.material(name='Nickel cymbal', type='metal', eta=1.9, k=3.5, roughness=.2)
    scene.material(name='Engraved notation', type='diffuse', color=.009)
    scene.material(name='FLIP water', type='glass', ior_a=1.324, ior_b=.003, absorption=(.12,.024,.006))
    coated = scene.material(name='Dichroic lens', type='glass', ior_a=1.48, ior_b=.008,
                           absorption=(.001,.001,.001), film_nm=380, film_ior=2.8,
                           film_gradient=(0,140,90))
    configure(scene, build, microfinish=False)
    # Explicit red reflectance avoids the coarse RGB spectral reconstruction
    # turning the conduit orange under the neutral studio illuminant.
    spectrum=build/'studio'/'light-path-red.spd'
    wavelengths=np.arange(360,831,5)
    np.savetxt(spectrum,np.column_stack((wavelengths,.003+.6/(1+np.exp(-(wavelengths-625)/7)))),fmt='%.9g')
    scene.materials[4].spectra['color']=str(spectrum.resolve())
    return coated


def triangles(stream, vertices, faces, normals, material, owner, primitive=0, uv=None, colors=None, parameters=None, position_offset=0., normal_scale=1., chunk_size=1024):
    # Bounded conversion buffers; never create per-triangle Python dictionaries.
    kept=0
    for first in range(0, len(faces), chunk_size):
        f = faces[first:first+chunk_size]
        positions=vertices[f].astype(float);positions[:,:,0]+=position_offset
        normal=normals[f].astype(float)/normal_scale
        area2=np.linalg.norm(np.cross(positions[:,1]-positions[:,0],positions[:,2]-positions[:,0]),axis=1)
        assert np.isfinite(area2).all() and np.isfinite(normal).all()
        valid=area2>1e-10;f=f[valid];positions=positions[valid];normal=normal[valid]
        first_primitive=primitive+kept;kept+=len(f)
        rows = np.column_stack(((positions/SCALE).reshape(-1,9), normal.reshape(-1,9),
                                np.ones(len(f)), np.zeros((len(f),3))))
        np.savetxt(stream, rows, fmt=f'triangle {material} {owner} '+' '.join(['%.14g']*18+['%d']*4))
        ids=np.arange(first_primitive,first_primitive+len(f))
        if uv is not None:
            coords=np.zeros((len(f),3,3));coords[:,:,:2]=uv[f]
            np.savetxt(stream,np.column_stack((ids,coords.reshape(-1,9))),fmt=['surface_uv %d']+['%.14g']*9)
        if colors is not None or parameters is not None:
            assert colors is not None and parameters is not None
            np.savetxt(stream,np.column_stack((ids,colors[f].reshape(-1,9),parameters[f].reshape(-1,9))),fmt=['surface_material %d']+['%.14g']*18)
    return {'input':len(faces),'exported':kept,'zeroAreaRemoved':len(faces)-kept,'nextPrimitive':primitive+kept}


def export(build, work, state, width, spp, bands, threads, cartridge_source=None):
    source = ROOT/'portfolio/assets/instrument-3d'
    manifest = json.loads((source/'manifest.json').read_text())
    if cartridge_source:
        manifest=json.loads((cartridge_source/'native-manifest.json').read_text())
        raw_file=work/'native-geometry.bin';digest=hashlib.sha256()
        with gzip.open(cartridge_source/'instrument-native.bin.gz','rb') as src,raw_file.open('wb') as dest:
            while chunk:=src.read(1024*1024):dest.write(chunk);digest.update(chunk)
        assert digest.hexdigest()==manifest['stats']['sha256']
        raw=np.memmap(raw_file,dtype='u1',mode='r')
    else:raw = gzip.decompress((source/'instrument.bin.gz').read_bytes())
    def attr(spec, width):
        return np.frombuffer(raw, dtype=spec['dtype'], offset=spec['offset'], count=spec['count']).reshape(-1,width)
    scene = Scene('CYBR GEO assembly / CYBR LIGHT camera-path bake')
    scene.settings = Settings(width=width, height=round(width/1.6), spp=spp, bands=bands,
                              threads=threads, max_depth=20, rr_depth=6, filter='tent', seed=1307)
    scene.camera = camera_from_state(state)
    material_build=work if cartridge_source else build
    if cartridge_source:
        optical_dir=work/'studio/optical-constants';optical_dir.mkdir(parents=True,exist_ok=True)
        for name in ('Al.yml','Cr.yml','Ni.yml'):shutil.copyfile(build/'studio/optical-constants'/name,optical_dir/name)
    coated = materials(scene, material_build)
    custom={}
    if cartridge_source:
        from module_materials import measured_metals,hardware_material
        optical=measured_metals(work);red=material_build/'studio/light-path-red.spd'
        # Miniature units become 15 mm and then native world units / 40.
        absorption=np.loadtxt(ROOT/'portfolio/output/springs-gpu-water-scattering-v1/water-absorption.spd')
        absorption[:,1]/=(15/SCALE);water_spd=work/'springs-absorption.spd';np.savetxt(water_spd,absorption)
        for key,a in manifest['customMaterials'].items():
            role=a['role'];c=np.asarray(a['color'])
            if role=='springs-water':kw=dict(type='glass',ior_a=1.334,ior_b=0,spectra={'absorption':str(water_spd.resolve())},scattering=.025/.30/(15/SCALE),phase_g=.74)
            elif role=='landscape':kw=dict(type='landscape',color=1,roughness=.6,ior_a=1.5)
            elif role in ('shirt','shorts'):kw=dict(type='landscape',color=c,roughness=.86,ior_a=1.46)
            elif role=='body':kw=dict(type='plastic',color=c*.78,roughness=.42,ior_a=1.46)
            else:kw=hardware_material(a,optical,red)
            custom[int(key)]=scene.material(name=role+' '+key,**kw)
    studio = write_studio(material_build/'studio'/'light-path-studio.pfm', graded=True)
    scene.environment.update(texture=str(studio.resolve()), strength=1, flat=True)
    # World-fixed studio, camera-facing white cyclorama behind the assembly.
    world = np.array(state['world']).reshape(4,4,order='F')
    forward = -world[:3,2]
    center = (np.array([50.,0,0])+forward*800)/SCALE
    right, up = world[:3,0]*62.5, world[:3,1]*62.5
    backdrop = scene.material(name='Studio white', type='diffuse', color=(.88,.88,.87))
    scene.quad(center-right-up, right*2, up*2, backdrop, object_id=0)
    scene_file = scene.save(work/'scene.cys')
    offsets = {g['name']:g['x'] for g in state['groups']}
    shifts = {o['name']:o['shift'] for o in state['objects']}
    surfaces = {};geometry_audit=[];primitive=len(scene.primitives)
    with scene_file.open('a') as stream:
        for i, m in enumerate(manifest['meshes']):
            if m['material']==7: continue
            name = m['module']+'/'+m['feature']+'/'+str(m['material'])
            surfaces[name] = i+1
            v = attr(m['positions'],3)
            n = attr(m['normals'],3)
            mat = custom.get(m['material'],coated if m['module']=='light' and m['material']==3 else m['material'])
            audit=triangles(stream,v,attr(m['indices'],3),n,mat,i+1,primitive,uv=attr(m['uv'],2) if 'uv' in m else None,colors=attr(m['colors'],3) if 'parameters' in m else None,parameters=attr(m['parameters'],3) if 'parameters' in m else None,position_offset=offsets[m['module']]+shifts.get(name,0),normal_scale=32767 if m['normals']['dtype']=='int16' else 1)
            primitive=audit['nextPrimitive'];geometry_audit.append({'surface':name,**audit})
        for ci, points in enumerate(state['cables']):
            v,f = tube_mesh(points,2.35,16)
            # Smooth area-weighted vertex normals without another ray library.
            n = np.zeros_like(v)
            fn = np.cross(v[f[:,1]]-v[f[:,0]],v[f[:,2]]-v[f[:,0]])
            for k in range(3): np.add.at(n,f[:,k],fn)
            n /= np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-12)
            audit=triangles(stream,v,f,n,4,200+ci,primitive);primitive=audit['nextPrimitive'];geometry_audit.append({'surface':f'cable-{ci}',**audit})
        fluid_dir = build/'fluid-v4-contact'
        fm = json.loads((fluid_dir/'manifest.json').read_text())
        fluid_frame = round(state['progress']*(len(fm['frames'])-1))
        item = fm['frames'][fluid_frame]
        b = gzip.decompress((fluid_dir/item['file']).read_bytes()); count=item['count']
        v = np.frombuffer(b,dtype='<i2',count=count*3).reshape(-1,3).astype(float)/512
        v[:,0] += offsets['elements']
        n = np.frombuffer(b,dtype='<i2',offset=count*6).reshape(-1,3).astype(float)/32767
        geometry_audit.append({'surface':'fluid',**triangles(stream,v,np.arange(count).reshape(-1,3),n,7,250,primitive)})
    (work/'geometry-audit.json').write_text(json.dumps(geometry_audit,indent=2))
    return manifest.get('runtimeGeometryHash',manifest['stats']['sha256']), surfaces, fluid_frame


def finish(work, state, build):
    prefix = work/'native'
    rgb = display(denoise(prefix,build/'tools/oidn-2.5.1.x64.windows/bin/oidnDenoise.exe'))
    Image.fromarray(rgb).save(work/'beauty.png')
    Image.fromarray(rgb).save(work/'beauty.webp',lossless=True)
    positions = read_pfm(work/'native_position.pfm').astype(float)*SCALE
    ids = np.rint(read_pfm(work/'native_object.pfm')[:,:,0]).astype(np.uint16)
    # Water contributes to transport, but its enclosing glass is the runtime
    # projection surface. Do not assign fluid pixels to an unrelated CAD part.
    ids[ids>205] = 0
    view = np.linalg.inv(np.array(state['world']).reshape(4,4,order='F'))
    depth = -(positions@view[2,:3]+view[2,3])
    mask = ids>0
    assert mask.any() and np.isfinite(depth).all()
    lo,hi = float(depth[mask].min()),float(depth[mask].max())
    encoded = np.round(np.clip((depth-lo)/max(hi-lo,1e-6),0,1)*65535).astype(np.uint16)
    Image.fromarray(np.stack((encoded>>8,encoded&255,ids),axis=-1).astype(np.uint8)).save(work/'visibility.png')
    return [lo,hi]


def main():
    p=argparse.ArgumentParser();p.add_argument('--build',type=Path,required=True)
    p.add_argument('--index',type=int,required=True);p.add_argument('--width',type=int,default=1280)
    p.add_argument('--spp',type=int,default=128);p.add_argument('--bands',type=int,default=8)
    p.add_argument('--threads',type=int,default=8);p.add_argument('--draft',action='store_true')
    p.add_argument('--finish-only',action='store_true');a=p.parse_args()
    start=time.time();build=a.build.resolve();folder=build/'path-bake-light';folder.mkdir(exist_ok=True)
    path=json.loads((build/'path-bake/path.json').read_text())
    (folder/'path.json').write_text(json.dumps(path))
    state=path['frames'][a.index];work=folder/(('draft-' if a.draft else '')+f'{a.index:03d}');work.mkdir(exist_ok=True)
    if not a.finish_only:
        geometry,surfaces,fluid=export(build,work,state,a.width,a.spp,a.bands,a.threads)
        (work/'export.json').write_text(json.dumps({'geometry':geometry,'surfaces':surfaces,'fluid':fluid}))
        print(json.dumps({'stage':'render','index':a.index,'renderer':'CYBR LIGHT','width':a.width,'spp':a.spp,'bands':a.bands}),flush=True)
        exe=build/'native-msvc/Release/cybr-light.exe'
        with (work/'native.log').open('w') as log:
            subprocess.run([str(exe),'--scene',str(work/'scene.cys'),'--out',str(work/'native')],stdout=log,stderr=log,check=True)
    export_info=json.loads((work/'export.json').read_text())
    depth=finish(work,state,build)
    report=json.loads((work/'native.json').read_text())
    assert report['renderer'].startswith('CYBR LIGHT') and report['invalid_path_samples']==0
    receipt={**state,'index':a.index,'width':report['width'],'height':report['height'],
             'spp':report['packets_per_pixel'],'bands':report['wavelengths_per_packet'],
             'depthRange':depth,'fluidFrame':export_info['fluid'],'seconds':time.time()-start,
             'renderer':'CYBR LIGHT 0.2 native spectral + OIDN','revision':REVISION,
             'pipelineSHA256':signature(build),
             'sourceGeometry':export_info['geometry'],'surfaces':export_info['surfaces'],
             'nativeReport':report,'sceneSHA256':hashlib.sha256((work/'scene.cys').read_bytes()).hexdigest(),
             'complete':True,'draft':a.draft}
    (work/'receipt.pending.json').write_text(json.dumps(receipt));(work/'receipt.pending.json').replace(work/'receipt.json')
    print(json.dumps({'stage':'complete','index':a.index,'seconds':receipt['seconds'],'draft':a.draft}),flush=True)


if __name__=='__main__': main()
