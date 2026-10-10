from pathlib import Path
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from cybrlight import Scene

def build():
    s=Scene('11_prism_photon_detector')
    glass=s.material(name='Cauchy dispersive prism',type='glass',ior_a=1.49,ior_b=.014)
    cross_section=[(-.65,-.6),(.8,0),(-.65,.6)]
    vertices=[]
    for y in (-1.,1.):
        vertices.extend([(x,y,z) for x,z in cross_section])
    center=np.mean(vertices,axis=0)
    faces=[[0,1,2],[3,5,4],[0,3,4],[0,4,1],[1,4,5],[1,5,2],[2,5,3],[2,3,0]]
    # Repair winding from the convex prism's known interior point.
    for i,f in enumerate(faces):
        p=np.array(vertices)[f]
        if np.dot(np.cross(p[1]-p[0],p[2]-p[0]),p.mean(0)-center)<0:faces[i]=f[::-1]
    s.mesh(vertices,faces,glass)
    s.notes=['Forward spectral photon transport through a closed triangular prism onto a planar detector.',
             'Ideal collimated source and illustrative Cauchy dispersion; not a certified commercial glass.']
    return s

if __name__=='__main__':
    root=Path(__file__).resolve().parents[1]
    print(build().save(root/'examples'/'11_prism_photon_detector.cys'))
