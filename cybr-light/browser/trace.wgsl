struct Uniforms { size:vec4u, eye:vec4f, right:vec4f, up:vec4f, forward:vec4f, previousEye:vec4f, previousRight:vec4f, previousUp:vec4f, previousForward:vec4f, flags:vec4f }
struct Triangle { p:vec4f,e1:vec4f,e2:vec4f }
struct Attributes { n0:vec4f,n1:vec4f,n2:vec4f,c0:vec4f,c1:vec4f,c2:vec4f }
struct Node { low:vec4f,high:vec4f,links:vec4u }
struct Material { base:vec4f,physical:vec4f,emission:vec4f,attenuation:vec4f }
struct Pixel { color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f }
struct Hit { t:f32, id:i32, bary:vec2f }
struct MediumStack { count:u32,ids:array<u32,16>,values:array<vec4f,16> }
fn mediumExitSlot(stack:ptr<function,MediumStack>,boundary:u32)->u32{
 var slot=(*stack).count;for(var s=0u;s<(*stack).count;s++){if((*stack).ids[s]==boundary){slot=s;}}return slot;
}
fn mediumTarget(stack:ptr<function,MediumStack>,boundary:u32,entering:bool,inside:vec4f)->vec4f{
 if(entering){return inside;}let slot=mediumExitSlot(stack,boundary);
 if(slot<(*stack).count){if(slot+1u<(*stack).count){return (*stack).values[(*stack).count-1u];}if(slot>0u){return (*stack).values[slot-1u];}}
 return vec4f(0,0,0,1);
}
fn commitMedium(stack:ptr<function,MediumStack>,boundary:u32,entering:bool,inside:vec4f){
 if(entering){(*stack).ids[(*stack).count]=boundary;(*stack).values[(*stack).count]=inside;(*stack).count++;return;}
 let slot=mediumExitSlot(stack,boundary);if(slot<(*stack).count){for(var s=slot;s+1u<(*stack).count;s++){(*stack).ids[s]=(*stack).ids[s+1u];(*stack).values[s]=(*stack).values[s+1u];}(*stack).count--;}
}
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read> triangles:array<Triangle>;
@group(0) @binding(2) var<storage,read> nodes:array<Node>;
@group(0) @binding(3) var<storage,read> materials:array<Material>;
@group(0) @binding(4) var<storage,read_write> samples:array<Pixel>;
struct Portal { center:vec4f,u:vec4f,v:vec4f }
@group(0) @binding(5) var<storage,read> portals:array<Portal>;
@group(0) @binding(6) var<storage,read> attributes:array<Attributes>;
struct AreaLight { p:vec4f,e1:vec4f,e2:vec4f,emission:vec4f }
struct Lighting { environment:vec4f,info:vec4f,lights:array<AreaLight> }
@group(0) @binding(7) var<storage,read> lighting:Lighting;
const PI=3.14159265359;
fn random(seed:ptr<function,u32>)->f32{*seed=(*seed)*747796405u+2891336453u;var v=(((*seed)>>(((*seed)>>28u)+4u))^(*seed))*277803737u;v=(v>>22u)^v;return f32(v>>8u)*(1./16777216.);}
fn boxDistance(node:Node,o:vec3f,inv:vec3f)->vec2f{let a=(node.low.xyz-o)*inv;let b=(node.high.xyz-o)*inv;let lo=min(a,b);let hi=max(a,b);return vec2f(max(max(lo.x,lo.y),max(lo.z,0.00001)),min(min(hi.x,hi.y),hi.z));}
fn trace(o:vec3f,d:vec3f,limit:f32,anyHit:bool)->Hit{
 var hit=Hit(limit,-1,vec2f(0));let inv=select(vec3f(-1),vec3f(1),d>=vec3f(0))/max(abs(d),vec3f(1e-10));var stack:array<u32,64>;var count=1u;stack[0]=0u;
 loop {if(count==0u){break;}count--;let ni=stack[count];let node=nodes[ni];let range=boxDistance(node,o,inv);if(range.y<range.x||range.x>=hit.t){continue;}
  if(node.links.w>0u){for(var k=0u;k<node.links.w;k++){let id=node.links.z+k;let tr=triangles[id];let p=cross(d,tr.e2.xyz);let det=dot(tr.e1.xyz,p);if(abs(det)<1e-10){continue;}let r=1.0/det;let s=o-tr.p.xyz;let x=dot(s,p)*r;if(x<0.0||x>1.0){continue;}let q=cross(s,tr.e1.xyz);let y=dot(d,q)*r;if(y<0.0||x+y>1.0){continue;}let t=dot(tr.e2.xyz,q)*r;if(t>0.00001&&t<hit.t){hit=Hit(t,i32(id),vec2f(x,y));if(anyHit){return hit;}}}
  }else{let a=boxDistance(nodes[node.links.x],o,inv);let b=boxDistance(nodes[node.links.y],o,inv);let av=a.y>=a.x&&a.x<hit.t;let bv=b.y>=b.x&&b.x<hit.t;if(av&&bv){let near=select(node.links.y,node.links.x,a.x<b.x);let far=select(node.links.x,node.links.y,a.x<b.x);stack[count]=far;stack[count+1u]=near;count+=2u;}else if(av){stack[count]=node.links.x;count++;}else if(bv){stack[count]=node.links.y;count++;}}
 }
 if(lighting.info.x<.5&&abs(d.y)>1e-8){let t=(u.eye.w-o.y)/d.y;if(t>0.00001&&t<hit.t){hit=Hit(t,-2,vec2f(0));}}
 return hit;
}
fn lightHit(o:vec3f,d:vec3f)->f32{if(lighting.info.x>.5||lighting.info.z>.5||d.y<=0.0){return 1e20;}let t=(4.5-o.y)/d.y;let p=o+d*t;if(t>0.0&&abs(p.x)<2.0&&abs(p.z)<1.5){return t;}return 1e20;}
fn environment(d:vec3f)->vec3f{if(lighting.info.z>.5){return mix(vec3f(.10,.12,.08),mix(vec3f(.62,.73,.86),vec3f(.20,.39,.70),sqrt(max(d.y,0.))),smoothstep(-.12,.05,d.y));}if(lighting.info.x>.5){return lighting.environment.xyz;}let sky=mix(vec3f(.12,.14,.17),vec3f(.65,.7,.76),clamp(d.y*.5+.5,0.,1.));let strip=pow(max(0.,dot(d,normalize(vec3f(-1.,.4,-.3)))),80.);return sky+strip*2.;}
fn basis(n:vec3f,v:vec3f)->vec3f{let axis=select(vec3f(0,1,0),vec3f(1,0,0),abs(n.y)>.9);let t=normalize(cross(axis,n));return t*v.x+cross(n,t)*v.y+n*v.z;}
// Analytic importance mixture for this studio environment, not an HDRI CDF.
// Full-sphere support prevents bias even where the sharp strip has zero PDF.
fn environmentPDF(d:vec3f)->f32{if(lighting.info.z>.5){return 1./(4.*PI);}return .9/(4.*PI)+.1*81./(2.*PI)*pow(max(0.,dot(d,normalize(vec3f(-1.,.4,-.3)))),80.);}
fn sampleEnvironment(seed:ptr<function,u32>)->vec3f{
 let strip=random(seed)<.1&&lighting.info.z<.5;let r=random(seed);let phi=2.*PI*random(seed);
 let z=select(2.*r-1.,pow(r,1./81.),strip);let radius=sqrt(max(0.,1.-z*z));let local=vec3f(radius*cos(phi),radius*sin(phi),z);
 return select(local,basis(normalize(vec3f(-1.,.4,-.3)),local),strip);
}
fn areaSelection()->f32{if(lighting.info.z>.5){return 0.;}if(lighting.info.x>.5){return 1.;}return select(1.,.5,u.up.w>.5);}
fn sourceLightPDF(light:AreaLight,d:vec3f,distance:f32)->f32{
 let areaVector=cross(light.e1.xyz,light.e2.xyz);let twiceArea=length(areaVector);
 return 2.*distance*distance*light.e1.w/max(abs(dot(d,areaVector)),1e-20);
}
fn sampleSourceLight(r:f32,count:u32)->u32{
 var low=0u;var high=count-1u;
 loop{if(low>=high){break;}let mid=(low+high)/2u;if(r<lighting.lights[mid].p.w){high=mid;}else{low=mid+1u;}}
 return low;
}
// Heitz 2018 visible-normal GGX sampling: avoids the large grazing-angle
// weights of sampling the full normal distribution. No radiance clamping.
fn visibleGGX(n:vec3f,wo:vec3f,alpha:f32,r:vec2f)->vec3f{
 let tx=basis(n,vec3f(1,0,0));let ty=cross(n,tx);
 let v=normalize(vec3f(alpha*dot(wo,tx),alpha*dot(wo,ty),dot(wo,n)));
 let lensq=v.x*v.x+v.y*v.y;var t1=vec3f(1,0,0);if(lensq>1e-8){t1=vec3f(-v.y,v.x,0)/sqrt(lensq);}let t2=cross(v,t1);
 let radius=sqrt(r.x);let p1=radius*cos(2.*PI*r.y);var p2=radius*sin(2.*PI*r.y);let s=.5*(1.+v.z);p2=(1.-s)*sqrt(max(0.,1.-p1*p1))+s*p2;
 let nh=p1*t1+p2*t2+sqrt(max(0.,1.-p1*p1-p2*p2))*v;
 let h=normalize(vec3f(alpha*nh.x,alpha*nh.y,max(0.,nh.z)));return tx*h.x+ty*h.y+n*h.z;
}
fn fresnel(f0:vec3f,c:f32)->vec3f{return f0+(vec3f(1)-f0)*pow(clamp(1.-c,0.,1.),5.);}
// Positive form avoids cancellation at the glossy peak. A generic 1e-8
// denominator clamp destroys valid low-roughness GGX values and their PDF.
fn distribution(nh:f32,a:f32)->f32{let a2=a*a;let c=clamp(nh,0.,1.);let d=(1.-c)*(1.+c)+c*c*a2;return a2/(PI*d*d);}
fn dielectricFresnel(cosine:f32,etaI:f32,etaT:f32)->f32{
 if(etaI==etaT){return 0.;}
 let ci=clamp(cosine,0.,1.);let eta=etaI/etaT;let st2=eta*eta*max(0.,1.-ci*ci);
 if(st2>=1.){return 1.;}
 let ct=sqrt(max(0.,1.-st2));
 let rs=(etaI*ci-etaT*ct)/max(etaI*ci+etaT*ct,1e-20);
 let rp=(etaT*ci-etaI*ct)/max(etaT*ci+etaI*ct,1e-20);
 return .5*(rs*rs+rp*rp);
}
fn masking(nv:f32,a:f32)->f32{return 2.*nv/max(nv+sqrt(a*a+(1.-a*a)*nv*nv),1e-6);}
fn specularProbability(color:vec3f,metal:f32,nv:f32)->f32{
 if(u.right.w<.5){return select(.25,1.,metal>.99);}
 if(metal>.99){return 1.;}
 let f=fresnel(mix(vec3f(.04),color,metal),nv);
 let spec=dot(f,vec3f(.2126,.7152,.0722));
 let diffuse=dot(color*(1.-metal)*(vec3f(1)-f),vec3f(.2126,.7152,.0722));
 return clamp(spec/max(spec+diffuse,1e-8),.05,.95);
}
fn bsdf(n:vec3f,wo:vec3f,wi:vec3f,color:vec3f,metal:f32,alpha:f32,diffuseOnly:f32)->vec4f{
 let nv=max(dot(n,wo),.001);let nl=max(dot(n,wi),0.);if(nl<=0.){return vec4f(0);}
 if(diffuseOnly>.5){return vec4f(color/PI,nl/PI);}
 let h=normalize(wo+wi);let f=fresnel(mix(vec3f(.04),color,metal),max(dot(wo,h),0.));let d=distribution(max(dot(n,h),0.),alpha);let g=masking(nv,alpha);
 let probability=specularProbability(color,metal,nv);let pdf=probability*d*g/(4.*nv)+(1.-probability)*nl/PI;
 let value=color*(1.-metal)*(vec3f(1)-f)/PI+f*d*g*masking(nl,alpha)/max(4.*nv*nl,1e-6);
 return vec4f(value,pdf);
}
fn mis(a:f32,b:f32)->f32{let r=b/max(a,1e-20);return 1./(1.+r*r);}
// Same aperture geometry and solid-angle heuristic as Observatory's native tracer.
fn portalWeight(p:vec3f)->f32{
 var weights:array<f32,2>;
 for(var i=0u;i<2u;i++){let a=portals[i];let axis=cross(a.u.xyz,a.v.xyz);let v=a.center.xyz-p;weights[i]=4.*length(axis)*max(.04,abs(dot(normalize(v),normalize(axis))))/max(.15,dot(v,v));}
 return clamp(weights[0]/max(weights[0]+weights[1],1e-12),.07,.93);
}
fn portalPDF(p:vec3f,d:vec3f)->f32{
 if(u.flags.z<.5){return 0.;}var result=0.;let w=portalWeight(p);
 for(var i=0u;i<2u;i++){let a=portals[i];let axis=cross(a.u.xyz,a.v.xyz);let n=normalize(axis);let dn=dot(d,n);if(abs(dn)<1e-8){continue;}
  let t=dot(a.center.xyz-p,n)/dn;if(t<=.0001){continue;}let q=p+d*t-a.center.xyz;
  if(abs(dot(q,a.u.xyz)/dot(a.u.xyz,a.u.xyz))>1.||abs(dot(q,a.v.xyz)/dot(a.v.xyz,a.v.xyz))>1.){continue;}
  result+=select(w,1.-w,i==1u)*t*t/(abs(dn)*4.*length(axis));
 }return result;
}
fn material(h:Hit)->Material{if(h.id<0){return Material(vec4f(.64,.65,.63,.82),vec4f(0,0,1.5,0),vec4f(0),vec4f(1,1,1,100));}return materials[u32(triangles[h.id].p.w)];}
fn geometric(h:Hit)->vec3f{if(h.id<0){return vec3f(0,1,0);}let t=triangles[h.id];let n=cross(t.e1.xyz,t.e2.xyz);let lengthSquared=dot(n,n);if(lengthSquared<1e-20){return vec3f(0,1,0);}return n*inverseSqrt(lengthSquared);}
fn normal(h:Hit)->vec3f{if(h.id<0){return vec3f(0,1,0);}let t=attributes[h.id];let n=t.n0.xyz*(1.-h.bary.x-h.bary.y)+t.n1.xyz*h.bary.x+t.n2.xyz*h.bary.y;let lengthSquared=dot(n,n);if(lengthSquared<1e-20){return geometric(h);}return n*inverseSqrt(lengthSquared);}
fn vertexColor(h:Hit)->vec3f{if(h.id<0){return vec3f(1);}let t=attributes[h.id];return t.c0.xyz*(1.-h.bary.x-h.bary.y)+t.c1.xyz*h.bary.x+t.c2.xyz*h.bary.y;}
fn camera(xy:vec2f)->vec3f{let screen=(xy/vec2f(u.size.xy)*2.-1.)*vec2f(f32(u.size.x)/f32(u.size.y),-1.);return normalize(u.forward.xyz+(u.right.xyz*screen.x+u.up.xyz*screen.y)*u.forward.w);}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){if(any(gid.xy>=u.size.xy)){return;}let index=gid.y*u.size.x+gid.x;var seed=index*9781u+u.size.z*6271u+89173u;
 let pathDirection=camera(vec2f(gid.xy)+vec2f(random(&seed),random(&seed)));
 let guideDirection=select(camera(vec2f(gid.xy)+.5),pathDirection,u.previousEye.w>.5);let guide=trace(u.eye.xyz,guideDirection,1e20,false);var guidePos=vec4f(0,0,0,-1);var guideNormal=vec4f(0,0,0,1);
 if(guide.id!=-1){let m=material(guide);var surface=-2.;if(guide.id>=0){surface=triangles[guide.id].p.w+3.;}guidePos=vec4f(u.eye.xyz+guideDirection*guide.t,surface);guideNormal=vec4f(normal(guide),select(m.base.w,0.,m.physical.y>.5));}
 var origin=u.eye.xyz;var direction=pathDirection;var throughput=vec3f(1);var radiance=vec3f(0);var delta=true;var medium=vec3f(0);var ior=1.;var previousPdf=0.;
 // One slot per possible interface. The UI permits at most ten bounces;
 // sixteen slots cannot overflow for any supported path. Restore enclosing
 // absorption as well as IOR on exit. IDs identify boundaries, not materials.
 var media:MediumStack;
 // One bounded split removes the primary glass Fresnel coin flip. The saved
 // reflection retains its own incident medium and the original path depth.
 // Later interfaces stay stochastic, so no reflection energy is discarded.
 var pending=false;var didSplit=false;var pendingOrigin=vec3f(0);var pendingDirection=vec3f(0);var pendingThroughput=vec3f(0);var pendingMedium=vec3f(0);var pendingIor=1.;var pendingDepth=0u;
 var secondary=vec4f(0,0,0,-1);var secondaryNormal=vec4f(0);var transmissionChain=false;
 // A virtual image behind an opaque mirror moves differently from its surface.
 // Reuse the existing reflected path's first hit: no extra guide ray.
 var trackReflection=false;var reflectionDistance=0.;var reflectionGuide=0.;
 if(guide.id!=-1){let gm=material(guide);if(gm.physical.x>.1){reflectionGuide=-2.;}if(gm.physical.y>.5){reflectionGuide=-1.;}}
 // A random GGX sample is an estimator, not a stable motion guide.
 let stableReflection=(u32(u.flags.w)&4u)!=0u;
 if(stableReflection&&guide.id>=0){
  let gm=material(guide);
  if(gm.physical.x>.99&&gm.physical.y<.5&&gm.base.w<.3){
   var gn=geometric(guide);if(dot(gn,guideDirection)>0.){gn=-gn;}
   var n=normal(guide);if(dot(n,gn)<0.){n=-n;}
   var reflected=reflect(guideDirection,n);if(dot(reflected,gn)<=0.){reflected=reflect(guideDirection,gn);}
   let start=guidePos.xyz+gn*.0001;let rh=trace(start,reflected,1e20,false);
   reflectionDistance=min(min(rh.t,lightHit(start,reflected)),50.);reflectionGuide=1.;
  }
  if(gm.physical.y>.5){
   // Deterministic transmitted guide, with the same nested IOR stack as the
   // estimator. This does not add radiance or suppress Fresnel reflections.
   var go=u.eye.xyz;var gd=guideDirection;var guideMedia:MediumStack;var gi=1.;
   for(var depth=0u;depth<min(u.size.w,16u);depth++){
    var hit=guide;if(depth>0u){hit=trace(go,gd,1e20,false);}
    if(hit.id==-1){break;}
    let point=go+gd*hit.t;let m=material(hit);let gn=geometric(hit);let entering=dot(gd,gn)<0.;
    let geometricNormal=select(-gn,gn,entering);var n=normal(hit);if(dot(n,geometricNormal)<0.){n=-n;}
    if(dot(n,-gd)<.001){n=geometricNormal;}
    if(m.physical.y<.5){var surface=-2.;if(hit.id>=0){surface=triangles[hit.id].p.w+3.;}secondary=vec4f(point,surface);secondaryNormal=vec4f(n,1);break;}
    let boundary=u32(attributes[hit.id].n0.w);
    let inside=vec4f(0,0,0,m.physical.z);let nextMedium=mediumTarget(&guideMedia,boundary,entering,inside);
    let incident=select(gi,m.physical.z,!entering&&guideMedia.count==0u);
    var rd=refract(gd,n,incident/nextMedium.w);
    if(dot(rd,geometricNormal)>0.){rd=refract(gd,geometricNormal,incident/nextMedium.w);}
    if(dot(rd,rd)<.01){break;}
    commitMedium(&guideMedia,boundary,entering,inside);gi=nextMedium.w;gd=normalize(rd);go=point-geometricNormal*.0001;
   }
  }
 }
 var startDepth=0u;
 for(var branch=0u;branch<2u;branch++){
 for(var bounce=startDepth;bounce<min(u.size.w,16u);bounce++){
  var hit=guide;if(bounce>0u||u.previousEye.w<.5){hit=trace(origin,direction,1e20,false);}let lamp=lightHit(origin,direction);
  if(bounce==1u&&trackReflection&&!stableReflection){reflectionDistance=min(min(hit.t,lamp),50.);reflectionGuide=1.;}
  throughput*=exp(-medium*min(hit.t,lamp));
  if(lamp<hit.t){var weight=1.;if(!delta&&u.flags.z<.5){weight=mis(previousPdf,areaSelection()*lamp*lamp/max(12.*direction.y,1e-8));}radiance+=throughput*vec3f(10.,9.7,9.2)*weight;break;}
  if(hit.id==-1){var weight=1.;if(!delta){let envPdf=select((1.-areaSelection())*environmentPDF(direction),portalPDF(origin,direction),u.flags.z>.5);weight=mis(previousPdf,envPdf);}radiance+=throughput*environment(direction)*weight;break;}
  let point=origin+direction*hit.t;let gn=geometric(hit);let entering=dot(direction,gn)<0.;let geometricNormal=select(-gn,gn,entering);var n=normal(hit);if(dot(n,geometricNormal)<0.){n=-n;}if(dot(n,-direction)<0.001){n=geometricNormal;}
  let m=material(hit);let color=m.base.rgb*vertexColor(hit);let rough=max(m.base.w,.035);let alpha=rough*rough;let metal=m.physical.x;let wo=-direction;let nv=max(dot(n,wo),.001);
  if(branch==0u&&transmissionChain&&m.physical.y<.5&&!stableReflection){var surface=-2.;if(hit.id>=0){surface=triangles[hit.id].p.w+3.;}secondary=vec4f(point,surface);secondaryNormal=vec4f(n,1);transmissionChain=false;}
  if(any(m.emission.xyz>vec3f(0))){var weight=1.;let lightIndex=u32(triangles[hit.id].e2.w);if(!delta&&lightIndex>0u){weight=mis(previousPdf,sourceLightPDF(lighting.lights[lightIndex-1u],direction,hit.t));}radiance+=throughput*m.emission.xyz*weight;break;}
  if(bounce==0u&&guide.id>=0&&hit.id>=0){trackReflection=m.physical.x>.99&&m.physical.y<.5&&rough<.3&&triangles[hit.id].p.w==triangles[guide.id].p.w&&dot(n,guideNormal.xyz)>.995;}
  if(m.physical.y>.5){
   let boundary=u32(attributes[hit.id].n0.w);
   let inside=vec4f(-log(clamp(m.attenuation.xyz,vec3f(1e-20),vec3f(1)))/max(m.attenuation.w,1e-8),m.physical.z);
   let nextMedium=mediumTarget(&media,boundary,entering,inside);
   // Camera-inside fallback: an unmatched first exit starts in this material.
   let incidentIor=select(ior,m.physical.z,!entering&&media.count==0u);
   let eta=incidentIor/nextMedium.w;
   var opticalNormal=geometricNormal;if(u.previousUp.w>.5){opticalNormal=n;}
   var refracted=refract(direction,opticalNormal,eta);var reflectedDirection=reflect(direction,opticalNormal);
   if(dot(reflectedDirection,geometricNormal)<=0.||dot(refracted,geometricNormal)>0.){opticalNormal=geometricNormal;refracted=refract(direction,opticalNormal,eta);reflectedDirection=reflect(direction,opticalNormal);}
   let cosine=max(0.,dot(wo,opticalNormal));let f=dielectricFresnel(cosine,incidentIor,nextMedium.w);
   let split=u.previousUp.w>.5&&!didSplit&&branch==0u&&bounce==0u&&f>0.&&f<1.&&dot(refracted,refracted)>.01;
   if(split){pending=true;didSplit=true;transmissionChain=true;pendingOrigin=point+geometricNormal*.0001;pendingDirection=reflectedDirection;pendingThroughput=throughput*f;pendingMedium=medium;pendingIor=ior;pendingDepth=bounce+1u;throughput*=1.-f;}
   if(!split&&(dot(refracted,refracted)<.01||random(&seed)<f)){direction=reflectedDirection;transmissionChain=false;}else{
    direction=normalize(refracted);throughput*=eta*eta;
    commitMedium(&media,boundary,entering,inside);
    ior=nextMedium.w;medium=nextMedium.xyz;
   }delta=true;
  }else{
   // Ideal directional daylight. Delta source: no BSDF-hit MIS term.
   if(lighting.info.z>.5){
    let wi=normalize(vec3f(-.469,.559,.684));let nl=max(dot(n,wi),0.);
    if(nl>0.&&dot(geometricNormal,wi)>0.){let shadow=trace(point+geometricNormal*.0001,wi,1e20,true);if(shadow.id==-1){let brdf=bsdf(n,wo,wi,color,metal,alpha,m.physical.w);radiance+=throughput*brdf.rgb*vec3f(3.1,2.8,2.4)*nl;}}
   }
   if(lighting.info.x>.5){
    let count=u32(lighting.info.y);
    if(count>0u){let light=lighting.lights[sampleSourceLight(random(&seed),count)];let r=sqrt(random(&seed));let v=random(&seed);let lp=light.p.xyz+light.e1.xyz*(1.-r)+light.e2.xyz*(r*v);let lv=lp-point;let distance=length(lv);let wi=lv/distance;let nl=max(dot(n,wi),0.);
     if(nl>0.&&dot(geometricNormal,wi)>0.){let shadow=trace(point+geometricNormal*.0001,wi,distance-.0003,true);if(shadow.id==-1){let brdf=bsdf(n,wo,wi,color,metal,alpha,m.physical.w);let pdf=sourceLightPDF(light,wi,distance);radiance+=throughput*brdf.rgb*light.emission.xyz*nl/pdf*mis(pdf,brdf.w);}}
    }
   }else if(u.flags.z>.5){
    let aperture=portals[select(1u,0u,random(&seed)<portalWeight(point))];
    let skyDirection=normalize(aperture.center.xyz+aperture.u.xyz*(2.*random(&seed)-1.)+aperture.v.xyz*(2.*random(&seed)-1.)-point);
    let cosine=max(dot(n,skyDirection),0.);let pdf=portalPDF(point,skyDirection);
    if(cosine>0.&&dot(geometricNormal,skyDirection)>0.&&pdf>1e-10){
     let skyOrigin=point+geometricNormal*.0001;let occlusion=trace(skyOrigin,skyDirection,1e20,true);
     if(occlusion.id==-1&&lightHit(skyOrigin,skyDirection)>1e19){let brdf=bsdf(n,wo,skyDirection,color,metal,alpha,m.physical.w);radiance+=throughput*brdf.rgb*environment(skyDirection)*cosine/pdf*mis(pdf,brdf.w);}
    }
   }else if(areaSelection()>=1.||random(&seed)<areaSelection()){
   let lightPoint=vec3f((random(&seed)-.5)*4.,4.5,(random(&seed)-.5)*3.);let lightVector=lightPoint-point;let distance=length(lightVector);let wi=lightVector/distance;let nl=max(dot(n,wi),0.);let lc=max(wi.y,0.);
   if(nl>0.&&lc>0.&&dot(geometricNormal,wi)>0.){let shadow=trace(point+geometricNormal*.0001,wi,distance-.0003,true);if(shadow.id==-1){let brdf=bsdf(n,wo,wi,color,metal,alpha,m.physical.w);let lightPdf=areaSelection()*distance*distance/(lc*12.);radiance+=throughput*brdf.rgb*vec3f(10.,9.7,9.2)*nl/lightPdf*mis(lightPdf,brdf.w);}}
   }else{
    let wi=sampleEnvironment(&seed);let nl=max(dot(n,wi),0.);let pdf=(1.-areaSelection())*environmentPDF(wi);
    if(nl>0.&&dot(geometricNormal,wi)>0.){let start=point+geometricNormal*.0001;let shadow=trace(start,wi,1e20,true);if(shadow.id==-1&&lightHit(start,wi)>1e19){let brdf=bsdf(n,wo,wi,color,metal,alpha,m.physical.w);radiance+=throughput*brdf.rgb*environment(wi)*nl/pdf*mis(pdf,brdf.w);}}
   }
   let probability=select(specularProbability(color,metal,nv),0.,m.physical.w>.5);if(random(&seed)<probability){let h=visibleGGX(n,wo,alpha,vec2f(random(&seed),random(&seed)));direction=reflect(-wo,h);
   }else{let r=sqrt(random(&seed));let phi=2.*PI*random(&seed);direction=normalize(basis(n,vec3f(r*cos(phi),r*sin(phi),sqrt(max(0.,1.-r*r)))));}
   let sampled=bsdf(n,wo,direction,color,metal,alpha,m.physical.w);if(sampled.w<=0.||dot(direction,geometricNormal)<=0.){break;}previousPdf=sampled.w;throughput*=sampled.rgb*max(dot(n,direction),0.)/sampled.w;
   delta=false;
  }
  origin=point+geometricNormal*select(-.0001,.0001,dot(direction,geometricNormal)>0.);
  if(bounce>=3u&&!(u.previousUp.w>.5&&delta)){let survival=clamp(max(max(throughput.x,throughput.y),throughput.z),.05,.95);if(random(&seed)>survival){break;}throughput/=survival;}
 }
 if(!pending){break;}
 // Splitting is restricted to bounce zero, whose incident stack is empty.
 // Do not copy a second 16-entry medium stack per pixel (register spilling).
 pending=false;origin=pendingOrigin;direction=pendingDirection;throughput=pendingThroughput;medium=pendingMedium;ior=pendingIor;media.count=0u;startDepth=pendingDepth;delta=true;previousPdf=0.;trackReflection=false;
 }
 // No firefly clamping in reference transport. Interactive reconstruction is separate.
 let luminance=dot(radiance,vec3f(.2126,.7152,.0722));
 samples[index]=Pixel(vec4f(radiance,1),guidePos,guideNormal,vec4f(luminance,luminance*luminance,reflectionDistance,reflectionGuide),secondary,secondaryNormal);
}
