"""Native GLES composite film: linear radiance and RGB transmittance, no backdrop.

Actual cached FLIP surfaces and retained CAD glass/cable geometry. The fire
fragment and its pose are exported from the production portfolio module.
The native optical preview uses paired raster exit depths, Snell/Fresnel and
Beer attenuation; it is not a full multiple-interface path tracer.
"""
from pathlib import Path
import argparse,gzip,json,math,re,subprocess,hashlib
import numpy as np
from PIL import Image
import glfw
from OpenGL import GL as G

ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--water',type=Path,required=True);p.add_argument('--frames',type=int,default=218);p.add_argument('--size',type=int,default=512);p.add_argument('--include-cad',action='store_true');p.add_argument('--out',type=Path,default=ROOT/'portfolio/assets/instrument-elements-bake/composite-v3');a=p.parse_args()
work=ROOT/'portfolio/output/elements-bake/joint-native';out=a.out.resolve();a.water=a.water.resolve();out.mkdir(parents=True,exist_ok=True)
pose=json.loads((work/'pose.json').read_text());water=json.loads((a.water/'manifest.json').read_text());assert water['complete']
fireMetadata=json.loads((ROOT/'portfolio/assets/instrument-elements-bake/fire/manifest.json').read_text())
fireRecording=fireMetadata['lineage']['recording']
def display(v):
 v=v/.6@np.array([[.59719,.35458,.04823],[.076,.90834,.01566],[.0284,.13383,.83777]]).T
 v=(v*(v+.0245786)-.000090537)/(v*(.983729*v+.432951)+.238081)
 v=np.clip(v@np.array([[1.60475,-.53108,-.07367],[-.10208,1.10813,-.00605],[-.00327,-.07276,1.07602]]).T,0,1)
 return np.where(v<=.0031308,v*12.92,1.055*v**.41666-.055)
W=a.size;H=W
assert glfw.init();glfw.window_hint(glfw.VISIBLE,glfw.FALSE);glfw.window_hint(glfw.CLIENT_API,glfw.OPENGL_ES_API);glfw.window_hint(glfw.CONTEXT_VERSION_MAJOR,3);glfw.window_hint(glfw.CONTEXT_VERSION_MINOR,0)
window=glfw.create_window(W,H,'CYBR composite bake',None,None);assert window;glfw.make_context_current(window)

def shader(kind,source):
    s=G.glCreateShader(kind);G.glShaderSource(s,source);G.glCompileShader(s)
    if not G.glGetShaderiv(s,G.GL_COMPILE_STATUS):raise RuntimeError(G.glGetShaderInfoLog(s).decode()[:1500])
    return s
def program(v,f):
    level='roughness*5.' if 'uniform float metallic,roughness' in f else '.5'
    f=re.sub(r'vec3 environment\(vec3 r\)\{[^}]+\}',
      'vec3 environment(vec3 r){vec2 p=vec2(atan(r.z,r.x)/6.283185+.5,asin(clamp(r.y,-1.,1.))/3.141593+.5);return textureLod(studio,p,'+level+').rgb;}',f)
    if 'textureLod(studio' in f:f=f.replace('precision highp sampler2D;','precision highp sampler2D;uniform sampler2D studio;')
    f=f.replace('vec4 incoming=texture(source,refracted);',
      'if(sourceDepth>399.)refracted=uv;float candidateZ=texture(depth,refracted).r*2.-1.;float candidateDepth=1600./(402.-candidateZ*398.);if(candidateDepth<b.w-.05)refracted=uv;vec4 incoming=texture(source,refracted);')
    q=G.glCreateProgram();G.glAttachShader(q,shader(G.GL_VERTEX_SHADER,v));G.glAttachShader(q,shader(G.GL_FRAGMENT_SHADER,f));G.glLinkProgram(q)
    if not G.glGetProgramiv(q,G.GL_LINK_STATUS):raise RuntimeError(G.glGetProgramInfoLog(q).decode()[:1500])
    return q
