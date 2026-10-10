"""Export the actual ORBIT recipe and selected original instrument meshes.

Absolute OCC tessellation changes mesh sampling, never the authored solids.
Run with the CAD environment and --geo-source pointing to the owned GEO repo.
"""
from pathlib import Path
import argparse, importlib.util, sys, json, gzip, hashlib
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'portfolio/assets/specimens'

def write_model(name,parts,materials,source):
    folder=OUT/name;folder.mkdir(parents=True,exist_ok=True)
    data=bytearray();records=[]
    for part in parts:
        record={k:v for k,v in part.items() if k not in ('positions','normals','indices')}
        for key,dtype in [('positions','<f4'),('normals','<i2'),('indices','<u4')]:
            values=np.asarray(part[key])
            if key=='normals':values=np.round(np.clip(values,-1,1)*32767)
            values=values.astype(dtype).ravel()
            while len(data)%4:data.append(0)
            record[key]={'offset':len(data),'count':len(values),'dtype':dtype}
            data.extend(values.tobytes())
        records.append(record)
    packed=gzip.compress(data,compresslevel=9,mtime=0)
    (folder/'geometry.bin.gz').write_bytes(packed)
    m=dict(name=name,version=1,units='mm',parts=records,materials=materials,source=source,
           geometry=dict(file='geometry.bin.gz',bytes=len(packed),decodedBytes=len(data),
                         sha256=hashlib.sha256(data).hexdigest(),compressedSHA256=hashlib.sha256(packed).hexdigest()),triangles=sum(p['indices']['count']//3 for p in records))
    (folder/'manifest.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'model':name,'parts':len(parts),'bytes':len(packed),'triangles':m['triangles']}),flush=True)

def orbit(source,reuse):
    sys.path.insert(0,str(source/'src'))
    import cadquery as cq
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.BRepTools import BRepTools
    from mechanism_lab.core import cad_part,save_cache,load_cache,validate
    spec=importlib.util.spec_from_file_location('showcase_orbit',source/'examples/orbit_inspection_wrist.py')
    recipe=importlib.util.module_from_spec(spec);sys.modules[spec.name]=recipe;spec.loader.exec_module(recipe)
    cache=ROOT/'.local/showcases/orbit-cache'
    if reuse and (cache/'manifest.json').exists():assembly=load_cache(cache)
    else:
        class AbsoluteShape(cq.Shape):
            def mesh(self,*args,**kwargs):pass
        def export_part(name,shape,*args,**kw):
            if isinstance(shape,cq.Workplane):shape=shape.val()
            BRepTools.Clean_s(shape.wrapped)
            BRepMesh_IncrementalMesh(shape.wrapped,.035,False,.12,True).Perform()
            return cad_part(name,AbsoluteShape(shape.wrapped),*args,**kw)
        recipe.cad_part=export_part
        assembly=recipe.build();save_cache(assembly,cache)
    report=validate(assembly)
    (cache/'validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    parts=[dict(name=p.name,material=p.material,group=p.group,motion=p.motion,role=p.role,
                positions=p.vertices,normals=p.normals,indices=p.faces) for p in assembly.parts]
    write_model('geo',parts,[m.as_dict() for m in assembly.materials],
        dict(recipe='cybr-geo/examples/orbit_inspection_wrist.py',recipeSHA256=hashlib.sha256((source/'examples/orbit_inspection_wrist.py').read_bytes()).hexdigest(),
             revision=3,assembly='ORBIT inspection wrist',gearTeeth=[72,20],gearCenterMM=46,leadMM=3,jawTravelMM=6,jawGapMM=[21.8,33.8],
             tessellation=dict(absoluteDeflectionMM=.035,angularRad=.12),parts=len(parts)))

def elements():
    folder=ROOT/'portfolio/assets/instrument-working-v1'
    m=json.loads((folder/'manifest.json').read_text(encoding='utf-8'));raw=gzip.decompress((folder/'instrument.bin.gz').read_bytes())
    parts=[]
    for record in m['meshes']:
        if record['module']!='elements' or record['material']==7:continue
        p=dict(name=record['feature'],material=record['material'],motion='fixed',group='vessel',role='Original ELEMENTS glass vessel and support')
        for key,stride in [('positions',3),('normals',3),('indices',1)]:
            s=record[key];v=np.frombuffer(raw,dtype={'float32':'<f4','int16':'<i2','uint32':'<u4'}[s['dtype']],offset=s['offset'],count=s['count']).reshape(-1,stride)
            p[key]=v.astype(float)/32767 if key=='normals' and s['dtype']=='int16' else v
        parts.append(p)
    write_model('elements',parts,[dict(name='Aluminium',color=[.74,.76,.78],metalness=1,roughness=.28),dict(name='Steel',color=[.52,.56,.59],metalness=1,roughness=.24),dict(name='Seal',color=[.025,.03,.035],metalness=0,roughness=.55),dict(name='Glass',color=[.86,.96,.96],metalness=0,roughness=.06,transmission=1,ior=1.52)],dict(geometrySHA256=m['stats']['sha256'],fluid='instrument-elements-bake/water-shared-v3',simulation='Recorded APIC/FLIP',cavityMM=[53,55,59]))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--geo-source',type=Path,required=True);p.add_argument('--reuse-cache',action='store_true');a=p.parse_args()
    orbit(a.geo_source,a.reuse_cache);elements()
