"""One scalar spectral transport program for Numba CPU and CUDA targets.

Set CYBR_PORTABLE_TARGET=cuda before import to select CUDA. The simulator must
be explicitly enabled by the caller; it is never represented as GPU execution.
"""
import os,math
import numpy as np
from numba import njit,prange
TARGET=os.environ.get('CYBR_PORTABLE_TARGET','cpu')
if TARGET=='cuda':
    from numba import cuda
    device=lambda fn:cuda.jit(device=True)(fn)
else:
    device=lambda fn:njit(fn)
PI=math.pi

@device
def add(a,b):return (a[0]+b[0],a[1]+b[1],a[2]+b[2])
@device
def sub(a,b):return (a[0]-b[0],a[1]-b[1],a[2]-b[2])
@device
def mul(a,s):return (a[0]*s,a[1]*s,a[2]*s)
@device
def dot(a,b):return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
@device
def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
@device
def unit(a):return mul(a,1/math.sqrt(max(1e-30,dot(a,a))))
@device
def reflect(incident,n):return sub(incident,mul(n,2*dot(incident,n)))
@device
def frame(n,v):
    x=unit(cross((0.,0.,1.) if abs(n[2])<.999 else (0.,1.,0.),n));y=cross(n,x)
    return add(add(mul(x,v[0]),mul(y,v[1])),mul(n,v[2]))
@device
def random(state):
    state=(1664525*state+1013904223)&4294967295
    return state,(state+.5)/4294967296.
@device
def cosine(n,state):
    state,a=random(state);state,b=random(state);r=math.sqrt(b);phi=2*PI*a
    return frame(n,(r*math.cos(phi),r*math.sin(phi),math.sqrt(1-b))),state
@device
def sphere_sample(state):
    state,a=random(state);state,b=random(state);z=1-2*a;r=math.sqrt(max(0.,1-z*z));phi=2*PI*b
    return (r*math.cos(phi),r*math.sin(phi),z),state
@device
def spectrum(r,g,b,nm):
    x=math.exp(-.5*((nm-610)/43)**2);y=math.exp(-.5*((nm-545)/34)**2);z=math.exp(-.5*((nm-450)/27)**2)
    return (r*x+g*y+b*z)/(x+y+z+1e-30)
@device
def spectral(m,start,nm):return spectrum(m[start],m[start+1],m[start+2],nm)
@device
def blackbody(nm,kelvin):
    if kelvin<=0:return 1.
    return (560/nm)**5*math.expm1(.01438776877/(560e-9*kelvin))/math.expm1(.01438776877/(nm*1e-9*kelvin))
@device
def fresnel(c,ni,nt):
    c=min(1.,abs(c));s=(ni/nt)**2*(1-c*c)
    if s>=1:return 1.
    t=math.sqrt(1-s);a=(ni*c-nt*t)/(ni*c+nt*t);b=(nt*c-ni*t)/(nt*c+ni*t)
    return .5*(a*a+b*b)
@device
def conductor(c,eta,k):
    c=min(1.,abs(c));c2=c*c;s2=1-c2;t0=eta*eta-k*k-s2;a2b2=math.sqrt(t0*t0+4*eta*eta*k*k);a=math.sqrt(max(0.,.5*(a2b2+t0)))
    t1=a2b2+c2;t2=2*c*a;rs=(t1-t2)/(t1+t2);t3=c2*a2b2+s2*s2;t4=t2*s2
    return max(0.,min(1.,.5*(rs+rs*(t3-t4)/(t3+t4+1e-30))))
