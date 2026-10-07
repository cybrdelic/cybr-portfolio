"""Validated host adapter for the restricted shared CPU/CUDA transport program."""
from pathlib import Path
import json,os,time
import numpy as np
from . import vec,normalized
from .workflow import UnsupportedFeatureError,write_pfm,validate_scene

def pack_scene(scene):
    validate_scene(scene)
    c=scene.settings
    if c.polarized or c.ad or scene.volumes:raise UnsupportedFeatureError("Portable backend is scalar surface transport only")
    if c.integrator!='path' or c.filter!='box' or c.sampler!=0 or not c.mis or not c.nee or c.rr_depth!=5 or c.max_depth<1:raise UnsupportedFeatureError("Portable backend requires finite-depth path transport, box filter, independent samples, MIS/NEE and rr_depth=5")
    if scene.environment.get('texture') or scene.environment.get('lobes'):raise UnsupportedFeatureError("Portable backend supports analytic base environments only")
    if scene.observer_path:raise UnsupportedFeatureError("Portable backend currently uses the analytic observer")
    types={'diffuse':0,'glass':1,'mirror':2,'emitter':3,'null':5,'metal':6,'plastic':7,'roughglass':8,'thindielectric':9,'difftrans':10}
    materials=np.zeros((len(scene.materials),20))
    for i,m in enumerate(scene.materials):
        if m.film_nm>0:raise UnsupportedFeatureError('Dielectric coatings currently require the native CPU renderer')
        if m.scattering:raise UnsupportedFeatureError('Interior scattering requires the native renderer')
        if m.type not in types or m.texture or m.roughness_texture or m.shader or m.spectra or m.checker:raise UnsupportedFeatureError(f"Unsupported portable BSDF/features on {m.name}: {m.type}")
        materials[i]=[types[m.type],*vec(m.color),m.ior_a,m.emission,m.kelvin,m.ior_b,*vec(m.eta),*vec(m.k),*vec(m.absorption),m.alpha_u or max(.002,m.roughness*m.roughness),m.alpha_v or (m.alpha_u or max(.002,m.roughness*m.roughness)),float(m.two_sided)]
    primitives=np.zeros((len(scene.primitives),26));types={'sphere':0,'triangle':1,'quad':2,'disk':3,'cylinder':4}
    for i,p in enumerate(scene.primitives):
        if p.get('vertex_albedo') is not None:raise UnsupportedFeatureError('Vertex material attributes require the native renderer')
        if p['type'] not in types:raise UnsupportedFeatureError("Unsupported portable geometry")

        row=primitives[i];row[0]=types[p['type']];row[1]=p['material'];row[2]=p['object'];row[13:16]=p['velocity']
        if p['type']=='sphere':row[3:6]=p['center'];row[12]=p['radius']
        elif p['type']=='quad':row[3:6]=p['corner'];row[6:9]=p['u'];row[9:12]=p['v']
        elif p['type']=='triangle':
            row[3:12]=np.asarray(p['vertices']).ravel();row[16:25]=np.asarray(p['normals']).ravel();row[25]=float(p['smooth'])
        else:row[3:6]=p['a'];row[6:9]=p['b'];row[12]=p['radius']
    # Threaded BVH has no traversal stack or per-thread stack overflow. A
    # separate, checked optical medium stack admits up to 64 nested boundaries.
    # Camera initial media are deliberately restricted rather than guessed.
    starts=np.zeros((len(primitives),3));ends=starts.copy();centers=starts.copy()
    for i,p in enumerate(scene.primitives):
        kind=p['type']
        if kind=='sphere':lo=np.asarray(p['center'])-p['radius'];hi=np.asarray(p['center'])+p['radius']
        elif kind=='quad':
            a=np.asarray(p['corner']);u=np.asarray(p['u']);v=np.asarray(p['v']);vertices=np.array([a,a+u,a+v,a+u+v]);lo=vertices.min(0);hi=vertices.max(0)
        elif kind=='triangle':lo=np.min(p['vertices'],0);hi=np.max(p['vertices'],0)
        elif kind=='disk':lo=np.asarray(p['a'])-p['radius'];hi=np.asarray(p['a'])+p['radius']
        else:lo=np.minimum(p['a'],p['b'])-p['radius'];hi=np.maximum(p['a'],p['b'])+p['radius']
        velocity=np.asarray(p['velocity']);motion_a=velocity*scene.camera.shutter_open;motion_b=velocity*scene.camera.shutter_close
        starts[i]=lo+np.minimum(motion_a,motion_b)-1e-7;ends[i]=hi+np.maximum(motion_a,motion_b)+1e-7;centers[i]=(starts[i]+ends[i])*.5
        if scene.materials[p['material']].type in ('glass','roughglass'):
            camera=np.asarray(scene.camera.origin);r=scene.camera.aperture
            if np.all(camera+r>=starts[i]) and np.all(camera-r<=ends[i]):raise UnsupportedFeatureError('Portable camera initial medium is not inferred; start camera/aperture outside dielectric primitive bounds')
    packed=[];emitting=[]
    def build(indices):
        if len(indices)<=4:
            for i in indices:
                if scene.materials[scene.primitives[i]['material']].emission>0:emitting.append(len(packed))
                packed.append(primitives[i].copy())
            return
        node=np.zeros(26);node[0]=-1;node[3:6]=starts[indices].min(0);node[6:9]=ends[indices].max(0);packed.append(node)
        axis=np.argmax(np.ptp(centers[indices],axis=0));order=indices[np.argsort(centers[indices,axis],kind='stable')];split=len(order)//2
        build(order[:split]);build(order[split:]);node[1]=len(packed)
    build(np.arange(len(primitives)));primitives=np.asarray(packed,dtype=np.float64).reshape(-1,26);emitters=np.asarray(emitting,dtype=np.int64)
    lights=np.asarray([[l['kind'],*l['position'],*l['direction'],*l['intensity'],l['scale'],l['cutoff'],l['beam']] for l in scene.delta_lights],dtype=float).reshape(-1,13)
    E=np.array([*scene.environment['color'],scene.environment['strength'],float(scene.environment.get('flat',False))])
    camera=scene.camera;forward=normalized(np.asarray(camera.target)-camera.origin);right=normalized(np.cross(forward,camera.up));top=np.cross(right,forward)
    C=np.array([*camera.origin,*forward,*right,*top,np.tan(np.radians(camera.fov/2)),camera.aperture,camera.focus,camera.shutter_open,camera.shutter_close,float(camera.orthographic),camera.ortho_scale,float(camera.spherical)])
    return primitives,materials,emitters,lights,E,C

