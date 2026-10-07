"""Strict scene loading, validation, and parameter traversal.

The dictionary/XML loader accepts the documented scene vocabulary.
Unsupported parameters are rejected. Registration factories compile to native
CYBR geometry and materials rather than providing arbitrary plugin subclasses.
"""
from __future__ import annotations
from collections.abc import MutableMapping
from dataclasses import asdict, fields
from pathlib import Path
from typing import Any, Callable
import copy
import fnmatch
import hashlib
import json
import math
import shlex
import shutil
import xml.etree.ElementTree as ET
import numpy as np
from . import Scene, Material, Camera, Settings, vec, normalized

class UnsupportedFeatureError(ValueError):
    pass

class ScalarTransform4f:
    def __init__(self, matrix=None):
        m = np.eye(4) if matrix is None else np.array(matrix, dtype=float, copy=True)
        if m.shape != (4, 4) or not np.isfinite(m).all(): raise ValueError("Transform requires a finite 4x4 matrix")
        if not np.allclose(m[3], [0,0,0,1]) or abs(np.linalg.det(m[:3,:3])) < 1e-14: raise ValueError("Transform must be affine and nonsingular")
        self.matrix = m
    def __array__(self, dtype=None, copy=None):
        return np.asarray(self.matrix, dtype=dtype).copy() if copy else np.asarray(self.matrix, dtype=dtype)
    def __matmul__(self, other):
        if isinstance(other, ScalarTransform4f): return ScalarTransform4f(self.matrix @ other.matrix)
        a = np.asarray(other, dtype=float)
        if a.shape[-1] != 3: raise ValueError("Transform points must have 3 components")
        return a @ self.matrix[:3,:3].T + self.matrix[:3,3]
    def inverse(self): return ScalarTransform4f(np.linalg.inv(self.matrix))
    @staticmethod
    def translate(value):
        m = np.eye(4); m[:3,3] = vec(value); return ScalarTransform4f(m)
    @staticmethod
    def scale(value):
        m = np.eye(4); m[:3,:3] = np.diag(vec(value)); return ScalarTransform4f(m)
    @staticmethod
    def rotate(axis, angle):
        x,y,z = normalized(axis); c = math.cos(math.radians(angle)); s = math.sin(math.radians(angle)); C=1-c
        m=np.eye(4);m[:3,:3]=[[c+x*x*C,x*y*C-z*s,x*z*C+y*s],[y*x*C+z*s,c+y*y*C,y*z*C-x*s],[z*x*C-y*s,z*y*C+x*s,c+z*z*C]]
        return ScalarTransform4f(m)
    @staticmethod
    def look_at(origin, target, up=(0,1,0)):
        origin=np.asarray(vec(origin));f=normalized(np.asarray(vec(target))-origin)
        right=normalized(np.cross(up,f));top=np.cross(f,right);m=np.eye(4);m[:3,:3]=np.column_stack((right,top,f));m[:3,3]=origin
        return ScalarTransform4f(m)

_BSDF = {'diffuse','conductor','roughconductor','dielectric','roughdielectric','thindielectric','plastic','roughplastic',
         'null','difftrans','blendbsdf','mask','twosided','normalmap','bumpmap','polarizer','retarder'}
_SHAPE = {'sphere','rectangle','disk','cylinder','cube','obj','ply','instance','shapegroup'}
_CUSTOM_BSDF: dict[str, Callable] = {}
_CUSTOM_SHAPE: dict[str, Callable] = {}

def register_bsdf(name, factory):
    if name in _BSDF or name in _CUSTOM_BSDF: raise ValueError(f"BSDF already registered: {name}")
    if not callable(factory): raise TypeError("Plugin factory must be callable")
    _CUSTOM_BSDF[name] = factory

def register_shape(name, factory):
    if name in _SHAPE or name in _CUSTOM_SHAPE: raise ValueError(f"Shape already registered: {name}")
    if not callable(factory): raise TypeError("Plugin factory must be callable")
    _CUSTOM_SHAPE[name] = factory

def plugins():
    return {'bsdfs':sorted(_BSDF|_CUSTOM_BSDF.keys()), 'shapes':sorted(_SHAPE|_CUSTOM_SHAPE.keys()),
            'integrators':['path','volpath','direct','ao','photonmap','aov'],
            'emitters':['area','point','directional','spot','constant','envmap'],
            'sensors':['perspective','thinlens','orthographic','spherical'],
            'samplers':['independent','halton'], 'filters':['box','tent','gaussian','mitchell','lanczos'],
            'media':['homogeneous','heterogeneous'], 'phases':['isotropic','hg','rayleigh'],
            'textures':['bitmap','checkerboard'], 'spectra':['uniform','rgb','spectrum','blackbody']}

def _check(spec, allowed):
    extra=set(spec)-set(allowed)-{'type','id','_label'}
    if extra: raise UnsupportedFeatureError(f"{spec.get('type')}: unsupported properties {sorted(extra)}")

def _number(value):
    n=float(value)
    if not math.isfinite(n): raise ValueError("Expected finite number")
    return n

def _ior(value):
    known={'vacuum':1.0,'air':1.00028,'water':1.3330,'water ice':1.31,'bk7':1.5046,'diamond':2.419,'fused quartz':1.458,'acrylic glass':1.49}
    return _number(known[value] if isinstance(value,str) and value in known else value)

def write_pfm(path, data):
    a=np.asarray(data,dtype=np.float32)
    if a.ndim != 3 or a.shape[2] != 3 or not np.isfinite(a).all(): raise ValueError("Expected finite HxWx3 image")
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('wb') as f:
        f.write(f"PF\n{a.shape[1]} {a.shape[0]}\n-1\n".encode());f.write(np.flipud(a).astype('<f4').tobytes())
    return path