@device
def hit_one(p,origin,direction,time,limit):
    kind=int(p[0]);a=(p[3],p[4],p[5]);b=(p[6],p[7],p[8]);c=(p[9],p[10],p[11]);o=sub(origin,mul((p[13],p[14],p[15]),time));t=limit;n=(0.,1.,0.)
    if kind==0:
        q=sub(o,a);B=dot(q,direction);C=dot(q,q)-p[12]**2;disc=B*B-C
        if disc<0:return limit,n
        root=math.sqrt(disc);t=-B-root
        if t<=1e-6:t=-B+root
        if t<=1e-6 or t>=limit:return limit,n
        return t,mul(sub(add(o,mul(direction,t)),a),1/p[12])
    if kind==1 or kind==2:
        e1=sub(b,a) if kind==1 else b;e2=sub(c,a) if kind==1 else c
        h=cross(direction,e2);det=dot(e1,h)
        if abs(det)<1e-14:return limit,n
        q=sub(o,a);u=dot(q,h)/det
        if u<0 or u>1:return limit,n
        k=cross(q,e1);v=dot(direction,k)/det
        if v<0 or v>(1-u if kind==1 else 1):return limit,n
        t=dot(e2,k)/det
        if t<=1e-6 or t>=limit:return limit,n
        return t,unit(cross(e1,e2))
    if kind==3:
        n=unit(b);den=dot(direction,n)
        if abs(den)<1e-14:return limit,n
        t=dot(sub(a,o),n)/den
        if t<=1e-6 or t>=limit:return limit,n
        q=sub(add(o,mul(direction,t)),a)
        return (t if dot(q,q)<=p[12]**2 else limit),n
    # Exact finite cylindrical side; caps are independently represented disks.
    axis=unit(sub(b,a));q=sub(o,a);od=dot(q,axis);dd=dot(direction,axis);op=sub(q,mul(axis,od));dp=sub(direction,mul(axis,dd));A=dot(dp,dp);B=dot(op,dp);C=dot(op,op)-p[12]**2;disc=B*B-A*C
    if A<1e-20 or disc<0:return limit,n
    length=math.sqrt(dot(sub(b,a),sub(b,a)));root=math.sqrt(disc)
    for j in range(2):
        t=(-B+(-root if j==0 else root))/A;z=od+t*dd
        if t>1e-6 and t<limit and z>=0 and z<=length:return t,unit(add(op,mul(dp,t)))
    return limit,n
@device
def bounds_hit(p,o,d,limit):
    near=0.;far=limit
    for j in range(3):
        if abs(d[j])<1e-20:
            if o[j]<p[3+j] or o[j]>p[6+j]:return False
        else:
            a=(p[3+j]-o[j])/d[j];b=(p[6+j]-o[j])/d[j]
            near=max(near,min(a,b));far=min(far,max(a,b))
            if near>far:return False
    return True
@device
def intersect(P,o,d,time,limit):
    which=-1;normal=(0.,1.,0.);distance=limit;i=0
    while i<P.shape[0]:
        if P[i,0]<0:
            i=i+1 if bounds_hit(P[i],o,d,distance) else int(P[i,1])
            continue
        t,n=hit_one(P[i],o,d,time,distance)
        if t<distance:which=i;distance=t;normal=n
        i+=1
    return which,distance,normal
@device
def shading_normal(p,point,time,gn):
    if int(p[0])!=1 or p[25]<.5:return gn
    a=(p[3],p[4],p[5]);b=(p[6],p[7],p[8]);c=(p[9],p[10],p[11]);q=sub(sub(point,mul((p[13],p[14],p[15]),time)),a)
    u=sub(b,a);v=sub(c,a);aa=dot(u,u);ab=dot(u,v);bb=dot(v,v);den=max(1e-30,aa*bb-ab*ab)
    x=(dot(q,u)*bb-dot(q,v)*ab)/den;y=(dot(q,v)*aa-dot(q,u)*ab)/den
    n=unit(add(add(mul((p[16],p[17],p[18]),1-x-y),mul((p[19],p[20],p[21]),x)),mul((p[22],p[23],p[24]),y)))
    return n if dot(n,gn)>=0 else mul(n,-1)
@device
def area(p):
    kind=int(p[0]);a=(p[3],p[4],p[5]);b=(p[6],p[7],p[8]);c=(p[9],p[10],p[11])
    if kind==0:return 4*PI*p[12]**2
    if kind==3:return PI*p[12]**2
    if kind==4:return 2*PI*p[12]*math.sqrt(dot(sub(b,a),sub(b,a)))
    v=cross(sub(b,a),sub(c,a)) if kind==1 else cross(b,c)
    return math.sqrt(dot(v,v))*(.5 if kind==1 else 1)
