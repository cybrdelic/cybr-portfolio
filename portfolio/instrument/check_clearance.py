"""Swept cable clearance against actual revised triangle surfaces (not bounds).
Cast perpendicular rays from the sampled centreline. Exact solid penetration
is checked separately with per-part containment; seals are intentional contacts.
"""
from pathlib import Path
import sys,json
import numpy as np,trimesh
from trimesh.ray.ray_pyembree import RayMeshIntersector
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'cybr-geo/src'))
from mechanism_lab.core import load_cache
build=Path(sys.argv[1]);routes=json.loads((build/'routes-v4.json').read_text());names=list(routes['spec']['ports'])
models={name:load_cache(build/'geometry-v4'/name) for name in names};reports=[]
for state in routes['states'][::5]:
    meshes=[];face_names=[];part_names=[]
    for name,offset in zip(names,state['offsets']):
        for part in models[name].parts:
            if part.material in (4,7) or 'port_seal' in part.name:continue
            shifts={'geo__exploded_interface':-16,'geo__floating_fastener':-24,'light__exploded_rear_mount':17,'light__exploded_locking_ring':-21,'light__floating_optic_screw':-3}
            shift=next((x for prefix,x in shifts.items() if part.name.startswith(prefix)),0)*state['progress']
            meshes.append(trimesh.Trimesh(part.vertices+[offset+shift,0,0],part.faces,process=False))
            part_names.append(part.name)
            face_names.extend([part.name]*len(part.faces))
    solid=trimesh.util.concatenate(meshes);ray=RayMeshIntersector(solid);bad=[];nearest=1e9
    for route in state['parts']:
        points=np.array(route['points']);t=np.gradient(points,axis=0);t/=np.linalg.norm(t,axis=1)[:,None]
        n=np.cross(t,[0,0,1]);n/=np.linalg.norm(n,axis=1)[:,None];b=np.cross(t,n)
        angle=np.arange(24)*2*np.pi/24;d=(n[:,None,:]*np.cos(angle)[None,:,None]+b[:,None,:]*np.sin(angle)[None,:,None]).reshape(-1,3)
        origins=np.repeat(points,24,axis=0);ids=ray.intersects_first(origins,d);ok=ids>=0;dist=np.full(len(ids),1e9)
        normals=solid.face_normals[ids[ok]];den=np.einsum('ij,ij->i',d[ok],normals)
        dist[ok]=np.einsum('ij,ij->i',solid.triangles[ids[ok],0]-origins[ok],normals)/den
        hit=(dist<2.35-.025)&(dist>1e-5);nearest=min(nearest,float(dist.min()))
        if hit.any():bad.append({'part':route['name'],'samples':int(hit.sum()),'minimum':float(dist[hit].min()),'surfaces':sorted(set(face_names[j] for j in ids[hit]))})
    points=np.vstack([p['points'] for p in state['parts']]);contained=[]
    for mesh,name in zip(meshes,part_names):
        bounds=mesh.bounds;mask=np.all((points>bounds[0]+1e-4)&(points<bounds[1]-1e-4),axis=1)
        if mask.any():
            inside=RayMeshIntersector(mesh).contains_points(points[mask])
            if inside.any():contained.append({'part':name,'centreline_points_inside':int(inside.sum())})
    reports.append({'progress':state['progress'],'minimumSurfaceDistance':nearest,'intersections':bad,'contained_in_solid':contained})
(build/'clearance-v4.json').write_text(json.dumps(reports,indent=2));print(json.dumps(reports))