head='#version 300 es\nprecision highp float;precision highp sampler2D;\n'
vertex=head+'''layout(location=0) in vec3 position;layout(location=1) in vec3 normal;
uniform mat4 vp;uniform mat4 model;out vec3 world;out vec3 norm;out vec2 fireUV;
void main(){world=(model*vec4(position,1)).xyz;norm=normal;fireUV=vec2(float(gl_VertexID==1||gl_VertexID==2),float(gl_VertexID>=2));gl_Position=vp*vec4(world,1);}'''
field=program(vertex,head+'''in vec3 world;in vec3 norm;uniform vec3 eye,forward;out vec4 color;
void main(){color=vec4(normalize(norm),dot(world-eye,forward));}''')
opaque=program(vertex,head+'''in vec3 world;in vec3 norm;uniform vec3 eye,base;uniform float metallic,roughness;out vec4 color;
vec3 environment(vec3 r){float strips=pow(max(0.,dot(r,normalize(vec3(-.4,-.3,1)))),28.)*2.4+pow(max(0.,dot(r,normalize(vec3(.6,.3,.5)))),40.)*1.2;return vec3(.04+strips);}
void main(){vec3 n=normalize(norm),v=normalize(eye-world);float nv=max(dot(n,v),0.);vec3 f0=mix(vec3(.04),base,metallic);vec3 f=f0+(1.-f0)*pow(1.-nv,5.);vec3 c=environment(reflect(-v,n))*f+base*(1.-metallic)*(.1+.28*max(n.z,0.));
vec3 l=normalize(vec3(-.5,-.3,1)),h=normalize(v+l);float nl=max(dot(n,l),0.),nh=max(dot(n,h),0.),a2=pow(roughness,4.);float D=a2/(3.14159*pow(nh*nh*(a2-1.)+1.,2.));float k=pow(roughness+1.,2.)/8.;float gg=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);c+=f*D*gg/max(4.*nv*nl,.0001)*nl*.8;color=vec4(c,1.);}''')
fireSource=(work/'fire.frag').read_text().replace('varying vec2 fireUV','in vec2 fireUV').replace('texture2D','texture').replace('gl_FragColor','color')
fire=program(vertex,head+'out vec4 color;\n'+fireSource)
fullscreen=head+'''out vec2 uv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0,1);}'''
optical=program(fullscreen,head+'''in vec2 uv;uniform sampler2D source,sourceT,front,back,depth,atlas;uniform int hasT;uniform vec3 eye,forward,absorption,planeOrigin,planeU,planeV,planeNormal;uniform mat4 inverseVP,vp;uniform vec2 views,atlasSize,tileSize;uniform float viewBlend,ior,radianceScale;layout(location=0) out vec4 color;layout(location=1) out vec4 transmittance;
vec3 flame(vec2 p){if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1))))return vec3(0);vec2 cellA=vec2(mod(views.x,4.),floor(views.x/4.)),cellB=vec2(mod(views.y,4.),floor(views.y/4.));vec2 pixel=vec2(p.x,1.-p.y)*(tileSize-1.)+.5;vec2 A=(cellA*tileSize+pixel)/atlasSize,B=(cellB*tileSize+pixel)/atlasSize;vec3 a=texture(atlas,vec2(A.x,1.-A.y)).rgb,b=texture(atlas,vec2(B.x,1.-B.y)).rgb;return mix(a*a,b*b,viewBlend)*radianceScale;}
vec3 reflectedFire(vec3 at,vec3 ray){float den=dot(ray,planeNormal);if(abs(den)<.0001)return vec3(0);float t=dot(planeOrigin-at,planeNormal)/den;if(t<=0.)return vec3(0);vec3 d=at+ray*t-planeOrigin;return flame(vec2(dot(d,planeU)/dot(planeU,planeU),dot(d,planeV)/dot(planeV,planeV)));}
vec3 environment(vec3 r){float strips=pow(max(0.,dot(r,normalize(vec3(-.4,-.3,1)))),28.)*2.4+pow(max(0.,dot(r,normalize(vec3(.6,.3,.5)))),40.)*1.2;float flag=smoothstep(-.1,.15,r.x)*smoothstep(.7,.35,r.x);return vec3(.12+strips)*(1.-.86*flag);}
void main(){vec4 base=texture(source,uv);vec3 T=hasT==1?texture(sourceT,uv).rgb:vec3(1.-base.a);vec4 f=texture(front,uv),b=texture(back,uv);color=base;transmittance=vec4(T,1);
if(f.w<=0.||b.w<=f.w)return;float z=texture(depth,uv).r*2.-1.;float sourceDepth=1600./(402.-z*398.);if(sourceDepth<f.w-.05)return;
vec4 farPoint=inverseVP*vec4(uv*2.-1.,1,1);vec3 ray=normalize(farPoint.xyz/farPoint.w-eye),at=eye+ray*f.w/max(dot(ray,forward),.0001),n=normalize(f.xyz);float cosine=clamp(dot(-ray,n),0.,1.);float f0=pow((ior-1.)/(ior+1.),2.),F=f0+(1.-f0)*pow(1.-cosine,5.);float thickness=(b.w-f.w)/max(dot(ray,forward),.1);vec3 inside=refract(ray,n,1./ior),exitPoint=at+inside*thickness,exitRay=refract(inside,-normalize(b.xyz),ior);vec4 projected=vp*vec4(exitPoint+exitRay*max(sourceDepth-b.w,0.),1);vec2 refracted=clamp(projected.xy/projected.w*.5+.5,vec2(.001),vec2(.999));vec4 incoming=texture(source,refracted);vec3 incomingT=hasT==1?texture(sourceT,refracted).rgb:vec3(1.-incoming.a);vec3 transmission=(1.-F)*exp(-absorption*thickness);vec3 reflection=environment(reflect(ray,n))+reflectedFire(at,reflect(ray,n));vec3 result=reflection*F+transmission*incoming.rgb;vec3 remaining=transmission*incomingT;color=vec4(result,1.-dot(remaining,vec3(1./3.)));transmittance=vec4(remaining,1);}''')