@device
def sample_shape(p,state,time):
    kind=int(p[0]);a=(p[3],p[4],p[5]);b=(p[6],p[7],p[8]);c=(p[9],p[10],p[11])
    state,u=random(state);state,v=random(state)
    if kind==0:
        n,state=sphere_sample(state);point=add(a,mul(n,p[12]))
    elif kind==1:
        r=math.sqrt(u);point=add(add(mul(a,1-r),mul(b,r*(1-v))),mul(c,r*v));n=unit(cross(sub(b,a),sub(c,a)))
    elif kind==2:point=add(add(a,mul(b,u)),mul(c,v));n=unit(cross(b,c))
    elif kind==3:
        n=unit(b);r=p[12]*math.sqrt(u);point=add(a,frame(n,(r*math.cos(2*PI*v),r*math.sin(2*PI*v),0.)))
    else:
        axis=unit(sub(b,a));n=frame(axis,(math.cos(2*PI*v),math.sin(2*PI*v),0.));point=add(add(a,mul(sub(b,a),u)),mul(n,p[12]))
    return add(point,mul((p[13],p[14],p[15]),time)),n,state
@device
def environment(E,d,nm):return E[3]*spectrum(E[0],E[1],E[2],nm)*(1 if E[4]>0 else .3+.7*max(0.,d[1]))
@device
def shadow(P,M,o,d,time,dist,nm):
    value=1.;probability=1.
    for count in range(1024):
        i,t,n=intersect(P,o,d,time,dist-2e-5)
        if i<0:return value,probability
        m=M[int(P[i,1])];kind=int(m[0])
        if kind==5:value*=spectral(m,1,nm)
        elif kind==9:
            f=fresnel(abs(dot(n,d)),1,m[4]+m[7]/((nm*.001)**2));tr=1-2*f/(1+f);value*=tr;probability*=tr
        else:return 0.,0.
        o=add(add(o,mul(d,t)),mul(d,3e-6));dist-=t+3e-6
    return math.nan,math.nan
@device
def mis(a,b):return a*a/(a*a+b*b+1e-300)
@device
def light(P,M,emitters,D,E,point,time,nm,state):
    env=int(E[3]>0);count=emitters.shape[0]+D.shape[0]+env
    if count==0:return (0.,1.,0.),1e30,0.,0.,False,state
    state,u=random(state);index=min(count-1,int(u*count));selection=1./count
    if index<emitters.shape[0]:
        shape=int(emitters[index]);q,n,state=sample_shape(P[shape],state,time);v=sub(q,point);dist=math.sqrt(dot(v,v));wi=mul(v,1/max(dist,1e-15));cosine=dot(n,mul(wi,-1));m=M[int(P[shape,1])]
        if cosine<=0:return wi,dist,0.,0.,False,state
        return wi,dist,selection*dist*dist/(cosine*area(P[shape])),m[5]*spectral(m,1,nm)*blackbody(nm,m[6]),False,state
    index-=emitters.shape[0]
    if index<D.shape[0]:
        l=D[index];kind=int(l[0]);direction=(l[4],l[5],l[6]);power=spectrum(l[7],l[8],l[9],nm)*l[10]
        if kind==1:return mul(direction,-1),1e30,selection,power,True,state
        v=sub((l[1],l[2],l[3]),point);dist=math.sqrt(dot(v,v));wi=mul(v,1/max(dist,1e-15));falloff=1.
        if kind==2:
            c=dot(direction,mul(wi,-1));a=math.cos(l[11]);b=math.cos(l[12]);falloff=max(0.,min(1.,(c-a)/max(1e-15,b-a)))
        return wi,dist,selection,power*falloff/max(1e-15,dist*dist),True,state
    wi,state=sphere_sample(state);return wi,1e30,selection/(4*PI),environment(E,wi,nm),False,state
@device
def local(n,v):
    x=unit(cross((0.,0.,1.) if abs(n[2])<.999 else (0.,1.,0.),n));y=cross(n,x)
    return dot(v,x),dot(v,y),dot(v,n)
@device
def ggx_distribution(h,ax,ay):
    if h[2]<=0:return 0.
    den=(h[0]/ax)**2+(h[1]/ay)**2+h[2]*h[2]
    return 1/(PI*ax*ay*den*den)
@device
def ggx_lambda(v,ax,ay):
    if abs(v[2])<1e-15:return 1e30
    return .5*(math.sqrt(1+((ax*v[0])**2+(ay*v[1])**2)/(v[2]*v[2]))-1)
@device
def visible_ggx(view,ax,ay,state):
    v=unit((ax*view[0],ay*view[1],view[2]));q=v[0]*v[0]+v[1]*v[1]
    tangent=mul((-v[1],v[0],0.),1/math.sqrt(q)) if q>1e-20 else (1.,0.,0.);bitangent=cross(v,tangent)
    state,u=random(state);state,z=random(state);radius=math.sqrt(u);phi=2*PI*z;a=radius*math.cos(phi);b=radius*math.sin(phi);blend=.5*(1+v[2])
    b=(1-blend)*math.sqrt(max(0.,1-a*a))+blend*b
    h=add(add(mul(tangent,a),mul(bitangent,b)),mul(v,math.sqrt(max(0.,1-a*a-b*b))))
    return unit((ax*h[0],ay*h[1],max(1e-12,h[2]))),state
