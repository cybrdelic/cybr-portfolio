"""Pack actual CYBR radiance, extinction and depth on a shared video clock.

Use a warmed continuous burner. The overlap blends linear radiance/extinction,
with energy-weighted depth. No painted background is keyed away.
"""
from pathlib import Path
import argparse,hashlib,json,subprocess
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser()
p.add_argument('--recording',default='portfolio-fire-burner-framed')
p.add_argument('--video-name',default='fire-burner-radiance-matte-depth.mp4')
p.add_argument('--base-z',type=float,default=15.5)
p.add_argument('--radiance-gain',type=float,default=1)
p.add_argument('--scale-mm',type=float,default=2.25)
a=p.parse_args()
recording=root/'cybr-elements/work/adaptive-volume-qa'/a.recording;source=recording/'native-feedback'
out=root/'portfolio/assets/instrument-elements-bake/fire';work=root/'portfolio/output/elements-bake'/('packed-'+recording.name)
out.mkdir(parents=True,exist_ok=True);work.mkdir(parents=True,exist_ok=True)
native=json.loads((source/'report.json').read_text());assert native['pass'] and native['numericalPass']
commands=json.loads((recording/'commands.json').read_text());settings=commands['options']
angles=[0,45,90,135,180,225,270,315];indices=list(range(119,360,2))
x,y,w,h=128,0,512,432;overlap=12;max_outside=0;energies=[];clipped=0
def field(frame,angle):
    global max_outside,clipped
    raw=np.array(Image.open(source/f'frame-bake-{frame}-{angle}.png'));data,color=np.split(raw,2)
    outside=color[:,:,:3].copy();outside[y:y+h,x:x+w]=0
    outside_matte=data[:,:,0].copy();outside_matte[y:y+h,x:x+w]=0
    max_outside=max(max_outside,int(outside.max()),int(outside_matte.max()))
    clipped+=int((color[:,:,:3]==255).sum())
    return ((color[y:y+h,x:x+w,:3].astype(np.float32)/255)**2*16,
            data[y:y+h,x:x+w,0].astype(np.float32)/255,
            data[y:y+h,x:x+w,1].astype(np.float32)/255)
for n,i in enumerate(range(overlap,len(indices))):
    atlas=Image.new('RGB',(w*4,h*6));energy=0.
    for view,angle in enumerate(angles):
        rgb,matte,depth=field(indices[i],angle)
        if i>=len(indices)-overlap:
            j=i-(len(indices)-overlap);b_rgb,b_matte,b_depth=field(indices[j],angle)
            blend=j/(overlap-1);blend=blend*blend*(3-2*blend)
            wa=(rgb.sum(axis=2)+matte)*(1-blend);wb=(b_rgb.sum(axis=2)+b_matte)*blend
            depth=(depth*wa+b_depth*wb)/np.maximum(wa+wb,1e-8)
            rgb=rgb*(1-blend)+b_rgb*blend;matte=matte*(1-blend)+b_matte*blend
        col,row=view%4,view//4
        atlas.paste(Image.fromarray(np.uint8(np.sqrt(np.clip(rgb/16,0,1))*255+.5)),(col*w,row*h))
        atlas.paste(Image.fromarray(np.uint8(np.clip(matte,0,1)*255+.5)).convert('RGB'),(col*w,(row+2)*h))
        atlas.paste(Image.fromarray(np.uint8(np.clip(depth,0,1)*255+.5)).convert('RGB'),(col*w,(row+4)*h))
        energy+=float(rgb.sum())/len(angles)
    atlas.save(work/f'{n:03}.png');energies.append(energy)
assert max_outside<=2,'The crop cuts significant fire/smoke'
assert min(energies)>0,'The continuous burner contains a blank frame'
video=out/a.video_name
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','30','-i',str(work/'%03d.png'),
    '-frames:v',str(len(energies)),'-c:v','libx264','-preset','slow','-crf','10','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],check=True)
m=dict(version=2,complete=True,video=video.name,sha256=hashlib.sha256(video.read_bytes()).hexdigest(),frames=len(energies),fps=30,
    duration=len(energies)/30,angles=angles,width=w*4,height=h*6,tile=[w,h],crop=[x,y,w,h],sourceSize=[768,432],
    radianceScale=16,depthScale=24,bytes=video.stat().st_size,
    camera=dict(distance=13,targetY=2.8,height=1.1,tanHalfFov=.3443276133/1.25,aspect=16/9),placement=dict(scaleMM=a.scale_mm,baseZMM=a.base_z),radianceGain=a.radiance_gain,
    encoding='sqrt-linear RGB; linear extinction matte; weighted ray depth. Grayscale matte/depth tiles.',energyCurve=energies,
    loop=dict(type='continuous warmed burner; linear radiance/extinction overlap',overlapFrames=overlap,overlapSeconds=overlap/30,blankFrames=0),
    lineage=dict(source='CYBR Elements Fire Studio production PyroSolver / authored torch burner',recording=recording.name,
        hostFingerprint=commands['hostFingerprint'],shaderFingerprint=commands['shaderFingerprint'],actualNativeFeedback=True,numericalPass=True,
        solverGrid=settings['grid'],effect=settings['effect'],dynamics=settings['dynamics'],chemistry=settings['chemistry'],woodTimeScale=settings['woodTimeScale'],
        background=False,solidOcclusion=True,embers=False,simulationSeconds=6,retainedNativePixels=True,croppedRadianceMaximum=max_outside,
        encodedClippedChannelSamples=clipped,adapter=native['adapter']['device']),
    limitation='Eight camera samples and one weighted depth per ray approximate changing view and partial volume occlusion; this is not full live volumetric transport.')
(out/'manifest.json').write_text(json.dumps(m,indent=2))
print(json.dumps({'video':str(video),'frames':len(energies),'bytes':m['bytes'],'cropRadianceMax':max_outside,'energyRange':[min(energies),max(energies)],'clippedChannels':clipped}))