def _bitmap(path, raw=False):
    path=Path(path).resolve()
    if not path.is_file(): raise FileNotFoundError(path)
    if path.suffix.lower()=='.pfm': return str(path)
    if path.suffix.lower() in ('.exr','.hdr'):
        import os
        os.environ['OPENCV_IO_ENABLE_OPENEXR']='1'
        try:import cv2
        except ImportError as exc:raise UnsupportedFeatureError('HDR/EXR texture input requires the optional exr dependency') from exc
        data=cv2.imread(str(path),cv2.IMREAD_UNCHANGED)
        if data is None:raise ValueError('Could not decode HDR texture '+str(path))
        if data.ndim==2:data=np.repeat(data[...,None],3,axis=2)
        else:data=data[...,:3][...,::-1]
        if not np.isfinite(data).all() or np.min(data)<0:raise ValueError('Texture controls must be finite and nonnegative')
        raw=True
    else:
        from PIL import Image
        data=np.asarray(Image.open(path).convert('RGB'),dtype=float)/255
    if not raw: data=np.where(data<=.04045,data/12.92,((data+.055)/1.055)**2.4)
    cache=path.parent/'.cybr_cache';name=hashlib.sha256(path.read_bytes()+str(raw).encode()).hexdigest()[:24]+'.pfm'
    return str(write_pfm(cache/name,data))