@device
def bsdf_evaluate(m,n,wo,wi,nm,ni,nt):
    kind=int(m[0]);co=dot(n,wo);ci=dot(n,wi)
    if co<=0 or abs(ci)<1e-12:return 0.,0.
    if kind==0 or kind==10:
        if (kind==0 and ci<=0) or (kind==10 and ci>=0):return 0.,0.
        return spectral(m,1,nm)/PI,abs(ci)/PI
    if kind!=6 and kind!=7 and kind!=8:return 0.,0.
    ax=m[17];ay=m[18];vo=local(n,wo);vi=local(n,wi)
    if kind==6 or kind==7:
        if ci<=0:return 0.,0.
        h=unit(add(wo,wi));vh=dot(wo,h)
        if dot(n,h)<=0 or vh<=0:return 0.,0.
        D=ggx_distribution(local(n,h),ax,ay);G1=1/(1+ggx_lambda(vo,ax,ay));G=1/(1+ggx_lambda(vo,ax,ay)+ggx_lambda(vi,ax,ay))
        F=conductor(vh,spectral(m,8,nm),spectral(m,11,nm)) if kind==6 else fresnel(vh,1,m[4]+m[7]/((nm*.001)**2))
        value=F*D*G/(4*co*ci);pdf=D*G1/(4*co)
        if kind==7:
            eta=m[4]+m[7]/((nm*.001)**2);value+=spectral(m,1,nm)*(1-fresnel(co,1,eta))*(1-fresnel(ci,1,eta))/PI;pdf=.5*pdf+.5*ci/PI
        return value,pdf
    reflection=ci>0;ratio=nt/ni;h=unit(add(wo,mul(wi,1 if reflection else ratio)))
    if dot(n,h)<0:h=mul(h,-1)
    oh=dot(wo,h);ih=dot(wi,h)
    if oh*co<=0 or ih*ci<=0:return 0.,0.
    D=ggx_distribution(local(n,h),ax,ay);G=1/(1+ggx_lambda(vo,ax,ay)+ggx_lambda(vi,ax,ay));F=fresnel(oh,ni,nt);ph=D/(1+ggx_lambda(vo,ax,ay))*abs(oh)/abs(co)
    if reflection:return F*D*G/(4*abs(co*ci)),F*ph/(4*abs(oh))
    den=(ih+oh/ratio)**2
    if den<1e-22:return 0.,0.
    return (1-F)*D*G*abs(ih*oh/(ci*co*den))/(ratio*ratio),(1-F)*ph*abs(ih)/den
@device
def bsdf_sample(m,n,wo,nm,ni,nt,state):
    kind=int(m[0]);wi=(0.,0.,0.);weight=0.;pdf=0.;delta=False;transmission=False;transition=False
    if kind==5:return mul(wo,-1),spectral(m,1,nm),1.,True,True,False,state
    if kind==9:
        F=fresnel(dot(wo,n),1,m[4]+m[7]/((nm*.001)**2));F=2*F/(1+F);state,u=random(state);transmission=u>=F
        return (mul(wo,-1) if transmission else reflect(mul(wo,-1),n)),1.,(1-F if transmission else F),True,transmission,False,state
    if kind==2:return reflect(mul(wo,-1),n),conductor(dot(wo,n),spectral(m,8,nm),spectral(m,11,nm)),1.,True,False,False,state
    if kind==1:
        co=dot(wo,n);F=fresnel(co,ni,nt);state,u=random(state)
        if u<F:return reflect(mul(wo,-1),n),1.,F,True,False,False,state
        eta=ni/nt;k=1-eta*eta*(1-co*co)
        if k<0:return wi,0.,0.,True,False,False,state
        return unit(add(mul(wo,-eta),mul(n,eta*co-math.sqrt(k)))),eta*eta,1-F,True,True,True,state
    choose_diffuse=kind==0 or kind==10
    if kind==7:state,u=random(state);choose_diffuse=u<.5
    if choose_diffuse:
        wi,state=cosine(n,state)
        if kind==10:wi=mul(wi,-1);transmission=True
    elif kind==6 or kind==7 or kind==8:
        h,state=visible_ggx(local(n,wo),m[17],m[18],state);h=frame(n,h)
        refract_event=False
        if kind==8:state,u=random(state);refract_event=u>=fresnel(dot(wo,h),ni,nt)
        if refract_event:
            eta=ni/nt;co=dot(wo,h);k=1-eta*eta*(1-co*co)
            if k<0:return wi,0.,0.,False,False,False,state
            wi=unit(add(mul(wo,-eta),mul(h,eta*co-math.sqrt(k))));transmission=True;transition=True
        else:wi=reflect(mul(wo,-1),h)
    value,pdf=bsdf_evaluate(m,n,wo,wi,nm,ni,nt)
    if pdf>0:weight=value*abs(dot(n,wi))/pdf
    return wi,weight,pdf,delta,transmission,transition,state

