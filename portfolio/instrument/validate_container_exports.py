"""Inspect geometry and optical export invariants, not visual approval."""
from pathlib import Path
import json,struct
import numpy as np
import trimesh

root=Path(__file__).resolve().parents[1];results=[]
for name in ('combat','springs'):
    file=root/'assets/display-modules'/f'{name}-container-c.glb';data=file.read_bytes()
    magic,version,length=struct.unpack_from('<III',data);assert (magic,version,length)==(0x46546c67,2,len(data))
    size,kind=struct.unpack_from('<II',data,12);assert kind==0x4e4f534a
    doc=json.loads(data[20:20+size]);assert doc['meshes'] and all('mesh' in n for n in doc['nodes'])
    native=json.loads((root/'output'/f'{name}-container-c-native.json').read_text());count=0;glass=[]
    for part in native['meshes']:
        p=np.asarray(part['position']).reshape(-1,3);n=np.asarray(part['normal']).reshape(-1,3)
        faces=np.asarray(part['index'] if part['index'] is not None else np.arange(len(p))).reshape(-1,3)
        assert np.isfinite(p).all() and np.isfinite(n).all() and faces.min()>=0 and faces.max()<len(p)
        count+=len(faces)
        if part['material'].get('nativeType')=='glass':
            mesh=trimesh.Trimesh(p,faces,process=True)
            assert mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0 and mesh.euler_number==2
            glass.append(dict(name=part['name'],watertight=True,volume=float(mesh.volume),ior=part['material']['ior']))
    if name=='springs':
        assert len(glass)==1 and len(native['interiorWorld'])==16
        assert any('KHR_materials_transmission' in m.get('extensions',{}) for m in doc['materials'])
    results.append(dict(module=name,containerMeshes=len(doc['meshes']),containerGLBBytes=len(data),nativeTriangles=count,glass=glass))
out=root/'output/container-c-validation.json';out.write_text(json.dumps(dict(results=results,visualApproval=False),indent=2));print(json.dumps(results))