def texture(width,height,internal=G.GL_RGBA16F,fmt=G.GL_RGBA):
    t=G.glGenTextures(1);G.glBindTexture(G.GL_TEXTURE_2D,t);G.glTexImage2D(G.GL_TEXTURE_2D,0,internal,width,height,0,fmt,G.GL_FLOAT,None)
    for q,v in [(G.GL_TEXTURE_MIN_FILTER,G.GL_LINEAR),(G.GL_TEXTURE_MAG_FILTER,G.GL_LINEAR),(G.GL_TEXTURE_WRAP_S,G.GL_CLAMP_TO_EDGE),(G.GL_TEXTURE_WRAP_T,G.GL_CLAMP_TO_EDGE)]:G.glTexParameteri(G.GL_TEXTURE_2D,q,v)
    return t
def target(count=1):
    fb=G.glGenFramebuffers(1);G.glBindFramebuffer(G.GL_FRAMEBUFFER,fb);colors=[texture(W,H) for _ in range(count)]
    for i,t in enumerate(colors):G.glFramebufferTexture2D(G.GL_FRAMEBUFFER,G.GL_COLOR_ATTACHMENT0+i,G.GL_TEXTURE_2D,t,0)
    d=texture(W,H,G.GL_DEPTH_COMPONENT32F,G.GL_DEPTH_COMPONENT);G.glFramebufferTexture2D(G.GL_FRAMEBUFFER,G.GL_DEPTH_ATTACHMENT,G.GL_TEXTURE_2D,d,0);G.glDrawBuffers(count,[G.GL_COLOR_ATTACHMENT0+i for i in range(count)]);assert G.glCheckFramebufferStatus(G.GL_FRAMEBUFFER)==G.GL_FRAMEBUFFER_COMPLETE
    return fb,colors,d
base=target();wf=target();wb=target();gf=target();gb=target();wat=target(2);final=target(2)
vao=G.glGenVertexArrays(1);G.glBindVertexArray(vao);vbo=G.glGenBuffers(1);ebo=G.glGenBuffers(1)
def uniform(q,k,v):
    loc=G.glGetUniformLocation(q,k)
    if loc<0:return
    if isinstance(v,(int,np.integer)):G.glUniform1i(loc,int(v))
    elif isinstance(v,(float,np.floating)):G.glUniform1f(loc,float(v))
    elif len(v)==16:G.glUniformMatrix4fv(loc,1,False,np.asarray(v,np.float32))
    else:getattr(G,'glUniform'+str(len(v))+'fv')(loc,1,np.asarray(v,np.float32))