class Compiler:
    def __init__(self, root, base):
        self.scene=Scene(root.get('id','dictionary_scene'));self.scene.asset_base=str(Path(base).resolve());self.base=Path(base).resolve()
        self.refs={k:v for k,v in root.items() if isinstance(v,dict)}
        for k,v in list(self.refs.items()):
            if 'id' in v: self.refs[v['id']]=v
        self.material_cache={};self.stack=set()
    def resolve(self,spec):
        if not isinstance(spec,dict): raise TypeError("Plugin must be a dictionary")
        seen=set()
        while spec.get('type')=='ref':
            _check(spec,{'id'});key=spec['id']
            if key in seen: raise ValueError("Cyclic reference")
            seen.add(key)
            if key not in self.refs: raise ValueError(f"Unknown reference: {key}")
            spec=self.refs[key]
        return spec
    def path(self,name): return str((self.base/str(name)).resolve())
    def spectral(self,value,material=None,parameter='color'):
        if isinstance(value,(float,int,list,tuple,np.ndarray)): return vec(value)
        value=self.resolve(value);kind=value['type']
        if kind in ('rgb','uniform'):
            _check(value,{'value'});return vec(value.get('value',1))
        if kind=='spectrum':
            _check(value,{'filename','value'})
            if 'filename' in value:
                if material is None: raise UnsupportedFeatureError("File spectra currently require a surface material")
                material.spectra[parameter]=self.path(value['filename']);return [1,1,1]
            raw=value.get('value',1)
            if isinstance(raw,str) and ':' in raw:
                pairs=[list(map(float,p.split(':'))) for p in raw.replace(',',' ').split()]
                if material is None: raise UnsupportedFeatureError("Tabulated spectrum needs a material target")
                cache=self.base/'.cybr_cache';cache.mkdir(exist_ok=True);text='\n'.join(f'{a:.17g} {b:.17g}' for a,b in pairs)+'\n'
                path=cache/(hashlib.sha256(text.encode()).hexdigest()[:24]+'.spd');path.write_text(text);material.spectra[parameter]=str(path);return [1,1,1]
            return vec(float(raw))
        raise UnsupportedFeatureError(f"Unsupported spectral value {kind}")
    def reflectance(self,value,m):
        if not isinstance(value,dict) or self.resolve(value).get('type') not in ('bitmap','checkerboard'):
            m.color=self.spectral(value,m);return
        value=self.resolve(value)
        if value['type']=='bitmap':
            _check(value,{'filename','raw','filter_type','wrap_mode','to_uv','uv_scale'})
            if value.get('filter_type','bilinear')!='bilinear': raise UnsupportedFeatureError("Only bilinear bitmap filtering is implemented")
            if 'to_uv' in value: raise UnsupportedFeatureError("Use uv_scale; arbitrary texture transforms are not implemented")
            m.texture=_bitmap(self.path(value['filename']),value.get('raw',False));m.color=[1,1,1]
            m.uv_scale=value.get('uv_scale',[1,1]);wrap=value.get('wrap_mode','repeat')
            if wrap not in ('repeat','clamp'): raise UnsupportedFeatureError("Unsupported bitmap wrap mode")
            m.texture_repeat=wrap=='repeat'
        else:
            _check(value,{'color0','color1','scale'});m.color=self.spectral(value.get('color0',.2),m);m.second=self.spectral(value.get('color1',.8));m.checker=_number(value.get('scale',8));m.uv_checker=True
    def material(self,spec,label='material'):
        spec=self.resolve(spec);key=id(spec)
        if key in self.material_cache: return self.material_cache[key]
        if key in self.stack: raise ValueError("Cyclic BSDF reference")
        self.stack.add(key)
        kind=spec.get('type')
        if kind in _CUSTOM_BSDF:
            i=_CUSTOM_BSDF[kind](self.scene,copy.deepcopy(spec),self)
            if not isinstance(i,int) or not 0<=i<len(self.scene.materials): raise ValueError("BSDF factory must return a material index")
            self.material_cache[key]=i;self.stack.remove(key);return i
        if kind not in _BSDF: raise UnsupportedFeatureError(f"Unsupported BSDF {kind}")
        names={'conductor':'mirror','roughconductor':'metal','dielectric':'glass','roughdielectric':'roughglass','roughplastic':'plastic'}
        m=Material(name=spec.get('id',label),type=names.get(kind,kind),two_sided=kind in ('dielectric','roughdielectric','thindielectric','null','polarizer','retarder','twosided','blendbsdf','mask','normalmap','bumpmap'))
        children=[v for v in spec.values() if isinstance(v,dict) and self.resolve(v).get('type') in (_BSDF|_CUSTOM_BSDF.keys())]
        if kind in ('blendbsdf','mask','twosided','normalmap','bumpmap'):
            n=2 if kind=='blendbsdf' else 1
            if len(children)!=n: raise ValueError(f"{kind} needs {n} nested BSDF(s)")
            ids=[self.material(child,f'{label}.child{i}') for i,child in enumerate(children)]
            m.children=tuple(ids+[ -1 ]*(2-n));m.weight=_number(spec.get('weight',.5));m.opacity=_number(spec.get('opacity',1));m.bump_scale=_number(spec.get('scale',1))
            if kind in ('normalmap','bumpmap'):
                tex=spec.get('normalmap',spec.get('texture'))
                if tex is None: raise ValueError("Normal/bump adapter needs a texture")
                tex=self.resolve(tex);_check(tex,{'filename','raw'})
                if tex['type']!='bitmap': raise UnsupportedFeatureError("Normal/bump maps require bitmaps")
                m.texture=_bitmap(self.path(tex['filename']),True)
            allowed={k for k,v in spec.items() if isinstance(v,dict)}|{'weight','opacity','scale'}
            _check(spec,allowed)
        else:
            allowed={'reflectance','transmittance','alpha','alpha_u','alpha_v','distribution','int_ior','ext_ior','eta','k','material','dispersion','absorption','theta','delta','axis','color','roughness'}
            _check(spec,allowed)
            if spec.get('distribution','ggx')!='ggx': raise UnsupportedFeatureError("Only GGX microfacets are implemented; Beckmann is not silently substituted")
            if 'ext_ior' in spec and abs(_ior(spec['ext_ior'])-1)>1e-12: raise UnsupportedFeatureError("Explicit non-vacuum exterior IOR is not yet represented by the scene compiler")
            m.ior_a=_ior(spec.get('int_ior',1.5));m.ior_b=_number(spec.get('dispersion',0));m.roughness=_number(spec.get('roughness',.2))
            if kind in ('roughconductor','roughdielectric','roughplastic'):
                m.alpha_u=_number(spec.get('alpha_u',spec.get('alpha',.1)));m.alpha_v=_number(spec.get('alpha_v',spec.get('alpha',m.alpha_u)))
            if kind in ('conductor','roughconductor'):
                if 'material' in spec: raise UnsupportedFeatureError("Supply eta/k or spectral files; measured-metal preset tables are not bundled")
                m.eta=self.spectral(spec.get('eta',.25),m,'eta');m.k=self.spectral(spec.get('k',3),m,'k')
            self.reflectance(spec.get('reflectance',spec.get('transmittance',spec.get('color',1 if kind=='null' else .5))),m)
            m.absorption=self.spectral(spec.get('absorption',0),m,'absorption')
            m.angle=math.radians(_number(spec.get('theta',0)));m.retardance=math.radians(_number(spec.get('delta',90)));m.axis=vec(spec.get('axis',[1,0,0]))
        i=len(self.scene.materials);self.scene.materials.append(m);self.material_cache[key]=i;self.stack.remove(key);return i
    def transform(self,value):
        if value is None: return ScalarTransform4f()
        return value if isinstance(value,ScalarTransform4f) else ScalarTransform4f(value)
    def shape(self,spec,label='shape',parent=None):
        spec=self.resolve(spec);kind=spec.get('type');T=self.transform(parent)@self.transform(spec.get('to_world'))
        if kind in _CUSTOM_SHAPE: return _CUSTOM_SHAPE[kind](self.scene,copy.deepcopy(spec),self,T)
        if kind not in _SHAPE: raise UnsupportedFeatureError(f"Unsupported shape {kind}")
        if kind in ('instance','shapegroup'):
            nested=[self.resolve(v) for v in spec.values() if isinstance(v,dict)]
            _check(spec,{'to_world'}|{k for k,v in spec.items() if isinstance(v,dict)})
            if kind=='instance':
                if len(nested)!=1 or nested[0]['type']!='shapegroup': raise ValueError("Instance must reference one shape group")
                nested=[self.resolve(v) for v in nested[0].values() if isinstance(v,dict)]
            return [self.shape(v,label,T) for v in nested]
        _check(spec,{'to_world','center','radius','p0','p1','filename','face_normals','flip_normals','bsdf','emitter','interior','caps'}|{k for k,v in spec.items() if isinstance(v,dict) and self.resolve(v).get('type') in (_BSDF|_CUSTOM_BSDF.keys())})
        bsdfs=[v for v in spec.values() if isinstance(v,dict) and self.resolve(v).get('type') in (_BSDF|_CUSTOM_BSDF.keys())]
        mid=self.material(bsdfs[0],label+'.bsdf') if bsdfs else self.scene.material(name=label+'.bsdf')
        if len(bsdfs)>1: raise ValueError("A shape cannot have multiple BSDFs")
        if 'emitter' in spec:
            emitter=self.resolve(spec['emitter']);_check(emitter,{'radiance'})
            if emitter['type']!='area': raise UnsupportedFeatureError("Only area emitters attach to geometry")
            m=copy.deepcopy(self.scene.materials[mid]);m.type='emitter';m.emission=1;m.kelvin=0;m.color=self.spectral(emitter.get('radiance',1),m)
            self.scene.materials.append(m);mid=len(self.scene.materials)-1
        A=T.matrix[:3,:3];scales=np.linalg.norm(A,axis=0)
        uniform=np.allclose(A.T@A,np.eye(3)*scales[0]**2,rtol=1e-8,atol=1e-10)
        start=len(self.scene.primitives)
        if kind=='sphere':
            if not uniform: raise UnsupportedFeatureError("Analytic spheres require similarity transforms, not ellipsoid approximation")
            result=self.scene.sphere(T@vec(spec.get('center',[0,0,0])),_number(spec.get('radius',1))*scales[0],mid)
        elif kind=='rectangle': result=self.scene.quad(T@[-1,-1,0],A@[2,0,0],A@[0,2,0],mid)
        elif kind=='disk':
            if not uniform: raise UnsupportedFeatureError("Analytic disks require similarity transforms")
            result=self.scene.disk(T@[0,0,0],np.linalg.inv(A).T@[0,0,1],_number(spec.get('radius',1))*scales[0],mid)
        elif kind=='cylinder':
            if not uniform: raise UnsupportedFeatureError("Analytic cylinders require similarity transforms")
            a=T@vec(spec.get('p0',[0,0,0]));b=T@vec(spec.get('p1',[0,0,1]))
            result=self.scene.cylinder((a+b)*.5,_number(spec.get('radius',1))*scales[0],np.linalg.norm(b-a),mid,axis=b-a,caps=spec.get('caps',False))
        elif kind=='cube':
            # Transform each exact quad. This preserves all affine parallelepipeds.
            result=self.scene.box([-1,-1,-1],[1,1,1],mid)
            for p in self.scene.primitives[start:]:
                p['corner']=(T@p['corner']).tolist();p['u']=(A@p['u']).tolist();p['v']=(A@p['v']).tolist()
                if np.linalg.det(A)<0: p['u'],p['v']=p['v'],p['u']
        elif kind in ('obj','ply'):
            if kind=='obj': result=self.scene.obj(self.path(spec['filename']),mid,smooth=not spec.get('face_normals',False),transform=T.matrix)
            else:
                result=self.scene.ply(self.path(spec['filename']),mid,transform=T.matrix)
                if spec.get('face_normals'):
                    for p in self.scene.primitives[start:]:p['smooth']=False
        if spec.get('flip_normals'):
            for p in self.scene.primitives[start:]:
                if p['type']=='quad': p['u'],p['v']=p['v'],p['u']
                elif p['type']=='triangle':
                    p['vertices']=p['vertices'][::-1];p['normals']=(-np.array(p['normals'][::-1])).tolist()
                    if p.get('uv') is not None:p['uv']=p['uv'][::-1]
                elif p['type']=='disk':p['b']=(-np.asarray(p['b'])).tolist()
                else: raise UnsupportedFeatureError("flip_normals is not supported on this analytic shape")
        if 'interior' in spec:
            medium=self.resolve(spec['interior']);self.medium(medium,kind,T,mid)
        return result
    def medium(self,spec,shape,T,mid):
        kind=spec['type'];_check(spec,{'sigma_t','albedo','scale','phase','density'})
        extinction=np.array(self.spectral(spec.get('sigma_t',1)))*_number(spec.get('scale',1));albedo=self.spectral(spec.get('albedo',.9))
        if kind=='homogeneous' and max(albedo)==0:
            self.scene.materials[mid].absorption=extinction.tolist();return
        if shape!='cube' or not np.allclose(T.matrix[:3,:3],np.diag(np.diag(T.matrix[:3,:3]))):
            raise UnsupportedFeatureError("Scattering media currently need an axis-aligned cube boundary; arbitrary shape media are not approximated")
        phase=self.resolve(spec.get('phase',{'type':'isotropic'}));_check(phase,{'g'})
        if phase['type'] not in ('isotropic','hg','rayleigh'):raise UnsupportedFeatureError("Unsupported phase function")
        a=T@[-1,-1,-1];b=T@[1,1,1];grid=None
        if kind=='heterogeneous':
            density=self.resolve(spec.get('density',{}));_check(density,{'filename'})
            if density.get('type')!='gridvolume':raise UnsupportedFeatureError("Heterogeneous media require a gridvolume")
            grid=self.path(density['filename'])
        elif kind!='homogeneous':raise UnsupportedFeatureError("Unsupported medium")
        self.scene.volume(np.minimum(a,b),np.maximum(a,b),extinction=extinction,albedo=albedo,g=phase.get('g',0),phase='rayleigh' if phase['type']=='rayleigh' else 'hg',kind=2 if grid else 0,grid=grid)
    def sensor(self,spec):
        _check(spec,{'to_world','fov','fov_axis','near_clip','far_clip','aperture_radius','focus_distance','shutter_open','shutter_close','film','sampler','scale'})
        if 'near_clip' in spec or 'far_clip' in spec:raise UnsupportedFeatureError("Finite sensor clipping is not implemented")
        kind=spec['type']
        if kind not in plugins()['sensors']:raise UnsupportedFeatureError(f"Unsupported sensor {kind}")
        T=self.transform(spec.get('to_world'));origin=T.matrix[:3,3];direction=normalized(T.matrix[:3,2]);up=normalized(T.matrix[:3,1]);film=spec.get('film',{'type':'hdrfilm'});_check(film,{'width','height','rfilter','file_format','pixel_format','component_format'})
        if film.get('type')!='hdrfilm' or film.get('pixel_format','rgb')!='rgb' or film.get('component_format','float32')!='float32':raise UnsupportedFeatureError("Only RGB float32 HDR films are supported")
        if film.get('file_format','pfm') not in ('pfm','openexr'):raise UnsupportedFeatureError("Unsupported HDR film format")
        self.scene.settings.film_format=film.get('file_format','pfm')
        w=int(film.get('width',640));h=int(film.get('height',480));self.scene.settings.width=w;self.scene.settings.height=h
        filter=film.get('rfilter',{'type':'box'});_check(filter,set())
        if filter['type'] not in plugins()['filters']:raise UnsupportedFeatureError("Unsupported filter")
        self.scene.settings.filter=filter['type'];sampler=spec.get('sampler',{'type':'independent'});_check(sampler,{'sample_count','seed'})
        if sampler['type'] not in ('independent','halton'):raise UnsupportedFeatureError("Unsupported sampler")
        self.scene.settings.sampler=int(sampler['type']=='halton');self.scene.settings.spp=int(sampler.get('sample_count',64));self.scene.settings.seed=int(sampler.get('seed',12345))
        fov=_number(spec.get('fov',40));axis=spec.get('fov_axis','x')
        if axis=='x':fov=math.degrees(2*math.atan(math.tan(math.radians(fov/2))*h/w))
        elif axis!='y':raise UnsupportedFeatureError("Only x/y field-of-view axes are supported")
        self.scene.camera=Camera(origin.tolist(),(origin+direction).tolist(),up.tolist(),fov,_number(spec.get('aperture_radius',0)),_number(spec.get('focus_distance',6)),_number(spec.get('shutter_open',0)),_number(spec.get('shutter_close',0)),kind=='orthographic',_number(spec.get('scale',2)),kind=='spherical')
    def emitter(self,spec):
        kind=spec['type'];_check(spec,{'position','direction','to_world','intensity','irradiance','radiance','filename','scale','cutoff_angle','beam_width','rotation'})
        scale=_number(spec.get('scale',1));T=self.transform(spec.get('to_world'))
        if kind in ('constant','envmap'):
            if self.scene.environment['strength']!=0:raise UnsupportedFeatureError("Only one enclosing environment is supported")
            self.scene.environment.update(color=self.spectral(spec.get('radiance',1)),strength=scale,flat=True)
            if kind=='envmap':self.scene.environment.update(texture=_bitmap(self.path(spec['filename']),True),rotation=math.radians(spec.get('rotation',0)))
        elif kind=='point':self.scene.point_light(T@vec(spec.get('position',[0,0,0])),self.spectral(spec.get('intensity',1)),scale=scale)
        elif kind=='directional':self.scene.directional_light(T.matrix[:3,:3]@vec(spec.get('direction',[0,0,1])),self.spectral(spec.get('irradiance',1)),scale=scale)
        elif kind=='spot':self.scene.spot_light(T@[0,0,0],T.matrix[:3,:3]@[0,0,1],self.spectral(spec.get('intensity',1)),cutoff=spec.get('cutoff_angle',30),beam=spec.get('beam_width',20),scale=scale)
        else:raise UnsupportedFeatureError(f"Unsupported emitter {kind}")
    def integrator(self,spec):
        kind=spec['type']
        if kind=='aov':
            _check(spec,{'aovs','integrator'});self.integrator(spec.get('integrator',{'type':'path'}))
            allowed={'depth','position','geo_normal','sh_normal','albedo','shape_index'}
            for item in spec.get('aovs','').split(','):
                if item and item.split(':')[-1].strip() not in allowed:raise UnsupportedFeatureError(f"Unsupported AOV {item}")
            return
        _check(spec,{'max_depth','rr_depth','shading_samples','max_distance','photon_count','radius'})
        if kind not in plugins()['integrators']:raise UnsupportedFeatureError(f"Unsupported integrator {kind}")
        if 'shading_samples' in spec and int(spec['shading_samples'])!=1:raise UnsupportedFeatureError("Direct integrator takes one light sample per camera sample")
        external_depth=int(spec.get('max_depth',-1))
        if external_depth==0 or external_depth<-1:raise ValueError('XML/dictionary max_depth must be -1 or >=1')
        c=self.scene.settings;c.integrator=kind;c.max_depth=external_depth-1 if external_depth>0 else -1;c.rr_depth=max(0,int(spec.get('rr_depth',5))-1);c.ao_distance=_number(spec.get('max_distance',1));c.photon_count=int(spec.get('photon_count',200000));c.photon_radius=_number(spec.get('radius',.15))

