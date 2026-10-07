"""Carry original unlit material samples onto the current fused cartridge.

Keeps the published workshop package untouched. Native water uses the original
closed volume, not the browser's single-interface optical approximation.
"""
from pathlib import Path
import gzip,json,hashlib,gc
import numpy as np
from scipy.spatial import cKDTree
from scipy.ndimage import map_coordinates
from stitch_springs_cartridge import raster,normals
ROOT=Path(__file__).resolve().parents[1]

def load(folder):
    doc=json.loads((folder/'manifest.json').read_text());raw=gzip.decompress((folder/'geometry.bin.gz').read_bytes());meshes=[]
    for r in doc['meshes']:
        m={k:v for k,v in r.items() if not isinstance(v,dict)}
        for k,s in r.items():
            if isinstance(s,dict) and 'offset' in s:m[k]=np.frombuffer(raw,dtype='<u4' if k=='index' else '<f4',offset=s['offset'],count=s['count']).reshape(-1,s['size']).copy()
        meshes.append(m)
    return doc,meshes

def main():
    _,original=load(ROOT/'assets/springs-cartridge-v2');doc,current=load(ROOT/'assets/springs-cartridge-v3')
    source=ROOT/'output/optix-springs-dev/source-materials.bin'
    with source.open('rb') as f:count=int(np.fromfile(f,'<u4',1)[0]);params=np.fromfile(f,'<f4').reshape(-1,8)
    assert len(params)==count and np.isfinite(params).all();cursor=0
    for m in original:
        if m['material']!='baked':continue
        n=len(m['position']);a=params[cursor:cursor+n];assert len(a)==n;cursor+=n
        m['albedo']=a[:,:3].copy();m['parameters']=np.c_[a[:,6],a[:,7],np.zeros(n,dtype='<f4')];m['ior']=float(np.median(a[:,7]))
        m['shadingNormal']=a[:,[3,5,4]].copy();m['shadingNormal'][:,2]*=-1
        m['normalDelta']=m['shadingNormal']-m['normal'];m.pop('color',None)
    assert cursor==count
    by_name={m['name']:m for m in original}
    ground=by_name['Continuous_irregular_spring_shelf'];ridge=by_name['Continuous_eroded_ridge_backbone']
    target=current[0];assert target['name']=='Continuous fused terrain and ridge'
    size=901;radius=2.265;x,z=np.meshgrid(np.linspace(-radius,radius,size),np.linspace(-radius,radius,size))
    gh,_=raster(ground['position'],ground['albedo'],ground['index'].reshape(-1,3),size,radius)
    mh,_=raster(ridge['position'],ridge['albedo'],ridge['index'].reshape(-1,3),size,radius)
    start=-.95+.10*np.sin(x*3)+.06*np.sin(x*7);w=np.clip((start-z)/.48,0,1);w=w*w*(3-2*w)
    relief=np.maximum(0,mh-gh)*w;blend=np.clip(relief/.13,0,1);blend=blend*blend*(3-2*blend)
    coords=((target['position'][:,[2,0]]+radius)*(size-1)/(2*radius)).T
    for key in ('albedo','parameters','normalDelta'):
        _,g=raster(ground['position'],ground[key],ground['index'].reshape(-1,3),size,radius)
        _,r=raster(ridge['position'],ridge[key],ridge['index'].reshape(-1,3),size,radius)
        field=g*(1-blend[:,:,None])+r*blend[:,:,None]
        target[key]=np.stack([map_coordinates(field[:,:,c],coords,order=1,mode='nearest') for c in range(3)],axis=1).astype('<f4')
    target['shadingNormal']=target['normal']+target.pop('normalDelta');target['shadingNormal']/=np.maximum(np.linalg.norm(target['shadingNormal'],axis=1,keepdims=True),1e-12)
    target['ior']=1.5;target.pop('color',None)
    result=[target]
    for m in current[1:]:
        if m['material']=='water':
            water=next(o for o in original if o['material']=='water');result.append(water);continue
        if m['name'] in by_name:
            old=by_name[m['name']];assert np.array_equal(m['position'],old['position'])
            for key in ('albedo','parameters','shadingNormal','ior'):m[key]=old[key]
        elif m['name']=='Sealed mineral section':
            bottom=np.isclose(m['position'][:,1],-.07,atol=1e-6)
            m['position'][bottom,1]=-.83
            m['normal']=normals(m['position'],m['index'].reshape(-1,3))
            m['normal'][:,1]=0
            radial=m['position'][:,[0,2]];radial/=np.linalg.norm(radial,axis=1,keepdims=True)
            m['normal'][:,0]=radial[:,0];m['normal'][:,2]=radial[:,1]
            # Physical exposed-section albedo from the nearest terrain edge;
            # no darkening by previously baked illumination.
            ids=cKDTree(target['position'][:,[0,2]]).query(m['position'][:,[0,2]])[1]
            m['albedo']=target['albedo'][ids].copy();m['parameters']=np.tile([.85,1.5,0],(len(m['position']),1));m['shadingNormal']=m['normal'].copy();m['ior']=1.5
        else:raise RuntimeError('No physical source correspondence: '+m['name'])
        m.pop('color',None);result.append(m)
    del original,by_name,ground,ridge,params,a,old,g,r,field,gh,mh,x,z,w,relief,blend,coords
    gc.collect()
    out=ROOT/'assets/springs-native-v1';out.mkdir(exist_ok=True)
    records=[];offset=0;digest=hashlib.sha256()
    # Stream arrays instead of retaining byte copies and joining the full scene.
    packed=gzip.GzipFile(filename=str(out/'geometry.bin.gz'),mode='wb',compresslevel=6,mtime=0)
    for m in result:
        rec={k:v for k,v in m.items() if not isinstance(v,np.ndarray)}
        if rec['material']!='water':rec['material']='landscape'
        for key,value in m.items():
            if not isinstance(value,np.ndarray) or key=='normalDelta':continue
            value=np.ascontiguousarray(value,dtype='<u4' if key=='index' else '<f4');assert np.isfinite(value).all()
            rec[key]=dict(offset=offset,count=value.size,size=value.shape[1] if value.ndim>1 else 1)
            data=memoryview(value).cast('B')
            for start in range(0,len(data),64*1024):
                chunk=data[start:start+64*1024];digest.update(chunk);packed.write(chunk)
            offset+=value.nbytes
        records.append(rec)
    packed.close()
    doc.update(meshes=records,decodedBytes=offset,sha256=digest.hexdigest(),triangles=sum(m['index'].size//3 for m in result),bake='Unlit physical source material parameters; NOT baked radiance.',sourceParametersSHA256=hashlib.sha256(source.read_bytes()).hexdigest(),closedWater=True,productionApproved=False)
    (out/'manifest.json').write_text(json.dumps(doc,indent=2))
    print(json.dumps({k:doc[k] for k in ('triangles','decodedBytes','sha256','closedWater','productionApproved')}))

if __name__=='__main__':main()