def bind(q,k,t,unit):G.glActiveTexture(G.GL_TEXTURE0+unit);G.glBindTexture(G.GL_TEXTURE_2D,t);uniform(q,k,unit)
def mesh(q,positions,normals,indices,model=None):
    G.glUseProgram(q);uniform(q,'vp',pose['viewProjection']);uniform(q,'model',model or np.eye(4).flatten().tolist());uniform(q,'eye',pose['camera']['eye']);uniform(q,'forward',pose['camera']['forward'])
    data=np.column_stack([positions,normals]).astype(np.float32);G.glBindBuffer(G.GL_ARRAY_BUFFER,vbo);G.glBufferData(G.GL_ARRAY_BUFFER,data.nbytes,data,G.GL_STREAM_DRAW)
    import ctypes
    for i in range(2):G.glEnableVertexAttribArray(i);G.glVertexAttribPointer(i,3,G.GL_FLOAT,False,24,ctypes.c_void_p(i*12))
    indices=np.asarray(indices,np.uint32);G.glBindBuffer(G.GL_ELEMENT_ARRAY_BUFFER,ebo);G.glBufferData(G.GL_ELEMENT_ARRAY_BUFFER,indices.nbytes,indices,G.GL_STREAM_DRAW);G.glDrawElements(G.GL_TRIANGLES,len(indices),G.GL_UNSIGNED_INT,None)
def clear(t):G.glBindFramebuffer(G.GL_FRAMEBUFFER,t[0]);G.glViewport(0,0,W,H);G.glClearColor(0,0,0,0);G.glClear(G.GL_COLOR_BUFFER_BIT|G.GL_DEPTH_BUFFER_BIT)
def fields(front,back,pos,nor,idx):
    G.glEnable(G.GL_DEPTH_TEST);G.glEnable(G.GL_CULL_FACE);G.glDisable(G.GL_BLEND)
    for t,side in [(front,G.GL_BACK),(back,G.GL_FRONT)]:clear(t);G.glCullFace(side);mesh(field,pos,nor,idx)
    G.glDisable(G.GL_CULL_FACE)
geometry=ROOT/'portfolio/assets/instrument-working-v1';cad=json.loads((geometry/'manifest.json').read_text());blob=gzip.decompress((geometry/'instrument.bin.gz').read_bytes())
def attribute(m,key):d=m[key];return np.frombuffer(blob,dtype={'float32':'<f4','int16':'<i2','uint32':'<u4'}[d['dtype']],count=d['count'],offset=d['offset']).copy()
cadMeshes=[m for m in cad['meshes'] if m['module']=='elements' and m['material']!=7]
glass=next(m for m in cadMeshes if m['material']==3)
glassData=(attribute(glass,'positions').reshape(-1,3),attribute(glass,'normals').reshape(-1,3)/32767,attribute(glass,'indices'))
fields(gf,gb,*glassData)
atlas=G.glGenTextures(1);G.glBindTexture(G.GL_TEXTURE_2D,atlas)
for q,v in [(G.GL_TEXTURE_MIN_FILTER,G.GL_LINEAR),(G.GL_TEXTURE_MAG_FILTER,G.GL_LINEAR),(G.GL_TEXTURE_WRAP_S,G.GL_CLAMP_TO_EDGE),(G.GL_TEXTURE_WRAP_T,G.GL_CLAMP_TO_EDGE)]:G.glTexParameteri(G.GL_TEXTURE_2D,q,v)
studio=G.glGenTextures(1);G.glBindTexture(G.GL_TEXTURE_2D,studio);environment=np.fromfile(work/'studio.rgba32f','<f4').reshape(512,1024,4);G.glTexImage2D(G.GL_TEXTURE_2D,0,G.GL_RGBA16F,1024,512,0,G.GL_RGBA,G.GL_FLOAT,environment);G.glGenerateMipmap(G.GL_TEXTURE_2D);G.glTexParameteri(G.GL_TEXTURE_2D,G.GL_TEXTURE_MIN_FILTER,G.GL_LINEAR_MIPMAP_LINEAR);G.glTexParameteri(G.GL_TEXTURE_2D,G.GL_TEXTURE_MAG_FILTER,G.GL_LINEAR);G.glTexParameteri(G.GL_TEXTURE_2D,G.GL_TEXTURE_WRAP_S,G.GL_REPEAT);G.glTexParameteri(G.GL_TEXTURE_2D,G.GL_TEXTURE_WRAP_T,G.GL_CLAMP_TO_EDGE)
G.glUseProgram(opaque);bind(opaque,'studio',studio,7);G.glUseProgram(optical);bind(optical,'studio',studio,7)
def opticalPass(destination,source,front,back,ior,absorption,hasT):
    clear(destination);G.glDisable(G.GL_DEPTH_TEST);G.glDisable(G.GL_BLEND);G.glUseProgram(optical)
    for k,v in {'eye':pose['camera']['eye'],'forward':pose['camera']['forward'],'inverseVP':pose['camera']['inverseViewProjection'],'vp':pose['viewProjection'],'ior':ior,'absorption':absorption,'hasT':hasT,'planeOrigin':pose['firePlane']['origin'],'planeU':pose['firePlane']['u'],'planeV':pose['firePlane']['v'],'planeNormal':pose['firePlane']['normal'],'radianceScale':float(fireMetadata['radianceScale']*fireMetadata.get('radianceGain',1))}.items():uniform(optical,k,v)
    for k in ['views','viewBlend','atlasSize','tileSize']:uniform(optical,k,pose['uniforms'][k])
    for unit,(k,t) in enumerate([('source',source[1][0]),('sourceT',source[1][-1]),('front',front[1][0]),('back',back[1][0]),('depth',base[2]),('atlas',atlas)]):bind(optical,k,t,unit)
    G.glDrawArrays(G.GL_TRIANGLES,0,3)