def load_dict(spec, *, base_dir=None):
    spec=copy.deepcopy(spec)
    if not isinstance(spec,dict) or spec.get('type')!='scene':raise ValueError("load_dict requires a scene dictionary")
    c=Compiler(spec,base_dir or Path.cwd());sensor_count=0
    for label,value in spec.items():
        if label in ('type','id','version'):continue
        if not isinstance(value,dict):raise ValueError(f"Scene item {label} must be a plugin dictionary")
        obj=c.resolve(value);kind=obj.get('type')
        if kind in _BSDF|_CUSTOM_BSDF.keys():c.material(value,label)
        elif kind=='shapegroup':continue
        elif kind in _SHAPE|_CUSTOM_SHAPE.keys():c.shape(value,label)
        elif kind in plugins()['sensors']:
            sensor_count+=1
            if sensor_count>1:raise UnsupportedFeatureError("Select one sensor per render; multiple sensors are not silently dropped")
            c.sensor(obj)
        elif kind in plugins()['integrators']:c.integrator(obj)
        elif kind in plugins()['emitters']:c.emitter(obj)
        else:raise UnsupportedFeatureError(f"Unrecognized scene plugin {kind}")
    validate_scene(c.scene);return c.scene

def _values(text):return [float(x) for x in str(text).replace(',',' ').split()]

