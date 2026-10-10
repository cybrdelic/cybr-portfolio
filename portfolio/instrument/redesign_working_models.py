"""Rebuild three instrument sculptures as named, validated native CAD parts.

Uses the existing millimetre/X-shaft contract and material IDs. Outputs a
versioned mesh package; old camera-projected appearance is never applied to
new geometry. The remaining three source modules retain their exact bytes.
"""
from pathlib import Path
import sys, math, json, gzip, hashlib, argparse
import numpy as np
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'cybr-geo/src'))
import cadquery as cq
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from mechanism_lab.core import Assembly, cad_part, save_cache, load_cache, validate
from mechanism_lab.geometry import ring, drill, bolt_circle
from recipe import MATERIALS
from metal_finish import machining_uv
from package_working_instrument import write_binary, vertex_visibility

MODULES = ('geo', 'light', 'elements')

def build(name):
    parts = []
    class AbsoluteShape(cq.Shape):
        def mesh(self, *args, **kwargs): return None
    def add(label, shape, material=0):
        if not shape.isValid() or shape.Volume() <= 0:
            raise ValueError(label + ': invalid solid')
        BRepTools.Clean_s(shape.wrapped)
        BRepMesh_IncrementalMesh(shape.wrapped, .055, False, .16, True).Perform()
        p = cad_part(name+'__'+label, AbsoluteShape(shape.wrapped), material, tolerance=.055,
                     angular=.10, analytic_normals=True, group=name,
                     role='Refined portfolio sculpture / '+label)
        parts.append(p)
    def rim(label, ro, ri, x, length, material=0, bevel=.25):
        q = ring(ro, ri, x, x+length)
        if bevel: q = cq.Workplane(obj=q).edges().chamfer(bevel).val()
        add(label, q, material)
    def bolt(label, x, y, z, length=6, direction=1):
        q = ring(2.4, 0, x, x+2.7).translate((0,y,z))
        socket = cq.Workplane('YZ').polygon(6,2.7).extrude(2).val().translate((x+1.1,y,z))
        head=q.cut(socket);shaft=ring(1.2,0,x-length,x).translate((0,y,z))
        if direction==-1:
            head=head.rotate((x,y,z),(x,y+1,z),180);shaft=shaft.rotate((x,y,z),(x,y+1,z),180)
        add(label+'_head',head,1);add(label+'_shaft',shaft,1)
    def flange(label,x,ro,ri,count=6):
        centers=bolt_circle(ro-4.4,count,math.pi/6)
        q=drill(ring(ro,ri,x,x+3.5),centers,1.45,x-1,x+5)
        q=cq.Workplane(obj=q).edges().chamfer(.22).val()
        add(label,q)
        for j,(y,z) in enumerate(centers): bolt(label+f'_bolt_{j}',x+3.5,y,z)
    if name == 'geo':
        # A slotted machined shell exposes a spiral stator and central bearing.
        barrel=ring(42,36,-38,9)
        for j in range(10):
            cutter=cq.Workplane('XY').box(33,16,15).edges('|Z').fillet(3).val().translate((-14,42,0)).rotate((0,0,0),(1,0,0),j*36)
            barrel=barrel.cut(cutter)
        add('slotted_shell',cq.Workplane(obj=barrel).edges().fillet(.28).val())
        flange('rear_mount',-43,46,22)
        flange('front_mount',10,46,27)
        for x in (-36,2): rim('turned_shoulder_'+str(x),43.2,36,x,6,1,.5)
        rim('graphite_inner_liner',30,28,-33,41,2,.25)
        for x in (-35,35): rim('takeup_guard_'+str(x),17,4,x-.6,1.2,1,.1)
        # Individually twisted vanes, anchored between the two flange planes.
        for j in range(10):
            a=j*36
            vane=cq.Workplane('YZ',origin=(-33,0,0)).center(32,0).rect(7.8,1.5).twistExtrude(38,28).val().rotate((0,0,0),(1,0,0),a)
            add(f'helical_stator_{j}',vane,1)
        rim('bearing_outer_race',32,28,17,5,1)
        rim('bearing_inner_race',25,20,17,5,1)
        for j,(y,z) in enumerate(bolt_circle(26.5,16)):
            add(f'bearing_ball_{j}',cq.Solid.makeSphere(1.65,cq.Vector(19,y,z),angleDegrees1=-90),1)
        rim('bearing_dust_seal',31,20,22.2,1.2,2,.1)
        flange('detached_interface',35,40,27,4)
        rim('rear_service_sleeve',3.8,2.8,-47,12,1,.12)
        rim('front_service_sleeve',3.8,2.8,35,26,1,.12)
        # Coarse enough to read at hero scale, without thousands of tiny ribs.
        for j in range(48):
            a=j*7.5
            q=cq.Workplane('XY').box(6,.7,1).val().translate((-32,43.25,0)).rotate((0,0,0),(1,0,0),a)
            add(f'service_grip_{j}',q,2)
    elif name == 'light':
        # Two independently seated lenses and their real air gap.
        rim('rear_cell',43,37,-14,10,2,.4)
        rim('rear_mount_lip',44,37,-15.5,2,1,.35)
        rim('front_cell',43,37,-2,10,2,.4)
        rim('front_mount_lip',44,37,7,2,1,.35)
        for label,center,radius in [('rear',-9,170),('front',3,145)]:
            sag=radius-math.sqrt(radius*radius-37*37)
            a=cq.Solid.makeSphere(radius,cq.Vector(center-radius+sag+1,0,0),angleDegrees1=-90)
            b=cq.Solid.makeSphere(radius,cq.Vector(center+radius-sag-1,0,0),angleDegrees1=-90)
            add(label+'_biconvex_lens',a.intersect(b).cut(ring(4.25,0,-40,40)),3)
        rim('front_retaining_bezel',42,36,20,2.4,1,.3)
        rim('rear_retaining_bezel',42,36,-26,2.4,1,.3)
        for j,(y,z) in enumerate(bolt_circle(45,3,math.pi/2)):
            add(f'cell_tie_rod_{j}',ring(1.9,0,-25,23).translate((0,y,z)),1)
            for x in (-19,12):
                add(f'cell_anchor_{j}_{x}',ring(3.7,1.9,x,x+4).translate((0,y,z)),0)
            bolt(f'collimation_adjuster_{j}',24,y,z,12)
        rim('service_sleeve',4.1,2.7,-31,62,1,.12)
        for j in range(24):
            a=j*15
            q=cq.Workplane('XY').box(1.1,.15,1.8).val().translate((16.15,41.2,0)).rotate((0,0,0),(1,0,0),a)
            add(f'focus_index_{j}',q,6)
    else:
        # Original vessel, water, seals and curved jacket are retained below.
        # The existing cached FLIP and combustion therefore keep their volume.
        for side in (-1,1):
            x=side*22
            outer=cq.Workplane('YZ').rect(69,73).extrude(2.5).edges('|X').fillet(8).val()
            inner=cq.Workplane('YZ').rect(63,67).extrude(5).edges('|X').fillet(6).val().translate((-1,0,0))
            corners=[(-31,-33),(31,-33),(-31,33),(31,33)]
            q=cq.Workplane(obj=outer.cut(inner)).edges().chamfer(.2).val().translate((x-1.25,0,0))
            q=drill(q,corners,1.3,x-2,x+3)
            add('protective_frame_'+str(side),q,0)
            for j,(y,z) in enumerate(corners):
                bolt(f'frame_socket_{side}_{j}',side*23.25,y,z,4,direction=side)
        for j,(y,z) in enumerate(corners):
            add(f'frame_tie_{j}',ring(1.7,1.2,-20.75,20.75).translate((0,y,z)),1)
    return Assembly('refined_'+name,parts,MATERIALS,metadata={'purpose':'Portfolio concept sculpture','revision':'hero-refined-1'})

