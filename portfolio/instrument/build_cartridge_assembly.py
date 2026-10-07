"""Stage replacement cartridges as real meshes, with separate high-detail input.

Does not change the live hero manifest or publish camera-path bakes.
"""
from pathlib import Path
import argparse,gzip,hashlib,json,shutil
import numpy as np
from build_springs_physical import load
from runtime_lod import simplify_mesh
ROOT=Path(__file__).resolve().parents[1]

def transformed(p,n):
    return np.c_[p[:,0],-p[:,2],p[:,1]-.4].astype('<f4')*15,np.c_[n[:,0],-n[:,2],n[:,1]].astype('<f4')

def write_package(folder,meshes,native=False):
    folder.mkdir(parents=True,exist_ok=True);records=[];offset=0;digest=hashlib.sha256()
    filename='instrument-native.bin.gz' if native else 'instrument.bin.gz'
    with gzip.GzipFile(filename=str(folder/filename),mode='wb',compresslevel=6,mtime=0) as stream:
        for m in meshes:
            record={k:v for k,v in m.items() if not isinstance(v,np.ndarray)}
            for key,value in m.items():
                if not isinstance(value,np.ndarray):continue
                if not native and key=='parameters':continue
                if key=='normals' and not native:value=np.round(np.clip(value,-1,1)*32767).astype('<i2')
                elif key=='indices':value=value.astype('<u4')
                else:value=value.astype('<f4')
                value=np.ascontiguousarray(value);padding=(-offset)%4
                if padding:stream.write(bytes(padding));digest.update(bytes(padding));offset+=padding
                record[key]=dict(offset=offset,count=value.size,dtype='int16' if value.dtype==np.dtype('<i2') else 'uint32' if key=='indices' else 'float32')
                data=memoryview(value).cast('B')
                for start in range(0,len(data),65536):stream.write(data[start:start+65536]);digest.update(data[start:start+65536])
                offset+=value.nbytes
            records.append(record)
    return records,dict(triangles=sum(m['indices'].size//3 for m in meshes),drawGroups=len(meshes),geometryBytes=(folder/filename).stat().st_size,decodedGeometryBytes=offset,sha256=digest.hexdigest())

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--build',type=Path,required=True);parser.add_argument('--combat',required=True);parser.add_argument('--springs',required=True);parser.add_argument('--runtime',type=Path,default=ROOT/'assets/instrument-cartridges-v1');args=parser.parse_args()
    out=args.runtime;source=ROOT/'assets/instrument-3d'
    doc=json.loads((source/'manifest.json').read_text());raw=gzip.decompress((source/'instrument.bin.gz').read_bytes())
    meshes=[];native=[];definitions={};material_keys={};lod_audit=[]
    for record in doc['meshes']:
        if record['module'] in ('combat','scenes'):continue
        m={k:v for k,v in record.items() if not isinstance(v,dict)}
        for k,b in record.items():
            if not isinstance(b,dict) or 'offset' not in b:continue
            value=np.frombuffer(raw,dtype={'float32':'<f4','int16':'<i2','uint32':'<u4'}[b['dtype']],count=b['count'],offset=b['offset']).copy()
            if k=='normals':value=value.astype('<f4')/32767
            m[k]=value.reshape(-1,{'positions':3,'normals':3,'uv':2,'finish':2}.get(k,1))
        reduced,audit=simplify_mesh(m);lod_audit.append(dict(module=m['module'],feature=m['feature'],material=m['material'],**audit));meshes.append(reduced);native.append(m)
    def material(role,properties):
        key=json.dumps([role,properties],sort_keys=True)
        if key not in material_keys:
            i=8+len(material_keys);material_keys[key]=i;definitions[str(i)]=dict(role=role,**properties)
        return material_keys[key]
    def part(module,feature,mat,p,n,f,uv=None,color=None,params=None):
        p,n=transformed(p,n)
        r=dict(module=module,feature=feature,material=mat,assemblyShiftX=0,positions=p,normals=n,indices=np.asarray(f,dtype='<u4').reshape(-1,1),uv=np.asarray(uv,dtype='<f4') if uv is not None else p[:,:2]/40,occlusion=np.ones((len(p),1),dtype='<f4'),finish=np.ones((len(p),2),dtype='<f4'))
        if color is not None:r['colors']=np.asarray(color,dtype='<f4')
        if params is not None:r['parameters']=np.asarray(params,dtype='<f4')
        return r
    route=json.loads((ROOT/'instrument-route.json').read_text());route['internalRoutes']={};route_audit={};interior_world=np.eye(4);section_taper=0
    for module,file in [('combat',args.combat),('scenes',args.springs)]:
        payload=json.loads((ROOT/'output'/file).read_text());batches={}
        if module=='scenes' and 'interiorWorld' in payload:interior_world=np.asarray(payload['interiorWorld']).reshape(4,4,order='F');section_taper=payload.get('sectionTaper',0)
        assert len(payload.get('routes',[]))==1,'Expected one exact exported harness'
        exported=payload['routes'][0];world=np.asarray(exported['world']).reshape(4,4,order='F')
        points=np.asarray(exported['points']);points=points@world[:3,:3].T+world[:3,3]
        points,_=transformed(points,np.zeros_like(points))
        assert abs(exported['trunkRadius']*15-route['cableRadius'])<1e-6
        route['ports'][module]=points[[0,-1]].tolist();route['internalRoutes'][module]=points.tolist()
        route_audit[module]=dict(source=file,sourceSHA256=hashlib.sha256((ROOT/'output'/file).read_bytes()).hexdigest(),harnessRadiusMM=exported['radius']*15,trunkRadiusMM=exported['trunkRadius']*15,junction='Stepped enclosed connector')
        for obj in payload['meshes']:
            role=obj['name'] if obj['name'] in ('body','shirt','shorts') else 'hardware'
            mat=material(role,obj['material']);batches.setdefault(mat,[]).append(obj)
        for mat,objects in batches.items():
            points=[];normals=[];faces=[];uvs=[];count=0
            for obj in objects:
                world=np.asarray(obj['world']).reshape(4,4,order='F');p=np.asarray(obj['position']).reshape(-1,3);n=np.asarray(obj['normal']).reshape(-1,3)
                p=p@world[:3,:3].T+world[:3,3];n=n@np.linalg.inv(world[:3,:3]);n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
                f=np.asarray(obj['index'] if obj['index'] is not None else np.arange(len(p))).reshape(-1,3)
                if np.linalg.det(world[:3,:3])<0:f=f[:,::-1]
                points.append(p);normals.append(n);faces.append(f+count);uvs.append(np.asarray(obj['uv']).reshape(-1,2) if obj.get('uv') else p[:,:2]);count+=len(p)
            r=part(module,f'cartridge-{mat}',mat,np.concatenate(points),np.concatenate(normals),np.concatenate(faces),np.concatenate(uvs));meshes.append(r);native.append(r)
    lowdoc,low=load(ROOT/'assets/springs-runtime-v1');highdoc,high=load(ROOT/'assets/springs-native-v1')
    assert lowdoc['sourceGeometry']==highdoc['sha256']
    for i,(lo,hi) in enumerate(zip(low,high)):
        assert lo['name']==hi['name'];wet=lo['material']=='water'
        mat=material('springs-water' if wet else 'landscape',dict(color=[1,1,1],metalness=0,roughness=.025 if wet else .8,vertexColors=not wet))
        def mapped(p,n):
            if lo['name']=='Sealed mineral section' and section_taper:
                p=p.copy();r=np.linalg.norm(p[:,[0,2]],axis=1);scale=1-section_taper*np.clip((-.05-p[:,1])/.78,0,1)
                n=np.c_[p[:,0]/r,-section_taper*r/.78,p[:,2]/r];p[:,0]*=scale;p[:,2]*=scale
            p=p@interior_world[:3,:3].T+interior_world[:3,3]
            n=n@np.linalg.inv(interior_world[:3,:3]);n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
            return p,n
        lp,ln=mapped(lo['position'],lo['normal']);hp,hn=mapped(hi['position'],hi['normal'] if wet else hi['shadingNormal'])
        meshes.append(part('scenes',f'interior-{i}',mat,lp,ln,lo['index'],color=lo.get('albedo')))
        native.append(part('scenes',f'interior-{i}',mat,hp,hn,hi['index'],color=hi.get('albedo'),params=hi.get('parameters')))
    assert len(meshes)<195 and len(meshes)==len(native)
    records,stats=write_package(out,meshes);nrecords,nstats=write_package(args.build,native,True)
    stats.update(sourceTriangles=nstats['triangles'],sourceParts=len(meshes))
    doc.update(meshes=records,stats=stats,source='CYBR GEO + actual CYBR Combat mannequin + physical Springs cartridge',customMaterials=definitions,nativeGeometryHash=nstats['sha256'],productionApproved=False,lodAudit=lod_audit)
    for module in doc['modules']:
        if module['name'] not in ('combat','scenes'):continue
        points=np.concatenate([m['positions'] for m in meshes if m['module']==module['name']]);lo=points.min(0);hi=points.max(0);module.update(bounds=[lo.tolist(),hi.tolist()],bakeCenter=((lo+hi)/2).tolist(),parts=sum(m['module']==module['name'] for m in meshes))
    doc['environment']=dict(doc['environment'],file='../instrument-3d/'+doc['environment']['file'])
    shutil.copyfile(source/'machined-roughness.png',out/'machined-roughness.png')
    (out/'manifest.json').write_text(json.dumps(doc,indent=2))
    (args.build/'native-manifest.json').write_text(json.dumps(dict(meshes=nrecords,stats=nstats,runtimeGeometryHash=stats['sha256'],customMaterials=definitions),indent=2))
    route['junctions']=route_audit
    (out/'route.json').write_text(json.dumps(route,indent=2))
    print(json.dumps(dict(runtime=stats,native=nstats,sprites=0,productionApproved=False)))

if __name__=='__main__':main()