def _xml(path, variables=None, seen=None):
    path=Path(path).resolve();seen=set() if seen is None else set(seen)
    if path in seen or len(seen)>32:raise ValueError("Cyclic or excessively nested XML include")
    seen.add(path);text=path.read_text()
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():raise ValueError("XML document types and entities are disabled")
    root=ET.fromstring(text);variables=dict(variables or {})
    for d in root.findall('default'):variables.setdefault(d.attrib['name'],d.attrib['value'])
    def substitute(value):
        for key,val in variables.items():value=value.replace('$'+key,str(val))
        if '$' in value:raise ValueError(f"Unresolved XML substitution: {value}")
        return value
    def parse(e):
        attr={k:substitute(v) for k,v in e.attrib.items()};tag=e.tag
        if tag in ('float','integer','boolean','string'):
            value=attr.get('value','')
            if tag=='float':return float(value)
            if tag=='integer':return int(value)
            if tag=='boolean':
                if value.lower() not in ('true','false'):raise ValueError("Invalid XML boolean")
                return value.lower()=='true'
            if attr.get('name')=='filename':return str((path.parent/value).resolve())
            return value
        if tag in ('point','vector'):
            return _values(attr['value']) if 'value' in attr else [float(attr.get(k,0)) for k in ('x','y','z')]
        if tag=='rgb':return {'type':'rgb','value':_values(attr['value'])}
        if tag=='spectrum':
            return {'type':'spectrum','filename':str((path.parent/attr['filename']).resolve())} if 'filename' in attr else {'type':'spectrum','value':attr['value']}
        if tag=='ref':return {'type':'ref','id':attr['id']}
        if tag=='transform':
            T=ScalarTransform4f()
            for item in e:
                a={k:substitute(v) for k,v in item.attrib.items()}
                if item.tag=='translate':Q=ScalarTransform4f.translate(_values(a['value']) if 'value' in a else [float(a.get(k,0)) for k in ('x','y','z')])
                elif item.tag=='scale':Q=ScalarTransform4f.scale(float(a['value']) if 'value' in a else [float(a.get(k,1)) for k in ('x','y','z')])
                elif item.tag=='rotate':Q=ScalarTransform4f.rotate([float(a.get(k,0)) for k in ('x','y','z')],float(a['angle']))
                elif item.tag=='lookat':Q=ScalarTransform4f.look_at(_values(a['origin']),_values(a['target']),_values(a.get('up','0,1,0')))
                elif item.tag=='matrix':Q=ScalarTransform4f(np.asarray(_values(a['value'])).reshape(4,4))
                else:raise UnsupportedFeatureError(f"Unknown XML transform operation {item.tag}")
                T=Q@T
            return T
        if tag=='include':return _xml(path.parent/attr['filename'],variables,seen)
        if tag not in ('scene','shape','bsdf','sensor','sampler','film','rfilter','integrator','emitter','texture','medium','phase','volume'):
            raise UnsupportedFeatureError(f"Unsupported XML element {tag}")
        out={'type':'scene' if tag=='scene' else attr['type']}
        if 'id' in attr:out['id']=attr['id']
        for i,ch in enumerate(e):
            if ch.tag=='default':continue
            item=parse(ch)
            if ch.tag=='include':
                for k,v in item.items():
                    if k not in ('type','version'):
                        if k in out:raise ValueError(f"Duplicate XML include key {k}")
                        out[k]=v
                continue
            key=ch.attrib.get('name',ch.attrib.get('id',ch.tag))
            if key in out:key=f'{key}_{i}'
            out[key]=item
        return out
    return parse(root)