def render_portable(scene,output,*,backend='cpu'):
    if backend not in ('cpu','cuda'):raise ValueError("backend must be cpu or cuda")
    if backend=='cuda':os.environ['CYBR_PORTABLE_TARGET']='cuda'
    from . import portable_kernel as kernel
    if kernel.TARGET!=backend:raise RuntimeError("Select the portable target before importing its kernel; use a new process to change target")
    arrays=pack_scene(scene);c=scene.settings;result=np.zeros((c.width*c.height,3));start=time.perf_counter()
    if backend=='cpu':
        from numba import set_num_threads
        set_num_threads(c.threads)
        kernel.render_kernel(*arrays,c.width,c.height,c.spp,c.bands,c.max_depth,c.seed,result);simulated=False
    else:
        from numba import cuda,config
        simulated=bool(config.ENABLE_CUDASIM)
        if not cuda.is_available():raise RuntimeError("No CUDA device is available. CUDA simulation is a separate, explicitly selected test mode.")
        data=[cuda.to_device(a) for a in arrays];image=cuda.device_array(result.shape,dtype=np.float64)
        kernel.render_kernel[(len(result)+127)//128,128](*data,c.width,c.height,c.spp,c.bands,c.max_depth,c.seed,image)
        cuda.synchronize();image.copy_to_host(result)
    seconds=time.perf_counter()-start;image=result.reshape(c.height,c.width,3)
    if not np.isfinite(image).all():raise FloatingPointError("Nonfinite portable render")
    output=Path(output);write_pfm(output.with_suffix('.pfm'),image)
    from PIL import Image
    value=np.maximum(image*c.exposure,0);value=np.clip(value*(2.51*value+.03)/(value*(2.43*value+.59)+.14),0,1);value=np.where(value<=.0031308,12.92*value,1.055*value**(1/2.4)-.055)
    Image.fromarray(np.uint8(np.rint(value*255))).save(output.with_suffix('.png'))
    report={'backend':'CUDA simulator on CPU' if simulated else ('Numba CPU JIT' if backend=='cpu' else 'CUDA GPU'),
            'simulated':simulated,'gpu_execution':backend=='cuda' and not simulated,
            'width':c.width,'height':c.height,'packets_per_pixel':c.spp,'wavelengths_per_packet':c.bands,'seconds_including_first_compilation':seconds,
            'scope':'surface spectral MIS path tracing; diffuse, anisotropic GGX conductor/plastic/dielectric, ideal and thin dielectrics, diffuse transmission, null sheets; smooth triangles and analytic primitives; threaded motion BVH; up to 64 nested media; camera starts outside dielectric bounds',
            'hardware_cuda_validation':'not established by simulator execution'}
    output.with_suffix('.json').write_text(json.dumps(report,indent=2));return image,report
