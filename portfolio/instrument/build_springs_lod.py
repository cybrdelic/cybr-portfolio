"""Experimental real-mesh runtime LOD, separate from high-detail native input.

Preserves per-mesh identity; no cards, sprites or image planes. Surface errors
are sampled conservatively against source vertices and recorded for review.
"""
from pathlib import Path
import gzip,hashlib,json
import numpy as np
from scipy.spatial import cKDTree
import fast_simplification
from build_springs_physical import load
ROOT=Path(__file__).resolve().parents[1]

def main():
    doc,meshes=load(ROOT/'assets/springs-native-v1')
    budgets=[65000,12000,12000,9000,8000,8000,10000,22000,80000,6076]
    audit=[];out=ROOT/'assets/springs-runtime-v1';out.mkdir(exist_ok=True)
    for mesh,budget in zip(meshes,budgets):
        v=mesh['position'];f=mesh['index'].reshape(-1,3);before=len(f)
        if before>budget:
            points,faces=fast_simplification.simplify(v,f,target_count=budget,agg=5)
            distances,nearest=cKDTree(v).query(points)
            # Nearest SOURCE vertex is an upper bound on point-to-source-surface
            # distance. This is not a complete bidirectional Hausdorff proof.
            if distances.max()>.05:
                points,faces=fast_simplification.simplify(v,f,target_count=min(before-1,budget*2),agg=3)
                distances,nearest=cKDTree(v).query(points)
            if distances.max()>.05:
                points=v;faces=f;nearest=np.arange(len(v));distances=np.zeros(len(v))
            for key,value in list(mesh.items()):
                if isinstance(value,np.ndarray) and key not in ('position','index'):mesh[key]=value[nearest].copy()
            mesh['position']=np.asarray(points,dtype='<f4');mesh['index']=np.asarray(faces,dtype='<u4')
        else:distances=np.zeros(len(v))
        audit.append(dict(name=mesh['name'],sourceTriangles=before,runtimeTriangles=mesh['index'].size//3,maxSourceVertexDistance=float(distances.max()),p95SourceVertexDistance=float(np.quantile(distances,.95))))
    records=[];offset=0;digest=hashlib.sha256()
    with gzip.GzipFile(filename=str(out/'geometry.bin.gz'),mode='wb',compresslevel=6,mtime=0) as dest:
        for m in meshes:
            record={k:v for k,v in m.items() if not isinstance(v,np.ndarray)}
            for key,value in m.items():
                if not isinstance(value,np.ndarray):continue
                # Physical parameters stay in the high-detail native package.
                if key in ('parameters','shadingNormal'):continue
                value=np.ascontiguousarray(value,dtype='<u4' if key=='index' else '<f4')
                record[key]=dict(offset=offset,count=value.size,size=value.shape[1] if value.ndim>1 else 1)
                data=memoryview(value).cast('B');digest.update(data);dest.write(data);offset+=value.nbytes
            records.append(record)
    result=dict(version=1,meshes=records,decodedBytes=offset,sha256=digest.hexdigest(),sourceGeometry=doc['sha256'],triangles=sum(m['index'].size//3 for m in meshes),sprites=0,productionApproved=False,audit=audit)
    (out/'manifest.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:result[k] for k in ('triangles','decodedBytes','sha256','sprites','productionApproved')}))

if __name__=='__main__':main()