def load_file(path, **variables):
    path=Path(path).resolve()
    if path.suffix.lower()=='.xml':return load_dict(_xml(path,variables),base_dir=path.parent)
    data=json.loads(path.read_text())
    if data.get('format')=='cybr-scene-2':return load_snapshot(path)
    return load_dict(data,base_dir=path.parent)

def validate_scene(scene):
    c=scene.settings
    if c.width<1 or c.height<1 or c.width*c.height>8_000_000 or c.spp<1 or c.bands<1 or c.bands>128:raise ValueError("Invalid film/sample configuration")
    if c.film_format not in ('pfm','openexr'):raise UnsupportedFeatureError('Unsupported film format')
    if c.integrator not in ('path','volpath','direct','ao','photonmap'):raise UnsupportedFeatureError("Unsupported integrator")
    if c.filter not in plugins()['filters'] or c.sampler not in (0,1):raise UnsupportedFeatureError("Unsupported filter or sampler")
    if c.ad and c.polarized:raise UnsupportedFeatureError("Native combined AD and polarization is not implemented")
    normalized(np.asarray(scene.camera.target)-scene.camera.origin);normalized(np.cross(np.asarray(scene.camera.target)-scene.camera.origin,scene.camera.up))
    if not 0<scene.camera.fov<180 or scene.camera.focus<=0 or scene.camera.aperture<0:raise ValueError("Invalid camera")
    if c.threads<1 or c.rr_depth<0 or c.max_depth<-1 or c.photon_count<1 or not np.isfinite(c.photon_radius) or c.photon_radius<=0:raise ValueError('Invalid execution/depth/photon settings')
    if not np.isfinite(c.exposure) or c.exposure<0:raise ValueError('Invalid exposure')
    if scene.camera.shutter_close<scene.camera.shutter_open:raise ValueError('Invalid shutter interval')
    if c.ad and not 0<=c.active_material<len(scene.materials):raise ValueError('Select an active material for native AD')
    for i,m in enumerate(scene.materials):
        for x in (m.roughness,m.ior_a,m.ior_b,m.alpha_u,m.alpha_v,m.opacity,m.weight,m.bump_scale,m.emission,m.kelvin,m.film_nm,m.film_ior,m.scattering,m.phase_g):
            if not np.isfinite(x):raise ValueError('Nonfinite material parameter')
        if m.alpha_u<0 or m.alpha_v<0 or bool(m.alpha_u)!=bool(m.alpha_v):raise ValueError('Supply both nonnegative anisotropic slopes')
        if not 0<=m.opacity<=1 or not 0<=m.weight<=1:raise ValueError("Invalid BSDF mixture weight/opacity")
        if m.ior_a<=0 or m.roughness<0 or m.emission<0 or m.kelvin<=0:raise ValueError("Invalid BSDF optical parameter")
        vec(m.shader_parameters)
        vec(m.film_gradient)
        if m.film_nm<0 or m.film_ior<=0 or (m.film_nm>0 and m.type!='glass'):raise ValueError('Invalid smooth-glass coating')
        if m.film_nm>0 and c.polarized:raise UnsupportedFeatureError('Polarized coated-glass transport is not implemented')
        if m.scattering<0 or abs(m.phase_g)>=1 or (m.scattering>0 and m.type not in ('glass','roughglass')):raise ValueError('Invalid dielectric interior scattering')
        if m.scattering>0 and c.polarized:raise UnsupportedFeatureError('Polarized interior scattering is not implemented')
        if m.texture_ior and (not m.roughness_texture or m.type not in ('plastic','landscape')):raise ValueError('Textured IOR needs a landscape/plastic parameter map')
        for v in (m.color,m.eta,m.k,m.absorption):
            if min(vec(v))<0:raise ValueError("Negative spectral control")
        if m.type in ('blendbsdf','mask','twosided','normalmap','bumpmap'):
            required=2 if m.type=='blendbsdf' else 1
            for j in m.children[:required]:
                if not 0<=j<len(scene.materials):raise ValueError("Missing nested BSDF")
        if c.polarized and m.type=='thindielectric':raise UnsupportedFeatureError("Thin-sheet dielectric uses scalar incoherent optics, not a polarized model")
    status=[0]*len(scene.materials)
    def visit(i):
        if status[i]==1:raise ValueError("Cyclic BSDF graph")
        if status[i]==2:return
        status[i]=1
        for j in scene.materials[i].children:
            if j>=0:visit(j)
        status[i]=2
    for i in range(len(status)):visit(i)
    for p in scene.primitives:
        if not 0<=p['material']<len(scene.materials):raise ValueError("Invalid shape material index")
        vec(p['velocity']);kind=p['type']
        if kind=='sphere':
            vec(p['center'])
            if not np.isfinite(p['radius']) or p['radius']<=0:raise ValueError('Invalid sphere radius')
        elif kind in ('disk','cylinder'):
            vec(p['a']);vec(p['b'])
            if not np.isfinite(p['radius']) or p['radius']<=0:raise ValueError('Invalid analytic radius')
            normalized(np.asarray(p['b'])-p['a'] if kind=='cylinder' else p['b'])
        elif kind=='quad':
            vec(p['corner']);normalized(np.cross(vec(p['u']),vec(p['v'])))
        elif kind=='triangle':
            a,b,c0=np.asarray(p['vertices'],dtype=float)
            for vertex in (a,b,c0):vec(vertex)
            normalized(np.cross(b-a,c0-a))
            if not np.isfinite(p['normals']).all():raise ValueError('Nonfinite triangle normal')
        else:raise UnsupportedFeatureError('Unsupported primitive '+kind)
    def has_dielectric(i):
        m=scene.materials[i]
        return m.type in ('glass','roughglass') or any(has_dielectric(j) for j in m.children if j>=0)
    for m in scene.materials:
        if m.type=='blendbsdf' and any(has_dielectric(j) for j in m.children if j>=0):raise UnsupportedFeatureError('Blend does not model multiple dielectric medium transitions')
    for v in scene.volumes:
        for field in ('lower','upper','albedo','extinction'):vec(v[field])
        if v['kind'] not in (0,1,2) or (v['kind']==2 and not v.get('grid')):raise ValueError('Invalid or missing volume density source')
        if v.get('phase','hg') not in ('hg','isotropic','rayleigh') or (v.get('phase')=='isotropic' and v['g']!=0):raise ValueError('Invalid phase function parameters')
        if not all(np.isfinite(v[k]) for k in ('g','scale','majorant')) or v['majorant']<0:raise ValueError('Invalid volume scalar parameter')
        if np.any(np.asarray(v['upper'])<=v['lower']) or abs(v['g'])>=1:raise ValueError("Invalid medium")
        if min(v['albedo'])<0 or max(v['albedo'])>1 or min(v['extinction'])<0:raise ValueError("Invalid medium coefficients")
    if min(vec(scene.environment['color']))<0 or not np.isfinite(scene.environment['strength']) or scene.environment['strength']<0:
        raise ValueError('Invalid environment radiance')
    for lobe in scene.environment.get('lobes',[]):
        normalized(vec(lobe['direction']))
        if not all(np.isfinite(lobe[k]) for k in ('strength','exponent')) or lobe['strength']<0 or lobe['exponent']<0:raise ValueError('Invalid environment lobe')
    for light in scene.delta_lights:
        vec(light['position']);normalized(vec(light['direction']))
        if min(vec(light['intensity']))<0 or not np.isfinite(light['scale']) or light['scale']<0:raise ValueError('Invalid light intensity')
        if light['kind'] not in (0,1,2):raise ValueError('Invalid delta light kind')
        if light['kind']==2 and not 0<light['beam']<=light['cutoff']<math.pi/2:raise ValueError('Invalid spot light cone')
    if c.integrator=='photonmap' and (scene.volumes or c.ad or c.polarized):raise UnsupportedFeatureError("Photon mapping is a surface-only scalar integrator")

