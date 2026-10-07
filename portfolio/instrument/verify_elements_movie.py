"""Decode representative delivered VP9 alpha frames and inspect compositing."""
from pathlib import Path
import json,subprocess
import numpy as np
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[2]
base=root/'portfolio/assets/instrument-elements-bake/composite-v3'
work=root/'portfolio/output/elements-bake/movie-review';work.mkdir(parents=True,exist_ok=True)
m=json.loads((base/'manifest.json').read_text());frames=[0,54,108,162,217]
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-c:v','libvpx-vp9','-i',str(base/m['displayVideo']),'-vf','select='+ '+'.join(f'eq(n\\,{i})' for i in frames),'-vsync','0','-pix_fmt','rgba',str(work/'decoded-%02d.png')],check=True)
sheet=Image.new('RGB',(900,1600));draw=ImageDraw.Draw(sheet);proof=[]
for row,frame in enumerate(frames):
 rgba=np.array(Image.open(work/f'decoded-{row+1:02}.png').convert('RGBA'))/255
 C,A=rgba[:,:,:3],rgba[:,:,3:4];h,w,_=C.shape
 assert np.all(A[0]==0) and np.all(A[-1]==0) and np.all(A[:,0]==0) and np.all(A[:,-1]==0),'Effect touches the film edge'
 assert A.max()>.1 and A.min()==0,'Alpha failed to decode'
 y,x=np.mgrid[:h,:w]
 for col,bg in enumerate([np.array([244,244,242])/255,np.array([.035,.04,.05]),np.where(((x//24+y//24)%2==0)[:,:,None],.7,.3)]):
  sheet.paste(Image.fromarray(np.uint8(np.clip(C*A+bg*(1-A),0,1)*255+.5)).resize((300,300)),(col*300,row*320+20))
 draw.text((8,row*320+3),f'Decoded transparent film / {frame/30:.2f}s / paper, dark, checker',fill='white')
 proof.append({'frame':frame,'alphaRange':[float(A.min()),float(A.max())],'edgeAlpha':0})
sheet.save(work/'decoded-review.png')
report={'pass':True,'frames':m['frames'],'duration':m['duration'],'actualDecodedRGBA':True,'samples':proof,'contactSheet':str(work/'decoded-review.png')}
(work/'proof.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
