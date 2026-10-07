"""Stream the physical fused cartridge into a native CYBR LIGHT scene.

No raster projection and no lit vertex colors are used as material inputs.
Run preparation separately from tracing to release the Python geometry memory.
"""
from pathlib import Path
import argparse,gzip,hashlib,json,shutil,sys
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-light/python'))
from cybrlight import Scene,Settings,Camera
from module_materials import measured_metals,hardware_material

def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--width',type=int,default=640);p.add_argument('--spp',type=int,default=64);p.add_argument('--housing',type=Path)
    a=p.parse_args();out=a.out.resolve();out.mkdir(parents=True,exist_ok=True)
    base=ROOT/'portfolio/assets/springs-native-v1';doc=json.loads((base/'manifest.json').read_text())
    rawpath=out/'source-geometry.bin';digest=hashlib.sha256();size=0
    with gzip.open(base/'geometry.bin.gz','rb') as source,rawpath.open('wb') as dest:
        while chunk:=source.read(1024*1024):dest.write(chunk);digest.update(chunk);size+=len(chunk)
    assert size==doc['decodedBytes'] and digest.hexdigest()==doc['sha256']
    raw=np.memmap(rawpath,dtype='u1',mode='r')
    def attr(m,k):
        b=m[k];return np.ndarray((b['count']//b['size'],b['size']),dtype='<u4' if k=='index' else '<f4',buffer=raw,offset=b['offset'])
    for name in ('sky-sun.pfm','water-absorption.spd'):
        shutil.copyfile(ROOT/'portfolio/output/springs-gpu-water-scattering-v1'/name,out/name)
    s=Scene('Physical fused Desert Hot Springs cartridge — material validation')
    s.settings=Settings(width=a.width,height=round(a.width*.75),spp=a.spp,bands=16,max_depth=20,rr_depth=6,filter='tent',seed=1307)
    s.camera=Camera(origin=(3.3,2.8,4.5),target=(0,.05,0),up=(0,1,0),fov=43)
    s.environment.update(texture=str(out/'sky-sun.pfm'),strength=1,flat=True)
    mineral=s.material(type='landscape',color=1,roughness=.6,ior_a=1.5)
    water=s.material(type='glass',ior_a=1.334,ior_b=0,spectra={'absorption':str(out/'water-absorption.spd')},scattering=.025/.30,phase_g=.74)
    interior_world=np.eye(4);section_taper=0
    if a.housing:
        s.camera=Camera(origin=(6,4.4,8),target=(0,.3,0),up=(0,1,0),fov=38)
        housing=json.loads(a.housing.read_text())
        if 'interiorWorld' in housing:interior_world=np.asarray(housing['interiorWorld']).reshape(4,4,order='F');section_taper=housing.get('sectionTaper',0)
        optical=measured_metals(out)
        red=out/'cable-reflectance.spd';wavelengths=np.arange(360,831,5)
        np.savetxt(red,np.c_[wavelengths,.003+.6/(1+np.exp(-(wavelengths-625)/7))])
        for i,m in enumerate(housing['meshes']):
            material=m['material'];c=np.array(material['color'])
            kw=hardware_material(material,optical,red)
            material_id=s.material(**kw)
            v=np.array(m['position']).reshape(-1,3);n=np.array(m['normal']).reshape(-1,3);world=np.array(m['world']).reshape(4,4,order='F')
            faces=np.array(m['index'] if m['index'] is not None else np.arange(len(v))).reshape(-1,3)
            uv=np.asarray(m['uv']).reshape(-1,2) if m.get('uv') else None
            s.mesh(v,faces,material_id,normals=n,uv=uv,transform=world,object_id=20+i)
        floor=s.material(type='diffuse',color=(.72,.71,.69))
        s.quad((-50,-1.185,-50),(0,0,100),(100,0,0),floor,object_id=200)
    scene=s.save(out/'scene.cys');primitive=len(s.primitives);mesh_audit=[]
    del s  # Do not retain the Python housing triangle dictionaries during export.
    with scene.open('a',buffering=1024*1024) as f:
        for oid,m in enumerate(doc['meshes'],1):
            vertices=attr(m,'position');faces=attr(m,'index').reshape(-1,3)
            wet=m['material']=='water';normals=attr(m,'normal' if wet else 'shadingNormal')
            if m['name']=='Sealed mineral section' and section_taper:
                vertices=vertices.copy();r=np.linalg.norm(vertices[:,[0,2]],axis=1);scale=1-section_taper*np.clip((-.05-vertices[:,1])/.78,0,1)
                normals=np.c_[vertices[:,0]/r,-section_taper*r/.78,vertices[:,2]/r];vertices[:,0]*=scale;vertices[:,2]*=scale
            mat=water if wet else mineral;begin=primitive
            for start in range(0,len(faces),2048):
                ids=faces[start:start+2048];v=vertices[ids]@interior_world[:3,:3].T+interior_world[:3,3];n=normals[ids]@np.linalg.inv(interior_world[:3,:3]);n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-12)
                valid=np.linalg.norm(np.cross(v[:,1]-v[:,0],v[:,2]-v[:,0]),axis=1)>1e-12
                ids=ids[valid];v=v[valid];n=n[valid];count=len(ids)
                rows=np.column_stack((np.full(count,mat),np.full(count,oid),v.reshape(-1,9),n.reshape(-1,9),np.ones(count),np.zeros((count,3))))
                np.savetxt(f,rows,fmt=['triangle %d','%d']+['%.9g']*18+['%d']+['%.9g']*3)
                if not wet:
                    color=attr(m,'albedo')[ids].reshape(-1,9);params=attr(m,'parameters')[ids].reshape(-1,9)
                    assert np.isfinite(color).all() and np.isfinite(params).all()
                    assert color.min()>=0 and color.max()<=1,(m['name'],color.min(),color.max())
                    rows=np.column_stack((np.arange(primitive,primitive+count),color,params))
                    np.savetxt(f,rows,fmt=['surface_material %d']+['%.9g']*18)
                primitive+=count
            mesh_audit.append(dict(name=m['name'],objectID=oid,triangles=primitive-begin,physicalVertexMaterial=not wet))
            print(json.dumps(mesh_audit[-1]),flush=True)
    receipt=dict(prepared=True,rendered=False,productionApproved=False,triangles=primitive,geometrySHA256=doc['sha256'],meshes=mesh_audit,
                 housingSHA256=hashlib.sha256(a.housing.read_bytes()).hexdigest() if a.housing else None,
                 limitations=['Source daylight, not yet hero studio lighting.','No steam transport.','Single-root refractive NEE.'])
    (out/'preparation.json').write_text(json.dumps(receipt,indent=2));print(str(scene),flush=True)

if __name__=='__main__':main()