class SceneParameters(MutableMapping):
    """Staged parameter edits. update() validates a copy before committing atomically."""
    def __init__(self,scene):
        self.scene=scene;self.pending={};self.paths={}
        for group in ('camera','settings'):
            obj=getattr(scene,group)
            for f in fields(obj):self.paths[f'{group}.{f.name}']=(group,None,f.name)
        for i,m in enumerate(scene.materials):
            for f in fields(m):self.paths[f'materials.{i}.{f.name}']=('materials',i,f.name)
        for i,p in enumerate(scene.primitives):
            for k in p:self.paths[f'shapes.{i}.{k}']=('primitives',i,k)
        for i,p in enumerate(scene.volumes):
            for k in p:self.paths[f'volumes.{i}.{k}']=('volumes',i,k)
        for i,p in enumerate(scene.delta_lights):
            for k in p:self.paths[f'lights.{i}.{k}']=('delta_lights',i,k)
        for k in scene.environment:self.paths[f'environment.{k}']=('environment',None,k)
    def __len__(self):return len(self.paths)
    def __iter__(self):return iter(self.paths)
    def __delitem__(self,key):raise TypeError("Use keep() to restrict parameter traversal")
    def __getitem__(self,key):
        if key in self.pending:return copy.deepcopy(self.pending[key])
        group,i,field=self.paths[key];obj=getattr(self.scene,group);obj=obj if i is None else obj[i]
        return copy.deepcopy(obj[field] if isinstance(obj,dict) else getattr(obj,field))
    def __setitem__(self,key,value):
        if key not in self.paths:raise KeyError(key)
        self.pending[key]=copy.deepcopy(value)
    def keep(self,patterns):
        if isinstance(patterns,str):patterns=[patterns]
        self.paths={k:v for k,v in self.paths.items() if any(fnmatch.fnmatch(k,p) for p in patterns)}
        self.pending={k:v for k,v in self.pending.items() if k in self.paths}
    def update(self,values=None,**kwargs):
        for k,v in dict(values or {},**kwargs).items():self[k]=v
        candidate=self.scene.clone()
        for key,value in self.pending.items():
            group,i,field=self.paths[key];obj=getattr(candidate,group);obj=obj if i is None else obj[i]
            if isinstance(obj,dict):obj[field]=value
            else:setattr(obj,field,value)
        validate_scene(candidate);self.scene.__dict__.clear();self.scene.__dict__.update(candidate.__dict__);self.pending.clear()

def traverse(scene):return SceneParameters(scene)

