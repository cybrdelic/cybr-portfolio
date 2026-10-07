"""Authored linear-HDR product studio; no downloaded/generated image assets."""
from pathlib import Path
import numpy as np

def write_studio(path:Path, graded=False):
    width,height=1024,512
    u=(np.arange(width)+.5)/width*2*np.pi
    v=(np.arange(height)+.5)/height*np.pi
    directions=np.stack(np.broadcast_arrays(np.sin(v[:,None])*np.cos(u[None,:]),np.cos(v[:,None])+np.zeros((1,width)),np.sin(v[:,None])*np.sin(u[None,:])),axis=-1)
    # Cybr Light's lat-long Y pole is independent of this scene's Z-up camera.
    intensity=np.full((height,width),.055 if graded else .16)
    intensity+=(.075 if graded else .12)*np.clip(-directions[:,:,2],0,1)
    def softbox(direction,horizontal,vertical,strength,feather=.025):
        nonlocal intensity
        n=np.asarray(direction,float);n/=np.linalg.norm(n)
        right=np.cross(n,[0,0,1]);right/=np.linalg.norm(right)
        up=np.cross(right,n)
        forward=directions@n
        xx=np.abs(directions@right)/np.maximum(forward,.001)
        yy=np.abs(directions@up)/np.maximum(forward,.001)
        def edge(value,extent):
            t=np.clip((extent-value)/feather,0,1)
            return t*t*(3-2*t) if graded else t
        intensity+=strength*edge(xx,horizontal)*edge(yy,vertical)*(forward>0)
    if graded:
        # Broad diffusion gradients describe curvature; one narrow strip
        # retains a sharp edge reflection. Dark gaps act as negative fill.
        softbox([.4,-1,1.2],1.35,.65,3.2,.48)
        softbox([1,1,-.3],.6,1.4,1.8,.45)
        softbox([-1,.5,.8],.42,1.2,2.1,.3)
        softbox([1,-.2,.8],.075,1.1,3.0,.035)
    else:
        softbox([1,1,-.3],.32,1.3,2)
        softbox([.4,-1,1.2],1.1,.26,3)
        softbox([-1,.5,.8],.18,1.1,2)
        softbox([1,-.2,.8],.055,1.1,4)
    rgb=np.repeat(intensity[:,:,None],3,axis=2).astype('<f4')
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('wb') as f:
        f.write(f'PF\n{width} {height}\n-1.0\n'.encode())
        f.write(rgb[::-1].tobytes())
    return path
