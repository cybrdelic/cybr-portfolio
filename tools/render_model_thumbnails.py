"""Render small transparent rail icons from the exact delivered mesh package."""
from pathlib import Path
import gzip,json,argparse
import numpy as np
import vtk
from vtk.util.numpy_support import numpy_to_vtk,numpy_to_vtkIdTypeArray,vtk_to_numpy
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'portfolio/assets/instrument-working-v1'
COLORS=[(.74,.76,.78),(.56,.59,.62),(.025,.03,.035),(.78,.9,.9),(.55,.006,.02),(.65,.5,.26),(.008,.01,.012),(.5,.76,.79)]

def render(module,manifest,raw):
    renderer=vtk.vtkRenderer();renderer.SetBackground(.957,.957,.949);renderer.SetBackgroundAlpha(0)
    renderer.SetUseDepthPeeling(True);renderer.SetMaximumNumberOfPeels(100)
    renderer.SetOcclusionRatio(0)
    all_points=[]
    def array(record,key,stride):
        s=record[key];v=np.frombuffer(raw,dtype={'float32':'<f4','int16':'<i2','uint32':'<u4'}[s['dtype']],offset=s['offset'],count=s['count']).reshape(-1,stride)
        return v.astype(float)/32767 if key=='normals' else v
    for record in manifest['meshes']:
        if record['module']!=module:continue
        vertices=array(record,'positions',3);faces=array(record,'indices',3).astype(np.int64);normals=array(record,'normals',3)
        points=vtk.vtkPoints();points.SetData(numpy_to_vtk(np.ascontiguousarray(vertices),deep=True));poly=vtk.vtkPolyData();poly.SetPoints(points)
        cells=vtk.vtkCellArray();cells.SetData(numpy_to_vtkIdTypeArray(np.arange(len(faces)+1,dtype=np.int64)*3,deep=True),numpy_to_vtkIdTypeArray(faces.ravel(),deep=True));poly.SetPolys(cells)
        poly.GetPointData().SetNormals(numpy_to_vtk(np.ascontiguousarray(normals),deep=True));mapper=vtk.vtkPolyDataMapper();mapper.SetInputData(poly)
        actor=vtk.vtkActor();actor.SetMapper(mapper);p=actor.GetProperty();mat=record['material'];p.SetColor(*COLORS[mat]);p.SetInterpolationToPhong();p.SetAmbient(.17);p.SetDiffuse(.65);p.SetSpecular(.65 if mat in (0,1) else .18);p.SetSpecularPower(65)
        p.SetOpacity(.28 if mat==3 else .65 if mat==7 else 1);renderer.AddActor(actor);all_points.append(vertices)
    vv=np.concatenate(all_points);center=(vv.min(0)+vv.max(0))/2;extent=np.max(np.ptp(vv,axis=0));direction=np.array([.8,-1.2,.75]);direction/=np.linalg.norm(direction)
    camera=renderer.GetActiveCamera();camera.SetPosition(*(center+direction*extent*3));camera.SetFocalPoint(*center);camera.SetViewUp(0,0,1);camera.ParallelProjectionOn();renderer.ResetCamera();camera.SetParallelScale(extent*.66)
    for direction,power in [([.4,-1,1.2],.85),([-1,-.3,.6],.45),([.4,1,.8],.65)]:
        light=vtk.vtkLight();light.SetLightTypeToSceneLight();light.PositionalOff();light.SetPosition(*(center+np.array(direction)*extent*3));light.SetFocalPoint(*center);light.SetIntensity(power);renderer.AddLight(light)
    window=vtk.vtkRenderWindow();window.SetOffScreenRendering(1);window.SetShowWindow(False);window.SetSize(320,320);window.SetAlphaBitPlanes(1);window.SetMultiSamples(0);window.AddRenderer(renderer);window.Render()
    capture=vtk.vtkWindowToImageFilter();capture.SetInput(window);capture.SetInputBufferTypeToRGBA();capture.ReadFrontBufferOff();capture.Update();pixels=vtk_to_numpy(capture.GetOutput().GetPointData().GetScalars()).reshape(320,320,4)[::-1]
    im=Image.fromarray(pixels);im.save(BASE/f'thumb-{module}.webp',lossless=True);window.Finalize();return im

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--sheet',type=Path,required=True);a=p.parse_args();m=json.loads((BASE/'manifest.json').read_text());raw=gzip.decompress((BASE/'instrument.bin.gz').read_bytes())
    sheet=Image.new('RGB',(960,320),(244,244,242))
    for i,n in enumerate(('geo','light','elements')):
        im=render(n,m,raw);sheet.paste(im,(320*i,0),im);print(json.dumps({'module':n,'path':str(BASE/f'thumb-{n}.webp'),'size':[320,320]}))
    a.sheet.parent.mkdir(parents=True,exist_ok=True);sheet.save(a.sheet,quality=90)
