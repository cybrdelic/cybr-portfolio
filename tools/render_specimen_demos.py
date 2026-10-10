"""Make short, lightweight demos from the delivered CAD and recorded fluid.

Frames stay on disk; stdout reports paths and metadata only.
"""
from pathlib import Path
import json,gzip,math,subprocess,argparse
import numpy as np
import vtk
from vtk.util.numpy_support import numpy_to_vtk,numpy_to_vtkIdTypeArray,vtk_to_numpy
from PIL import Image

ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'portfolio/assets/specimens';WORK=ROOT/'.local/showcases'

def mesh(vertices,normals,faces,color,metal=False,opacity=1,pbr=False):
    points=vtk.vtkPoints();points.SetData(numpy_to_vtk(np.ascontiguousarray(vertices),deep=True));poly=vtk.vtkPolyData();poly.SetPoints(points)
    cells=vtk.vtkCellArray();cells.SetData(numpy_to_vtkIdTypeArray(np.arange(len(faces)+1,dtype=np.int64)*3,deep=True),numpy_to_vtkIdTypeArray(np.asarray(faces,dtype=np.int64).ravel(),deep=True));poly.SetPolys(cells)
    if normals is not None:poly.GetPointData().SetNormals(numpy_to_vtk(np.ascontiguousarray(normals),deep=True))
    mapper=vtk.vtkPolyDataMapper();mapper.SetInputData(poly);actor=vtk.vtkActor();actor.SetMapper(mapper)
    p=actor.GetProperty();p.SetColor(*color);p.SetInterpolationToPhong();p.SetAmbient(.19);p.SetDiffuse(.68);p.SetSpecular(.75 if metal else .35);p.SetSpecularPower(75);p.SetOpacity(opacity)
    if pbr:p.SetInterpolationToPBR();p.SetMetallic(1 if metal else 0);p.SetRoughness(.29)
    return actor

def array(raw,s,stride):
    v=np.frombuffer(raw,dtype={'<f4':'<f4','<i2':'<i2','<u4':'<u4'}[s['dtype']],offset=s['offset'],count=s['count']).reshape(-1,stride)
    return v.astype(float)/32767 if s['dtype']=='<i2' else v

def setup(target,extent):
    r=vtk.vtkRenderer();r.SetBackground(241/255,240/255,236/255);r.SetUseDepthPeeling(True);r.SetMaximumNumberOfPeels(100);r.SetOcclusionRatio(0)
    cam=r.GetActiveCamera();cam.SetPosition(*(np.array(target)+np.array([1.1,-1.4,.9])*extent*3));cam.SetFocalPoint(*target);cam.SetViewUp(0,0,1);cam.ParallelProjectionOn();cam.SetParallelScale(extent*.67);cam.SetClippingRange(.1,extent*20)
    for d,power in [([.4,-1,1.2],.9),([-1,-.3,.6],.45),([.4,1,.8],.65)]:
        light=vtk.vtkLight();light.SetLightTypeToSceneLight();light.PositionalOff();light.SetPosition(*(np.array(target)+np.array(d)*extent*3));light.SetFocalPoint(*target);light.SetIntensity(power);r.AddLight(light)
    window=vtk.vtkRenderWindow();window.SetOffScreenRendering(1);window.SetShowWindow(False);window.SetSize(720,540);window.SetAlphaBitPlanes(1);window.SetMultiSamples(0);window.AddRenderer(r)
    return r,window

def capture(window,path):
    window.Render();f=vtk.vtkWindowToImageFilter();f.SetInput(window);f.ReadFrontBufferOff();f.Update();pixels=vtk_to_numpy(f.GetOutput().GetPointData().GetScalars()).reshape(540,720,3)[::-1];Image.fromarray(pixels).save(path)

def transform(rotation,pivot):
    t=np.eye(4);t[:3,:3]=rotation;t[:3,3]=np.asarray(pivot)-rotation@pivot;return t