if TARGET=='cuda':
    @cuda.jit(device=True,inline=True)
    def medium_storage():return cuda.local.array((2,64),dtype=np.int64)
else:
    @njit
    def medium_storage():return np.empty((2,64),dtype=np.int64)

@device
def trace(P,M,emitters,D,E,o,d,time,nm,state,max_depth):
    beta=1.;L=0.;last_delta=True;last_pdf=0.;last_point=o;nulls=0;depth=0;stack=medium_storage();stack_size=0
    lights_count=emitters.shape[0]+D.shape[0]+int(E[3]>0)
    while depth<=max_depth:
        i,t,gn=intersect(P,o,d,time,1e30)
        if stack_size>0:beta*=math.exp(-spectral(M[stack[1,stack_size-1]],14,nm)*t)
        if i<0:
            pdf=(1./lights_count)/(4*PI) if lights_count>0 else 0.
            L+=beta*environment(E,d,nm)*(1 if last_delta else mis(last_pdf,pdf));break
        point=add(o,mul(d,t));front=dot(d,gn)<0;n=shading_normal(P[i],point,time,gn)
        if not front:gn=mul(gn,-1);n=mul(n,-1)
        material_id=int(P[i,1]);object_id=int(P[i,2]);m=M[material_id];kind=int(m[0]);wo=mul(d,-1)
        if m[5]>0 and front:
            lp=0.
            if lights_count>0:lp=dot(sub(point,last_point),sub(point,last_point))/(max(1e-15,dot(gn,wo))*area(P[i])*lights_count)
            L+=beta*m[5]*spectral(m,1,nm)*blackbody(nm,m[6])*(1 if last_delta else mis(last_pdf,lp))
        if kind==3 or (m[19]<.5 and not front and kind!=1 and kind!=8):break
        ni=1.;nt=1.;exit_index=-1
        if stack_size>0:
            current=M[stack[1,stack_size-1]];ni=current[4]+current[7]/((nm*.001)**2)
        nt=ni
        if kind==1 or kind==8:
            eta=m[4]+m[7]/((nm*.001)**2)
            if front:nt=eta
            else:
                for k in range(stack_size-1,-1,-1):
                    if stack[0,k]==object_id:exit_index=k;break
                if exit_index>=0:
                    nt=1.
                    if exit_index>0:
                        enclosing=M[stack[1,exit_index-1]];nt=enclosing[4]+enclosing[7]/((nm*.001)**2)
                else:ni=eta
        terminal=depth>=max_depth
        if not terminal and (kind==0 or kind==6 or kind==7 or kind==8 or kind==10):
            wi,dist,pdf,Le,delta,state=light(P,M,emitters,D,E,point,time,nm,state);f,bpdf=bsdf_evaluate(m,n,wo,wi,nm,ni,nt)
            if pdf>0 and f>0:
                tr,probability=shadow(P,M,add(point,mul(gn,3e-6 if dot(gn,wi)>0 else -3e-6)),wi,time,dist,nm)
                if stack_size>0:tr*=math.exp(-spectral(M[stack[1,stack_size-1]],14,nm)*dist)
                L+=beta*f*abs(dot(n,wi))*Le*tr/pdf*(1 if delta else mis(pdf,bpdf*probability))
        wi,weight,pdf,delta,transmission,transition,state=bsdf_sample(m,n,wo,nm,ni,nt,state)
        if pdf<=0 or weight<=0:break
        null_event=delta and transmission and not transition
        if terminal and not null_event:break
        beta*=weight
        if transition:
            if front:
                if stack_size>=64:return math.nan
                stack[0,stack_size]=object_id;stack[1,stack_size]=material_id;stack_size+=1
            elif exit_index>=0:
                for k in range(exit_index,stack_size-1):stack[0,k]=stack[0,k+1];stack[1,k]=stack[1,k+1]
                stack_size-=1
        d=wi;o=add(point,mul(gn,3e-6 if dot(gn,d)>0 else -3e-6))
        if null_event:
            last_pdf*=pdf;nulls+=1
            if nulls>1024:return math.nan
            continue
        last_delta=delta;last_pdf=pdf;last_point=point;depth+=1
        if depth>5:
            state,u=random(state)
            if u>.85:break
            beta/=.85
    return L
