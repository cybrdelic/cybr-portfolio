"""Exact browser/native camera agreement, including hybrid projections."""
from pathlib import Path
import json,sys
import numpy as np
from bake_light_path import camera_from_state,SCALE

path=json.loads(Path(sys.argv[1]).read_text());worst=0
for state in path['frames']:
    p=np.array(state['projection']).reshape(4,4,order='F')
    w=np.array(state['world']).reshape(4,4,order='F')
    c=camera_from_state(state);forward=np.array(c.target)-c.origin;forward/=np.linalg.norm(forward)
    right=np.cross(forward,c.up);right/=np.linalg.norm(right);up=np.cross(right,forward)
    for x,y in ((.1,.1),(.5,.5),(.9,.9),(.1,.9)):
        q=w@np.linalg.inv(p)@np.array([2*x-1,1-2*y,-1,1]);q=q[:3]/q[3]
        px,py=(2*x-1)*path['aspect'],1-2*y
        if c.orthographic:
            origin=np.array(c.origin)*SCALE+(right*px+up*py)*c.ortho_scale*SCALE*.5
            residual=q-origin;error=np.linalg.norm(residual-forward*np.dot(residual,forward))
        else:
            ray=forward+(right*px+up*py)*np.tan(np.radians(c.fov)/2);ray/=np.linalg.norm(ray)
            expected=q-np.array(c.origin)*SCALE;expected/=np.linalg.norm(expected)
            error=np.linalg.norm(ray-expected)
        worst=max(worst,error)
        assert error<1e-7,(state['progress'],error)
print(json.dumps({'views':len(path['frames']),'rays':len(path['frames'])*4,'maximumError':worst,'cameraAgreement':True}))