def rx(a):return np.array([[1,0,0],[0,math.cos(a),-math.sin(a)],[0,math.sin(a),math.cos(a)]])
def orbit_pose(motion,wrist,gap):
    d=(gap-33.8)/2;theta=math.radians(wrist);t=np.eye(4)
    if motion in ('jaw_plus','jaw_minus'):t[1,3]=d if motion=='jaw_plus' else -d
    elif motion=='leadscrew':
        a=-math.tau*d/3;rot=np.array([[math.cos(a),0,math.sin(a)],[0,1,0],[-math.sin(a),0,math.cos(a)]]);t=transform(rot,[60,0,70])
    if motion=='pinion':return transform(rx(-theta*72/20),[0,46,70])
    if motion!='fixed':t=transform(rx(theta),[0,0,70])@t
    return t

def encode(name,frames):
    dest=BASE/name;dest.mkdir(parents=True,exist_ok=True)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate','24','-i',str(frames/'%04d.png'),'-c:v','libx264','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(dest/'demo.mp4')],check=True)
    Image.open(frames/'0000.png').save(dest/'poster.webp',quality=88)
    print(json.dumps({'model':name,'film':str(dest/'demo.mp4'),'bytes':(dest/'demo.mp4').stat().st_size,'frames':len(list(frames.glob('*.png'))),'size':[720,540]}),flush=True)

def render(name,preview=False):
    m=json.loads((BASE/name/'manifest.json').read_text(encoding='utf-8'));raw=gzip.decompress((BASE/name/'geometry.bin.gz').read_bytes());frames=WORK/(name+'-frames');frames.mkdir(parents=True,exist_ok=True)
    r,window=setup([35,0,70] if name=='geo' else [0,0,3],175 if name=='geo' else 80);actors=[]
    for p in m['parts']:
        material=m['materials'][p['material']] if p['material']<len(m['materials']) else dict(color=[.6,.02,.08],metalness=0)
        opacity=.18 if p['material']==3 else 1
        actor=mesh(array(raw,p['positions'],3),array(raw,p['normals'],3),array(raw,p['indices'],3),material['color'],material.get('metalness',0)>.5,opacity,pbr=False);r.AddActor(actor);actors.append(actor)
    fluid=None
    if name=='elements':
        fluidbase=ROOT/'portfolio/assets/instrument-elements-bake/water-shared-v3';fluid=json.loads((fluidbase/'manifest.json').read_text(encoding='utf-8'))
    count=1 if preview else 192 if name=='geo' else 168
    for i in range(count):
        if name=='geo':
            phase=i/count*math.tau;wrist=18*math.sin(phase);gap=27.8+6*math.cos(phase)
            for p,actor in zip(m['parts'],actors):
                t=orbit_pose(p['motion'],wrist,gap);matrix=vtk.vtkMatrix4x4()
                for a in range(4):
                    for b in range(4):matrix.SetElement(a,b,t[a,b])
                actor.SetUserMatrix(matrix)
        else:
            if i: r.RemoveActor(water)
            index=round((.5-.5*math.cos(i/count*math.tau))*(len(fluid['frames'])-1));f=fluid['frames'][index];data=gzip.decompress((fluidbase/f['file']).read_bytes());n=f['count'];v=np.frombuffer(data,dtype='<i2',count=n*3).reshape(-1,3).astype(float)/fluid['positionScale'];norm=np.frombuffer(data,dtype='<i2',offset=n*6,count=n*3).reshape(-1,3).astype(float)/32767
            water=mesh(v,norm,np.arange(n).reshape(-1,3),[.2,.63,.68],False,.84);r.AddActor(water)
        capture(window,frames/f'{i:04d}.png')
    window.Finalize()
    if preview:Image.open(frames/'0000.png').save(BASE/name/'poster.webp',quality=88)
    else:encode(name,frames)