def save_snapshot(scene,path):
    validate_scene(scene);path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    data={'format':'cybr-scene-2','name':scene.name,'settings':asdict(scene.settings),'camera':asdict(scene.camera),
          'materials':[asdict(m) for m in scene.materials],'primitives':scene.primitives,'volumes':scene.volumes,
          'environment':scene.environment,'delta_lights':scene.delta_lights,'observer_path':scene.observer_path,
          'notes':scene.notes,'object_counter':scene._object,'asset_base':scene.asset_base}
    text=json.dumps(data,indent=2,default=lambda v:v.tolist() if hasattr(v,'tolist') else str(v),allow_nan=False)
    path.write_text(text);return path

def load_snapshot(path):
    path=Path(path);d=json.loads(path.read_text())
    if d.get('format')!='cybr-scene-2':raise ValueError("Unsupported snapshot version")
    s=Scene(d['name']);s.settings=Settings(**d['settings']);s.camera=Camera(**d['camera']);s.materials=[Material(**m) for m in d['materials']]
    for key in ('primitives','volumes','environment','delta_lights','observer_path','notes'):setattr(s,key,d[key])
    s._object=d['object_counter'];s.asset_base=str(path.parent.resolve()) if d.get('asset_base')=='.' else d.get('asset_base',str(path.parent.resolve()))
    # Asset paths in a portable snapshot are relative to that snapshot, not cwd.
    for m in s.materials:
        if m.shader:m.shader=str((Path(s.asset_base)/m.shader).resolve())
        if m.texture:m.texture=str((Path(s.asset_base)/m.texture).resolve())
        if m.roughness_texture:m.roughness_texture=str((Path(s.asset_base)/m.roughness_texture).resolve())
        m.spectra={k:str((Path(s.asset_base)/v).resolve()) for k,v in m.spectra.items()}
    for v in s.volumes:
        if v.get('grid'):v['grid']=str((Path(s.asset_base)/v['grid']).resolve())
    if s.observer_path:s.observer_path=str((Path(s.asset_base)/s.observer_path).resolve())
    if s.environment.get('texture'):s.environment['texture']=str((Path(s.asset_base)/s.environment['texture']).resolve())
    validate_scene(s);return s

def bundle_scene(scene,directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True);clone=scene.clone();manifest=[];shaders=[]
    def asset(name):
        source=(Path(scene.asset_base)/name).resolve()
        if not source.is_file():raise FileNotFoundError(source)
        digest=hashlib.sha256(source.read_bytes()).hexdigest();target=Path('assets')/(digest[:16]+source.suffix)
        (directory/target).parent.mkdir(exist_ok=True);shutil.copyfile(source,directory/target)
        manifest.append({'file':str(target),'sha256':digest,'bytes':source.stat().st_size});return str(target)
    for m in clone.materials:
        if m.shader:
            original=(Path(scene.asset_base)/m.shader).resolve();m.shader=asset(m.shader)
            shader_record={'binary':m.shader,'sources':{}}
            # Preserve the binary/source association so a relocated bundle can rebuild.
            for name in ('kernel.cpp','graph.json','compile.json'):
                if (original.parent/name).exists():shader_record['sources'][name]=asset(str(original.parent/name))
            if 'kernel.cpp' not in shader_record['sources']:
                raise ValueError('Portable shader bundles require their generated kernel.cpp source')
            shaders.append(shader_record)
        if m.texture:m.texture=asset(m.texture)
        if m.roughness_texture:m.roughness_texture=asset(m.roughness_texture)
        m.spectra={k:asset(v) for k,v in m.spectra.items()}
    for v in clone.volumes:
        if v.get('grid'):
            from .volume_io import native_density_path
            v['grid']=asset(str(native_density_path(Path(scene.asset_base)/v['grid'])))
    if clone.observer_path:clone.observer_path=asset(clone.observer_path)
    if clone.environment.get('texture'):clone.environment['texture']=asset(clone.environment['texture'])
    clone.asset_base=str(directory.resolve());clone.save(directory/'scene.cys');clone.asset_base='.';save_snapshot(clone,directory/'scene.cybr.json')
    (directory/'shaders.json').write_text(json.dumps(shaders,indent=2))
    (directory/'assets.json').write_text(json.dumps(manifest,indent=2));return directory/'scene.cybr.json'


def rebuild_shaders(directory, *, compiler=None):
    """Recompile every bundled material shader from its supplied C++ source.

    Run this before rendering a bundle on another machine. The original checksum
    manifest remains the delivery manifest; rebuild receipts describe local bytes.
    Native loading executes code: load only scenes/shaders from trusted sources.
    """
    import os, subprocess
    directory=Path(directory).resolve()
    metadata=directory/'shaders.json'
    if not metadata.exists():return []
    cc=shutil.which(compiler or os.environ.get('CXX','c++'))
    if not cc:raise RuntimeError('A C++17 compiler is required to rebuild bundled shaders')
    receipts=[]
    for record in json.loads(metadata.read_text()):
        source=(directory/record['sources']['kernel.cpp']).resolve()
        binary=(directory/record['binary']).resolve()
        if not source.is_relative_to(directory) or not binary.is_relative_to(directory):
            raise ValueError('Shader bundle paths must stay inside the bundle')
        temporary=binary.with_suffix(binary.suffix+'.building')
        command=[cc,'-std=c++17','-O3','-fPIC','-shared',str(source),'-o',str(temporary)]
        result=subprocess.run(command,capture_output=True,text=True)
        receipt={'source':str(source.relative_to(directory)),'binary':str(binary.relative_to(directory)),
                 'returncode':result.returncode,'stderr':result.stderr,'command':command}
        if result.returncode:
            temporary.unlink(missing_ok=True)
            raise RuntimeError('Shader rebuild failed: '+result.stderr)
        temporary.replace(binary)
        receipt['sha256']=hashlib.sha256(binary.read_bytes()).hexdigest();receipts.append(receipt)
    (directory/'shader_rebuild.json').write_text(json.dumps(receipts,indent=2))
    return receipts
