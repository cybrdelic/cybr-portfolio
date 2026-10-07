"""Offline CYBR GEO mesh packaging for the persistent instrument.

Retains every named source part and CAD normal, batches by module/material,
unwraps machining coordinates and bakes local hemispherical visibility.
No view-projected beauty textures or nearest-vertex normal transfer.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, sys
import numpy as np
import trimesh
from trimesh.ray.ray_pyembree import RayMeshIntersector
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-geo/src'))
sys.path.insert(0,str(ROOT/'cybr-light/python'))
from mechanism_lab.core import load_cache
from mechanism_lab.v9 import _part_variation
from cybrlight import read_pfm
from metal_finish import machining_uv

NAMES=('geo','light','elements','song','combat','scenes')
EXPLODED=(-245,-104,9,111,220,345)

def export(folder,out,geometry='geometry-v3'):
    out.mkdir(parents=True,exist_ok=True)
    manifest={'version':2,'units':'mm','source':'CYBR GEO '+geometry,
        'appearance':'Preserved CAD normals; surface-coordinate roughness; offline ray-traced vertex occlusion; real-time reflections and transmission. No projected beauty images.',
        'modules':[],'meshes':[]}
    raw=bytearray();source_triangles=0;delivered=0;total_parts=0
    def block(array,dtype):
        while len(raw)%4:raw.append(0)
        array=np.ascontiguousarray(array,dtype=dtype)
        item={'offset':len(raw),'count':array.size,'dtype':str(array.dtype)}
        raw.extend(array.tobytes());return item
    for module,offset in zip(NAMES,EXPLODED):
        assembly=load_cache(folder/geometry/module)
        midpoint=(assembly.bounds[0]+assembly.bounds[1])/2
        manifest['modules'].append({'name':module,'explodedX':offset,'bounds':assembly.bounds.tolist(),
            'bakeCenter':midpoint.tolist(),'parts':len(assembly.parts)})
        batches={}
        opaque=[p for p in assembly.parts if p.material not in (3,7)]
        solid=trimesh.util.concatenate([trimesh.Trimesh(p.vertices,p.faces,process=False) for p in opaque])
        rays=RayMeshIntersector(solid)
        def occlusion(v,n):
            result=np.empty(len(v),np.float32)
            # Cosine-weighted deterministic hemisphere integration. Local AO is
            # static within each module, not a bake of inter-module shadows.
            samples=32;k=np.arange(samples);r=np.sqrt((k+.5)/samples)
            phi=k*2.399963229728653
            directions=np.stack((r*np.cos(phi),r*np.sin(phi),np.sqrt(1-r*r)),axis=1)
            for start in range(0,len(v),4096):
                points=v[start:start+4096];normal=n[start:start+4096]
                axis=np.tile([0.,0.,1.],(len(points),1));axis[np.abs(normal[:,2])>.95]=[0,1,0]
                tangent=np.cross(normal,axis);tangent/=np.maximum(np.linalg.norm(tangent,axis=1,keepdims=True),1e-12)
                bitangent=np.cross(normal,tangent)
                d=(directions[None,:,0,None]*tangent[:,None,:]+directions[None,:,1,None]*bitangent[:,None,:]+directions[None,:,2,None]*normal[:,None,:]).reshape(-1,3)
                origins=np.repeat(points+normal*.035,samples,axis=0)
                hits=rays.intersects_first(origins,d);valid=hits>=0
                distance=np.full(len(hits),1000.)
                normals=solid.face_normals[hits[valid]]
                distance[valid]=np.einsum('ij,ij->i',solid.triangles[hits[valid],0]-origins[valid],normals)/np.einsum('ij,ij->i',d[valid],normals)
                blocked=(distance>0)&(distance<24)
                result[start:start+len(points)]=1-blocked.reshape(-1,samples).mean(1)
            return result
        for part in assembly.parts:
            source_triangles+=len(part.faces);total_parts+=1
            v,f,n=part.vertices,part.faces,part.normals
            # CAD face seams carry distinct normals at identical positions.
            # Preserve them exactly; nearest-position normal transfer is invalid.
            n=n/np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
            ao=occlusion(v,n) if part.material not in (3,7) else np.ones(len(v))
            # Reuse the CYBR Light machining charts: circumferential U,
            # radial V on caps, axial V on barrels. Split UV seams without
            # welding CAD normals from adjacent faces.
            corner_uv=machining_uv(part).reshape(-1,3)[:,:2]
            keys=np.column_stack((f.reshape(-1),np.round(corner_uv,8)))
            _,keep,inverse=np.unique(keys,axis=0,return_index=True,return_inverse=True)
            source=f.reshape(-1)[keep]
            v,n,ao,uv=v[source],n[source],ao[source],corner_uv[keep]
            f=inverse.reshape(-1,3)
            assert np.isfinite(v).all() and np.isfinite(n).all()
            shifts={'geo__exploded_interface':-16,'geo__floating_fastener':-24,'light__exploded_rear_mount':17,'light__exploded_locking_ring':-21,'light__floating_optic_screw':-3}
            motion=next((shift for prefix,shift in shifts.items() if part.name.startswith(prefix)),0)
            feature=f'assembly-shift-{motion}' if motion else 'body'
            batch=batches.setdefault((part.material,feature),[[],[],[],0,[],[],[],[]])
            batch[0].append(v);batch[1].append(f+batch[3]);batch[2].append(n)
            batch[3]+=len(v);batch[4].append(part.name);batch[5].append(uv);batch[6].append(ao)
            rough_scale,color_scale=_part_variation(part.name)
            batch[7].append(np.tile([rough_scale,color_scale],(len(v),1)))
        for (material,feature),(vs,fs,ns,count,parts,uvs,aos,finishes) in batches.items():
            v=np.vstack(vs);f=np.vstack(fs);n=np.vstack(ns)
            n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
            delivered+=len(f)
            manifest['meshes'].append({'module':module,'material':material,'feature':feature,
                'assemblyShiftX':float(feature.removeprefix('assembly-shift-')) if feature.startswith('assembly-shift-') else 0,
                'positions':block(np.round(v,4),'<f4'),
                'normals':block(np.round(n*32767),'<i2'),
                'uv':block(np.vstack(uvs),'<f4'),
                'occlusion':block(np.concatenate(aos),'<f4'),
                'finish':block(np.vstack(finishes),'<f4'),
                'indices':block(f,'<u4'),'triangles':len(f),'sourceParts':parts})
        print(module+' surface bake complete',flush=True)
    payload=gzip.compress(bytes(raw),compresslevel=9,mtime=0)
    (out/'instrument.bin.gz').write_bytes(payload)
    env=read_pfm(folder/'studio'/'product-graded-v9.pfm')[::2,::2]
    rgba=np.concatenate((env,np.ones((*env.shape[:2],1))),axis=2).astype('<f4')
    # PFM reader returns top-down; Three DataTexture uses a bottom-up UV origin.
    env_bytes=gzip.compress(rgba[::-1].tobytes(),compresslevel=9,mtime=0)
    (out/'studio.f32.gz').write_bytes(env_bytes)
    rng=np.random.default_rng(4301);size=1024
    # Low-amplitude multiscale machining roughness, not painted reflections.
    streak=rng.normal(0,1,(size,1));noise=rng.normal(0,1,(size,size))
    field=np.clip(.65+.035*streak+.012*noise,.45,.85)
    rgb=np.repeat(np.uint8(field[:,:,None]*255),3,axis=2)
    Image.fromarray(rgb).save(out/'machined-roughness.png',optimize=True)
    manifest['environment']={'width':rgba.shape[1],'height':rgba.shape[0],
        'file':'studio.f32.gz','format':'linear RGBA float32, bottom-up'}
    manifest['stats']={'sourceParts':total_parts,'sourceTriangles':source_triangles,
        'triangles':delivered,'drawGroups':len(manifest['meshes']),
        'geometryBytes':len(payload),'decodedGeometryBytes':len(raw),
        'sha256':hashlib.sha256(payload).hexdigest()}
    (out/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
    print(json.dumps(manifest['stats']))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--folder',type=Path,required=True)
    p.add_argument('--out',type=Path,default=ROOT/'portfolio/assets/instrument-3d')
    p.add_argument('--geometry',default='geometry-v3')
    a=p.parse_args();export(a.folder,a.out,a.geometry)