def render_light():
    subprocess.run(['node','--input-type=module','-e',"import {prismPath} from './portfolio/specimen-optics.mjs';import fs from 'node:fs';fs.writeFileSync('.local/showcases/optics-frames.json',JSON.stringify(Array.from({length:144},(_,i)=>({rotation:5*Math.sin(i/144*Math.PI*2),paths:Array.from({length:9},(_,j)=>prismPath(430+j*33.75,{incidence:60,rotation:5*Math.sin(i/144*Math.PI*2)}))}))));"],cwd=ROOT,check=True)
    values=json.loads((WORK/'optics-frames.json').read_text());frames=WORK/'light-frames';frames.mkdir(parents=True,exist_ok=True);r,window=setup([30,0,83],150);r.GetActiveCamera().SetPosition(-465,-630,488)
    vv=np.array([(x*50,y*50,z*50+90) for y in [-1,1] for x,z in [(-.65,-.6),(.8,0),(-.65,.6)]]);ff=np.array([[0,1,2],[3,5,4],[0,3,4],[0,4,1],[1,4,5],[1,5,2],[2,5,3],[2,3,0]])
    prism=mesh(vv,None,ff,[.63,.83,.88],False,.38);r.AddActor(prism)
    for y in [-58,58]:
        q=vtk.vtkCylinderSource();q.SetRadius(2.5);q.SetHeight(90);q.SetResolution(24);mapper=vtk.vtkPolyDataMapper();mapper.SetInputConnection(q.GetOutputPort());a=vtk.vtkActor();a.SetMapper(mapper);a.RotateX(90);a.SetPosition(0,y,45);a.GetProperty().SetColor(.13,.15,.16);r.AddActor(a)
        q=vtk.vtkCylinderSource();q.SetRadius(3);q.SetHeight(14);q.SetResolution(24);mapper=vtk.vtkPolyDataMapper();mapper.SetInputConnection(q.GetOutputPort());a=vtk.vtkActor();a.SetMapper(mapper);a.SetPosition(0,math.copysign(56,y),90);a.GetProperty().SetColor(.13,.15,.16);r.AddActor(a)
    box=vtk.vtkCubeSource();box.SetXLength(2);box.SetYLength(64);box.SetZLength(136);box.SetCenter(121,0,110);mapper=vtk.vtkPolyDataMapper();mapper.SetInputConnection(box.GetOutputPort());detector=vtk.vtkActor();detector.SetMapper(mapper);detector.GetProperty().SetColor(.93,.93,.89);r.AddActor(detector)
    palette=['#8139e6','#455ce9','#168ed0','#22b89f','#79b732','#d8b920','#ed8d25','#e45c30','#d6333b'];beams=[]
    for i,v in enumerate(values):
        for b in beams:r.RemoveActor(b)
        beams=[];t=vtk.vtkTransform();t.Translate(0,0,90);t.RotateY(-v['rotation']);t.Translate(0,0,-90);prism.SetUserTransform(t)
        for j,path in enumerate(v['paths']):
            points=[(p[0]*50,0,p[1]*50+90) for p in path['points']]
            for k in range(0 if j==0 else 1,len(points)-1):
                line=vtk.vtkLineSource();line.SetPoint1(*points[k]);line.SetPoint2(*points[k+1]);tube=vtk.vtkTubeFilter();tube.SetInputConnection(line.GetOutputPort());tube.SetRadius(.55 if k==0 else .36);tube.SetNumberOfSides(8);mapper=vtk.vtkPolyDataMapper();mapper.SetInputConnection(tube.GetOutputPort());a=vtk.vtkActor();a.SetMapper(mapper);color=palette[j] if k else '#eeeeff';a.GetProperty().SetColor(*[int(color[n:n+2],16)/255 for n in [1,3,5]]);a.GetProperty().SetAmbient(1);a.GetProperty().SetDiffuse(0);r.AddActor(a);beams.append(a)
        capture(window,frames/f'{i:04d}.png')
    window.Finalize();encode('light',frames)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--model',choices=['geo','light','elements','all'],default='all');p.add_argument('--preview',action='store_true');a=p.parse_args()
    if a.model in ('geo','all'):render('geo',a.preview)
    if a.model in ('elements','all'):render('elements',a.preview)
    if a.model in ('light','all'):render_light()