@device
def matching(nm):
    a=(nm-599.8)*(.0264 if nm<599.8 else .0323);b=(nm-442)*(.0624 if nm<442 else .0374);c=(nm-501.1)*(.049 if nm<501.1 else .0382)
    x=1.056*math.exp(-.5*a*a)+.362*math.exp(-.5*b*b)-.065*math.exp(-.5*c*c)
    a=(nm-568.8)*(.0213 if nm<568.8 else .0247);b=(nm-530.9)*(.0613 if nm<530.9 else .0322);y=.821*math.exp(-.5*a*a)+.286*math.exp(-.5*b*b)
    a=(nm-437)*(.0845 if nm<437 else .0278);b=(nm-459)*(.0385 if nm<459 else .0725);z=1.217*math.exp(-.5*a*a)+.681*math.exp(-.5*b*b)
    return x,y,z
@device
def pixel(index,P,M,emitters,D,E,C,width,height,spp,bands,depth,seed):
    x=index%width;y=index//width;origin=(C[0],C[1],C[2]);forward=(C[3],C[4],C[5]);right=(C[6],C[7],C[8]);top=(C[9],C[10],C[11]);xyz=(0.,0.,0.)
    for sample in range(spp):
        state=(seed+index*747796405+sample*2891336453)&4294967295;state,jx=random(state);state,jy=random(state);state,shift=random(state);state,t=random(state);time=C[15]+(C[16]-C[15])*t
        px=(2*(x+jx)/width-1)*width/height;py=1-2*(y+jy)/height;o=origin
        if C[17]>0:d=forward;o=add(origin,add(mul(right,px*C[18]*.5),mul(top,py*C[18]*.5)))
        elif C[19]>0:
            a=((x+jx)/width-.5)*2*PI;v=(y+jy)/height*PI;d=add(add(mul(forward,math.cos(a)*math.sin(v)),mul(right,math.sin(a)*math.sin(v))),mul(top,math.cos(v)))
        else:
            d=unit(add(forward,add(mul(right,px*C[12]),mul(top,py*C[12]))))
            if C[13]>0:
                focus=add(origin,mul(d,C[14]/dot(d,forward)));state,u=random(state);state,v=random(state);r=C[13]*math.sqrt(u);o=add(origin,add(mul(right,r*math.cos(2*PI*v)),mul(top,r*math.sin(2*PI*v))));d=unit(sub(focus,o))
        for band in range(bands):
            nm=360+(band+shift)*470/bands;value=trace(P,M,emitters,D,E,o,d,time,nm,state,depth);xyz=add(xyz,mul(matching(nm),value*470/(106.856917101*bands*spp)))
    return (3.2404542*xyz[0]-1.5371385*xyz[1]-.4985314*xyz[2],-.969266*xyz[0]+1.8760108*xyz[1]+.041556*xyz[2],.0556434*xyz[0]-.2040259*xyz[1]+1.0572252*xyz[2])

if TARGET=='cuda':
    @cuda.jit
    def render_kernel(P,M,emitters,D,E,C,width,height,spp,bands,depth,seed,output):
        i=cuda.grid(1)
        if i<width*height:
            result=pixel(i,P,M,emitters,D,E,C,width,height,spp,bands,depth,seed)
            output[i,0]=result[0];output[i,1]=result[1];output[i,2]=result[2]
else:
    @njit(parallel=True)
    def render_kernel(P,M,emitters,D,E,C,width,height,spp,bands,depth,seed,output):
        for i in prange(width*height):
            result=pixel(i,P,M,emitters,D,E,C,width,height,spp,bands,depth,seed)
            output[i,0]=result[0];output[i,1]=result[1];output[i,2]=result[2]