proof=[];clipped=0;encodingScale=32
try:
 for frame in range(a.frames):
    waterIndex=round((1-math.cos(2*math.pi*frame/218))*.5*(len(water['frames'])-1));item=water['frames'][waterIndex]
    raw=gzip.decompress((a.water/item['file']).read_bytes());count=item['count'];pos=np.frombuffer(raw,'<i2',count=count*3).reshape(-1,3)/water['positionScale'];nor=np.frombuffer(raw,'<i2',count=count*3,offset=count*6).reshape(-1,3)/32767;indices=np.arange(count,dtype=np.uint32)
    fields(wf,wb,pos,nor,indices);clear(base);G.glEnable(G.GL_DEPTH_TEST);G.glDisable(G.GL_BLEND)
    for m in cadMeshes if a.include_cad else []:
      if m['material']==3:continue
      G.glUseProgram(opaque);uniform(opaque,'base',[.68,.70,.73] if m['material'] in [0,1] else [.025,.027,.03]);uniform(opaque,'metallic',.98 if m['material'] in [0,1] else .05);uniform(opaque,'roughness',.24 if m['material'] in [0,1] else .55);mesh(opaque,attribute(m,'positions').reshape(-1,3),attribute(m,'normals').reshape(-1,3)/32767,attribute(m,'indices'))
    image=np.array(Image.open(work.parent/('packed-'+fireRecording)/f'{frame%fireMetadata['frames']:03}.png').convert('RGB'))
    G.glUseProgram(fire);bind(fire,'image',atlas,0);G.glTexImage2D(G.GL_TEXTURE_2D,0,G.GL_RGB8,image.shape[1],image.shape[0],0,G.GL_RGB,G.GL_UNSIGNED_BYTE,image[::-1].copy())
    for k,v in pose['uniforms'].items():uniform(fire,k,v)
    G.glEnable(G.GL_BLEND);G.glBlendFunc(G.GL_ONE,G.GL_ONE_MINUS_SRC_ALPHA);mesh(fire,np.array(pose['positions']).reshape(-1,3),np.zeros((4,3)),[0,1,2,0,2,3],pose['model']);G.glDisable(G.GL_BLEND)
    G.glReadBuffer(G.GL_COLOR_ATTACHMENT0);emitter=np.frombuffer(G.glReadPixels(0,0,W,H,G.GL_RGBA,G.GL_FLOAT),np.float32).reshape(H,W,4)[::-1,:,:3].copy()
    G.glBindFramebuffer(G.GL_FRAMEBUFFER,wf[0]);waterMask=np.frombuffer(G.glReadPixels(0,0,W,H,G.GL_RGBA,G.GL_FLOAT),np.float32).reshape(H,W,4)[::-1,:,3]>0
    opticalPass(wat,base,wf,wb,1.333,(-np.log([.89,.92,.94])/400).tolist(),0)
    if a.include_cad:opticalPass(final,wat,gf,gb,1.52,(-np.log([.96,.98,.99])/150).tolist(),1)
    G.glFinish();G.glReadBuffer(G.GL_COLOR_ATTACHMENT0);L=np.frombuffer(G.glReadPixels(0,0,W,H,G.GL_RGBA,G.GL_FLOAT),np.float32).reshape(H,W,4)[::-1,:,:3].copy();G.glReadBuffer(G.GL_COLOR_ATTACHMENT1);T=np.frombuffer(G.glReadPixels(0,0,W,H,G.GL_RGBA,G.GL_FLOAT),np.float32).reshape(H,W,4)[::-1,:,:3].copy();assert np.isfinite(L).all() and np.isfinite(T).all();clipped+=int((L>encodingScale).sum())
    packed=np.concatenate([np.sqrt(np.clip(L/encodingScale,0,1)),np.clip(T,0,1)],axis=1);Image.fromarray(np.uint8(packed*255+.5)).save(work/f'joint-{frame:03}.png')
    B=display(np.array(pose['paper']));F=display(L+T*np.array(pose['paper']))
    # Display-referred emitter coverage keeps flame color on a bright paper UI.
    # The separate linear L/T master retains physical additive emission.
    coverage=1-np.exp(-emitter.max(axis=2))
    emitterOnly=(coverage>1e-6)&~waterMask
    emitterDisplay=display(L/np.maximum(coverage[:,:,None],1e-8))*coverage[:,:,None]+B*(1-coverage[:,:,None])
    F=np.where(emitterOnly[:,:,None],emitterDisplay,F)
    alpha=np.clip(np.maximum.reduce([1-T.min(axis=2),(1-F/B).max(axis=2),((F-B)/np.maximum(1-B,1e-6)).max(axis=2)]),0,1)
    alpha=np.where(alpha<3/255,0,alpha)
    C=np.clip((F-(1-alpha[:,:,None])*B)/np.maximum(alpha[:,:,None],1e-8),0,1)
    Image.fromarray(np.uint8(np.dstack([C,alpha])*255+.5),'RGBA').save(work/f'alpha-{frame:03}.png')
    if frame in [0,54,108,162,217]:np.savez_compressed(work/f'review-{frame:03}.npz',L=L,T=T);proof.append({'frame':frame,'waterFrame':waterIndex,'maxRadiance':float(L.max()),'transmissionRange':[float(T.min()),float(T.max())]})
    if frame%30==0:print(json.dumps({'compositeFrame':frame,'waterFrame':waterIndex}),flush=True)
 assert G.glGetError()==0;assert clipped==0,'Composite radiance encoding clipped'
 video=out/'elements-composite-linear-transmittance.mp4';subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','30','-i',str(work/'joint-%03d.png'),'-frames:v',str(a.frames),'-c:v','libx264','-crf','12','-preset','slow','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],check=True)
 manifest={'complete':True,'video':video.name,'frames':a.frames,'fps':30,'duration':a.frames/30,'tile':[W,H],'width':W*2,'height':H,'radianceScale':encodingScale,'encoding':'left: sqrt linear radiance; right: RGB transmittance; no backdrop','paper':pose['paper'],'proof':proof,'gpu':G.glGetString(G.GL_RENDERER).decode(),'waterSource':str(a.water.relative_to(ROOT)),'fireSource':'portfolio-fire-water-shared-v3','geometry':'retained ELEMENTS CAD vessel, ports and cable; regenerated FLIP surface','limitation':'Native fixed camera raster preview; paired optical exits and weighted fire depth approximate multiple interfaces. Full hero uses live geometry and its own raster optics.'}
 print(json.dumps({'linearMasterComplete':True,'video':str(video),'frames':a.frames,'bytes':video.stat().st_size,'clippedChannels':clipped}),flush=True)
 manifest['fireSource']=fireRecording
 manifest['geometry']='Native FLIP surface fitted to the retained CAD cavity and native fire volume; effects only' if not a.include_cad else manifest['geometry']
 alphaVideo=out/'elements-composite-alpha.webm'
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','30','-i',str(work/'alpha-%03d.png'),'-frames:v',str(a.frames),'-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-lossless','1','-cpu-used','4','-b:v','0',str(alphaVideo)],check=True)
 manifest['displayVideo']=alphaVideo.name;manifest['displayEncoding']='Straight RGBA: paper-calibrated water optics and independently tone-mapped emitter coverage for legibility on paper. Physical additive emission and RGB transmission remain in the linear master.'
 manifest.update(displayBytes=alphaVideo.stat().st_size,displaySha256=hashlib.sha256(alphaVideo.read_bytes()).hexdigest(),displayAlphaThreshold=3/255,displayAlphaLossless=True)
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({'alphaVideo':str(alphaVideo),'bytes':alphaVideo.stat().st_size}),flush=True)
finally:glfw.destroy_window(window);glfw.terminate()
