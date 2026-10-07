"""Pack native fire radiance, extinction and depth into one synchronized video.

Each pixel is copied from the production renderer. RGB retains its sqrt-linear
encoding; matte and depth have grayscale tiles to avoid chroma subsampling them.
"""
from pathlib import Path
import hashlib, json, subprocess
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[2]
recording = root/'cybr-elements/work/adaptive-volume-qa/portfolio-composite-v3'
source = recording/'native-feedback'
out = root/'portfolio/assets/instrument-elements-bake/fire'
work = root/'portfolio/output/elements-bake/packed'
out.mkdir(parents=True,exist_ok=True); work.mkdir(parents=True,exist_ok=True)
native = json.loads((source/'report.json').read_text())
assert native['pass'] and native['numericalPass']
angles = [0,45,90,135,180,225,270,315]
indices = list(range(2,180,3))
x,y,w,h = 192,112,384,304
energies=[]; max_outside=0; edge_opacity=[]
for n,frame in enumerate(indices):
    atlas = Image.new('RGB',(w*4,h*6))
    energy=0.; edge=0
    for view,angle in enumerate(angles):
        a=np.array(Image.open(source/f'frame-bake-{frame}-{angle}.png'))
        data,color=np.split(a,2)
        outside=color[:,:,:3].copy();outside[y:y+h,x:x+w]=0
        outside_matte=data[:,:,0].copy();outside_matte[y:y+h,x:x+w]=0
        max_outside=max(max_outside,int(outside.max()),int(outside_matte.max()))
        c=color[y:y+h,x:x+w,:3];d=data[y:y+h,x:x+w]
        col,row=view%4,view//4
        atlas.paste(Image.fromarray(c),(col*w,row*h))
        atlas.paste(Image.fromarray(d[:,:,0]).convert('RGB'),(col*w,(row+2)*h))
        atlas.paste(Image.fromarray(d[:,:,1]).convert('RGB'),(col*w,(row+4)*h))
        energy += float(((c.astype(float)/255)**2*16).sum())/len(angles)
        edge=max(edge,int(d[:,:,0].max()),int(c.max()))
    atlas.save(work/f'{n:03}.png')
    energies.append(energy);edge_opacity.append(edge)
assert max_outside<=2, 'The camera crop cuts significant fire radiance'
assert edge_opacity[0]<=2 and edge_opacity[-1]<=2, 'The event does not have a clean loop boundary'
video=out/'fire-radiance-matte-depth.mp4'
command=['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','20','-i',str(work/'%03d.png'),
         '-c:v','libx264','-preset','slow','-crf','10','-pix_fmt','yuv420p','-movflags','+faststart',str(video)]
subprocess.run(command,check=True)
commands=json.loads((recording/'commands.json').read_text())
manifest=dict(version=1,complete=True,video=video.name,sha256=hashlib.sha256(video.read_bytes()).hexdigest(),
    frames=len(indices),fps=20,duration=len(indices)/20,angles=angles,width=w*4,height=h*6,
    tile=[w,h],crop=[x,y,w,h],sourceSize=[768,432],radianceScale=16,depthScale=24,
    bytes=video.stat().st_size,
    camera=dict(distance=13,targetY=2.8,height=8,tanHalfFov=.3443276133/.85,aspect=16/9),
    encoding='sqrt-linear RGB; linear extinction matte; weighted ray depth. Grayscale matte/depth tiles.',
    energyCurve=energies,loopBoundaryMaximum=edge_opacity[0::len(edge_opacity)-1],
    lineage=dict(source='CYBR Elements Fire Studio production PyroSolver / bonfire',
        hostFingerprint=commands['hostFingerprint'],shaderFingerprint=commands['shaderFingerprint'],
        actualNativeFeedback=True,numericalPass=True,solverGrid=commands['options']['grid'],
        background=False,embers=False,simulationSeconds=4,exportSeconds=len(indices)/20,
        retainedNativePixels=True,croppedRadianceMaximum=max_outside,adapter=native['adapter']['device']),
    limitation='Eight camera samples and one weighted depth per ray approximate changing view and partial volume occlusion; this is not full live volumetric transport.')
(out/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'video':str(video),'frames':len(indices),'bytes':video.stat().st_size,'cropRadianceMax':max_outside,'loopEdges':manifest['loopBoundaryMaximum']}))
