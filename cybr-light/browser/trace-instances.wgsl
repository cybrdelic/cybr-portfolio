// Pile-only traversal. Keep the checkpoint's transport/shading code shared.
fn rotateInstance(q:vec4f,v:vec3f)->vec3f{return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn instanceNormal(h:Hit,n:vec3f)->vec3f{if(h.instance==0u){return n;}return rotateInstance(normalize(nodes[h.instance].high),n);}
fn instanceIdentity(h:Hit)->u32{if(h.instance==0u){return 0u;}return nodes[h.instance].links.y&0xffffffu;}
fn localTrace(o:vec3f,d:vec3f,limit:f32,anyHit:bool,root:u32,instance:u32)->Hit{
 var hit=Hit(limit,-1,vec2f(0),instance);let inv=select(vec3f(-1),vec3f(1),d>=vec3f(0))/max(abs(d),vec3f(1e-10));var stack:array<u32,64>;var count=1u;stack[0]=root;
 loop {if(count==0u){break;}count--;let ni=stack[count];let node=nodes[ni];let range=boxDistance(node,o,inv);if(range.y<range.x||range.x>=hit.t){continue;}
  if(node.links.w>0u){for(var k=0u;k<node.links.w;k++){let id=node.links.z+k;let tr=triangles[id];if(u32(tr.e1.w)!=0u&&(u32(tr.e1.w)&(nodes[instance].links.y>>24u))==0u){continue;}let p=cross(d,tr.e2.xyz);let det=dot(tr.e1.xyz,p);if(abs(det)<1e-10){continue;}let r=1.0/det;let s=o-tr.p.xyz;let x=dot(s,p)*r;if(x<0.0||x>1.0){continue;}let q=cross(s,tr.e1.xyz);let y=dot(d,q)*r;if(y<0.0||x+y>1.0){continue;}let t=dot(tr.e2.xyz,q)*r;if(t>0.00001&&t<hit.t){hit=Hit(t,i32(id),vec2f(x,y),instance);if(anyHit){return hit;}}}
  }else{let a=boxDistance(nodes[node.links.x],o,inv);let b=boxDistance(nodes[node.links.y],o,inv);let av=a.y>=a.x&&a.x<hit.t;let bv=b.y>=b.x&&b.x<hit.t;if(av&&bv){stack[count]=select(node.links.x,node.links.y,a.x<b.x);stack[count+1u]=select(node.links.y,node.links.x,a.x<b.x);count+=2u;}else if(av){stack[count]=node.links.x;count++;}else if(bv){stack[count]=node.links.y;count++;}}
 }
 return hit;
}
fn trace(o:vec3f,d:vec3f,limit:f32,anyHit:bool)->Hit{
 var hit=Hit(limit,-1,vec2f(0),0u);let inv=select(vec3f(-1),vec3f(1),d>=vec3f(0))/max(abs(d),vec3f(1e-10));var stack:array<u32,64>;var count=1u;stack[0]=0u;
 loop{if(count==0u){break;}count--;let node=nodes[stack[count]];let range=boxDistance(node,o,inv);if(range.y<range.x||range.x>=hit.t){continue;}
  if((node.links.w&0x80000000u)!=0u){
   for(var k=0u;k<(node.links.w&0x7fffffffu);k++){
    let instance=node.links.z+k;let transform=nodes[instance];let scale=dot(transform.high,transform.high);let rotation=normalize(transform.high);let inverse=vec4f(-rotation.xyz,rotation.w);
    let localO=rotateInstance(inverse,o-transform.low.xyz)/scale;let localD=rotateInstance(inverse,d)/scale;
    // Selected once per instance when the camera changes, never per ray.
    let root=transform.links.w;
    let candidate=localTrace(localO,localD,hit.t,anyHit,root,instance);
    if(candidate.id>=0){hit=candidate;if(anyHit){return hit;}}
   }
  }else{let a=boxDistance(nodes[node.links.x],o,inv);let b=boxDistance(nodes[node.links.y],o,inv);let av=a.y>=a.x&&a.x<hit.t;let bv=b.y>=b.x&&b.x<hit.t;if(av&&bv){stack[count]=select(node.links.x,node.links.y,a.x<b.x);stack[count+1u]=select(node.links.y,node.links.x,a.x<b.x);count+=2u;}else if(av){stack[count]=node.links.x;count++;}else if(bv){stack[count]=node.links.y;count++;}}
 }
 if(lighting.info.x<.5&&abs(d.y)>1e-8){let t=(u.eye.w-o.y)/d.y;if(t>0.00001&&t<hit.t){hit=Hit(t,-2,vec2f(0),0u);}}
 return hit;
}
