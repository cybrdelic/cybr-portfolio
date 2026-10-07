"""Surface-tested CAD simplification for the staged real-mesh viewer only."""
import numpy as np
from scipy.spatial import cKDTree
import fast_simplification
from trimesh.triangles import closest_point,points_to_barycentric

def project(points,vertices,faces,attributes=False):
    triangles=vertices[faces];tree=cKDTree(triangles.mean(1));distances=[];indices=[];weights=[]
    k=min(16,len(faces))
    for start in range(0,len(points),1024):
        p=points[start:start+1024];near=tree.query(p,k=k)[1].reshape(-1,k)
        candidate=closest_point(triangles[near].reshape(-1,3,3),np.repeat(p,k,axis=0)).reshape(-1,k,3)
        error=np.linalg.norm(candidate-p[:,None,:],axis=2);best=np.argmin(error,axis=1);row=np.arange(len(p));ids=near[row,best]
        distances.append(error[row,best])
        if attributes:
            indices.append(ids);weights.append(points_to_barycentric(triangles[ids],candidate[row,best]))
    if attributes:return np.concatenate(distances),np.concatenate(indices),np.concatenate(weights)
    return np.concatenate(distances)

def simplify_mesh(mesh,tolerance=.12):
    v=mesh['positions'];f=mesh['indices'].reshape(-1,3);count=len(f)
    if count<10000:return mesh,dict(source=count,runtime=count,retained=True)
    samples=v[np.unique(np.r_[np.linspace(0,len(v)-1,min(12000,len(v))).astype(int),v.argmin(0),v.argmax(0)])]
    trials=[]
    for fraction in (.35,.65):
        p,faces=fast_simplification.simplify(v,f,target_count=int(count*fraction),agg=5)
        backward=project(samples,p,faces);forward,ids,bary=project(p,v,f,True)
        error=max(float(forward.max()),float(backward.max()))
        trials.append(dict(fraction=fraction,maxForwardMM=float(forward.max()),maxBackwardMM=float(backward.max())))
        if error>tolerance:continue
        result={k:value for k,value in mesh.items() if not isinstance(value,np.ndarray)}
        for key,value in mesh.items():
            if not isinstance(value,np.ndarray) or key in ('positions','indices'):continue
            result[key]=np.einsum('ni,nij->nj',bary,value[f[ids]]).astype('<f4')
        result['normals']/=np.maximum(np.linalg.norm(result['normals'],axis=1,keepdims=True),1e-12)
        result['positions']=p.astype('<f4');result['indices']=faces.astype('<u4').reshape(-1,1)
        return result,dict(source=count,runtime=len(faces),sampledSurfaceErrorMM=error,samples=len(samples),toleranceMM=tolerance)
    return mesh,dict(source=count,runtime=count,retained=True,reason='Surface-error gate rejected simplification',trials=trials)