def package(out,source,evidence,reuse=False):
    manifest=json.loads((source/'manifest.json').read_text())
    raw=gzip.decompress((source/'instrument.bin.gz').read_bytes())
    baseline=manifest['stats']['sha256']
    assert hashlib.sha256(raw).hexdigest()==baseline
    assert not manifest.get('modelRedesign'), 'Use the preserved v14 source as input'
    meshes=[];reports={};new_named={}
    keys=('positions','normals','indices','uv','occlusion','finish','colors')
    def original(record):
        result=dict(record)
        for key in keys:
            if key not in record: continue
            spec=record[key];stride=3 if key in ('positions','normals','colors') else 2 if key in ('uv','finish') else 1
            a=np.frombuffer(raw,dtype={'float32':'<f4','int16':'<i2','uint32':'<u4'}[spec['dtype']],offset=spec['offset'],count=spec['count']).copy().reshape(-1,stride)
            result[key]=a.astype(float)/32767 if key=='normals' else a
        return result
    def batch_parts(assembly):
        by_material={}
        for p in assembly.parts: by_material.setdefault((p.material,p.name if p.material==3 else ''),[]).append(p)
        result=[]
        for (mat,optical_name),parts in by_material.items():
            vs=[];ns=[];fs=[];uvs=[];ranges=[];count=0;index_count=0
            for p in parts:
                v,f,n=p.vertices,p.faces,p.normals
                corner=machining_uv(p).reshape(-1,3)[:,:2]
                _,keep,inverse=np.unique(np.column_stack((f.ravel(),np.round(corner,8))),axis=0,return_index=True,return_inverse=True)
                ids=f.ravel()[keep];v,n,uv,f=v[ids],n[ids],corner[keep],inverse.reshape(-1,3)
                ranges.append(dict(name=p.name,firstVertex=count,vertexCount=len(v),firstIndex=index_count,indexCount=f.size))
                vs.append(v);ns.append(n);uvs.append(uv);fs.append(f+count);count+=len(v);index_count+=f.size
                new_named[p.name]=dict(module=assembly.parts[0].group,material=mat,motion={'kind':'static'},assemblyShiftX=0,
                    role=p.role,provenance='CYBR GEO authored CAD redesign',boundsMM=p.bounds.tolist(),tags=['structural'])
                if p.cad is not None: cq.exporters.export(p.cad,str(evidence/'cad'/p.group/(p.name+'.step')))
            normals=np.vstack(ns);normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
            result.append(dict(module=parts[0].group,material=mat,feature=optical_name or f'{parts[0].group}-cell-{mat}',assemblyShiftX=0,motion={'kind':'static'},
                positions=np.vstack(vs),normals=normals,indices=np.vstack(fs),uv=np.vstack(uvs),
                occlusion=np.ones((count,1)),finish=np.ones((count,2)),partNames=[p.name for p in parts],partRanges=ranges))
        return result
    for module in manifest['modules']:
        name=module['name'];old=[m for m in manifest['meshes'] if m['module']==name]
        if name not in MODULES:
            meshes.extend(original(m) for m in old);continue
        cache=evidence/'cad'/name
        assembly=load_cache(cache) if reuse and (cache/'manifest.json').exists() else build(name)
        save_cache(assembly,cache)
        report=validate(assembly);reports[name]=report
        (evidence/'cad'/name/'validation.json').write_text(json.dumps(report,indent=2))
        # Keep ELEMENTS' exact internal volume and routed cable; both caches
        # still refer to this vessel. New hardware is additional real geometry.
        if name=='elements':meshes.extend(original(m) for m in old)
        else:
            manifest['namedParts']={k:v for k,v in manifest['namedParts'].items() if v['module']!=name}
        additions=batch_parts(assembly)
        vertex_visibility(additions,manifest.get('customMaterials',{}))
        meshes.extend(additions)
        points=np.concatenate([m['positions'] for m in meshes if m['module']==name]);lo,hi=points.min(0),points.max(0)
        module.update(bounds=[lo.tolist(),hi.tolist()],bakeCenter=((lo+hi)/2).tolist(),parts=sum(len(m['partNames']) for m in meshes if m['module']==name))
        print(json.dumps({'module':name,'newParts':len(assembly.parts),'newTriangles':report['triangles']}),flush=True)
    records,stats=write_binary(out,meshes)
    manifest['meshes']=records;manifest['stats']=stats;manifest['namedParts'].update(new_named)
    manifest['modelRedesign']={'revision':'precision-cells-1','baselineGeometrySHA256':baseline,'modules':list(MODULES),
        'elementsVolumePreserved':True,'routesPreserved':True,'legacyBeautyProjection':False}
    manifest.pop('losslessTransfer',None);manifest.pop('progressiveGeo',None)
    manifest['cadValidation']['redesign']=reports
    for key in ('core','coreMesh','runtimeCoreMesh'):
        if key in manifest['cadValidation']:
            manifest['cadValidation']['historical'+key[0].upper()+key[1:]]=manifest['cadValidation'].pop(key)
    manifest['runtimeTessellation']={'method':'Absolute OpenCascade surface tessellation for new CAD; exact retained attributes for original inserts',
        'newLinearDeflectionMM':.055,'newAngularDeflectionRad':.16,'retainedMeshBatchesByteIdentical':41}
    manifest['surfaceVisibility']['scope']='Exact retained source visibility plus new 12-ray local CAD visibility on revised parts'
    manifest['surfaceVisibility'].pop('rigidCasterGroups',None)
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (evidence/'validation.json').write_text(json.dumps(reports,indent=2))
    print(json.dumps({'package':str(out),'bytes':stats['geometryBytes'],'sha256':stats['sha256']}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--source',type=Path,required=True);p.add_argument('--evidence',type=Path,required=True);p.add_argument('--reuse-cache',action='store_true');a=p.parse_args()
    a.out.mkdir(parents=True,exist_ok=True);a.evidence.mkdir(parents=True,exist_ok=True);package(a.out,a.source,a.evidence,a.reuse_cache)
