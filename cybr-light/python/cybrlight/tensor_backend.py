"""A separate differentiable tensor execution backend for sphere/plane scenes.

All intersections, BSDFs, spectral reconstruction and transport are implemented
here. PyTorch supplies tensor arithmetic, reverse-mode AD, CPU/CUDA execution,
and TorchScript graph compilation. It is separate from the native renderer.

Scope: diffuse analytic spheres, one diffuse plane, one rectangular area emitter,
and a constant environment. Geometry gradients are local pathwise derivatives:
hard visibility boundaries are NOT differentiated. No mesh BVH exists in this
backend; use the native renderer for general geometry and polarized/volume work.
"""
from __future__ import annotations
import math
from typing import NamedTuple
import torch
from torch import Tensor, nn


def unit(x: Tensor) -> Tensor:
    return x / torch.sqrt(torch.clamp(torch.sum(x*x, dim=-1, keepdim=True), min=1e-16))


def scalar_product(a: Tensor, b: Tensor) -> Tensor:
    return torch.sum(a*b, dim=-1)


def spectrum_weights(wavelength: Tensor) -> Tensor:
    r = torch.exp(-0.5*((wavelength-610)/43)**2)
    g = torch.exp(-0.5*((wavelength-545)/34)**2)
    b = torch.exp(-0.5*((wavelength-450)/27)**2)
    w = torch.stack((r,g,b),dim=-1)
    return w/torch.clamp(w.sum(-1,keepdim=True),min=1e-30)


def matching_functions(wavelength: Tensor) -> Tensor:
    def gaussian(mean: float, left: float, right: float) -> Tensor:
        t=(wavelength-mean)*torch.where(wavelength<mean,left,right)
        return torch.exp(-0.5*t*t)
    x=1.056*gaussian(599.8,.0264,.0323)+.362*gaussian(442,.0624,.0374)-.065*gaussian(501.1,.049,.0382)
    y=.821*gaussian(568.8,.0213,.0247)+.286*gaussian(530.9,.0613,.0322)
    z=1.217*gaussian(437,.0845,.0278)+.681*gaussian(459,.0385,.0725)
    return torch.stack((x,y,z),-1)


class WavefrontDiffuse(nn.Module):
    """A fixed-depth, MIS surface integrator operating on tensor ray queues."""
    def __init__(self, depth: int=4) -> None:
        super().__init__()
        self.depth=depth
        self.register_buffer('light_center',torch.tensor([-1.4,4.5,1.0]))
        self.register_buffer('light_size',torch.tensor([2.6,2.0]))
        self.register_buffer('xyz_matrix',torch.tensor([[3.2404542,-1.5371385,-.4985314],[-.9692660,1.8760108,.0415560],[.0556434,-.2040259,1.0572252]]))

    def intersections(self, origin: Tensor, direction: Tensor, centers: Tensor, radii: Tensor) -> tuple[Tensor,Tensor,Tensor]:
        displacement=origin[:,None,:]-centers[None,:,:]
        b=torch.sum(displacement*direction[:,None,:],dim=-1)
        c=torch.sum(displacement*displacement,dim=-1)-radii[None,:]**2
        discriminant=b*b-c
        root=torch.sqrt(torch.clamp(discriminant,min=1e-12))
        near=-b-root;far=-b+root
        distance=torch.where(near>1e-4,near,far)
        distance=torch.where((discriminant>=0)&(distance>1e-4),distance,torch.full_like(distance,1e12))
        t,index=torch.min(distance,dim=-1)
        point=origin+direction*t[:,None]
        normal=unit(point-centers[index])
        safe_dy=torch.where(torch.abs(direction[:,1])>1e-9,direction[:,1],torch.full_like(t,1e-9))
        plane_t=-origin[:,1]/safe_dy
        plane=(plane_t>1e-4)&(plane_t<t)
        t=torch.where(plane,plane_t,t)
        plane_normal=torch.zeros_like(normal);plane_normal[:,1]=1
        normal=torch.where(plane[:,None],plane_normal,normal)
        index=torch.where(plane,torch.full_like(index,centers.shape[0]),index)
        return t,normal,index

    def forward(self, origin: Tensor, direction: Tensor, random: Tensor, wavelength: Tensor,
                centers: Tensor, radii: Tensor, colors: Tensor, light_energy: Tensor) -> Tensor:
        weights=spectrum_weights(wavelength)
        emitted=(weights*light_energy[None,:]).sum(-1)
        throughput=torch.ones_like(wavelength)
        result=torch.zeros_like(wavelength)
        alive=torch.ones_like(wavelength,dtype=torch.bool)
        previous_pdf=torch.ones_like(wavelength)
        light_area=self.light_size[0]*self.light_size[1]
        for bounce in range(self.depth):
            distance,normal,index=self.intersections(origin,direction,centers,radii)
            safe_dy=torch.where(torch.abs(direction[:,1])>1e-9,direction[:,1],torch.full_like(distance,1e-9))
            to_light=(self.light_center[1]-origin[:,1])/safe_dy
            light_position=origin+direction*to_light[:,None]
            light_hit=(to_light>1e-4)&(to_light<distance)&(direction[:,1]>0)
            light_hit=light_hit&(torch.abs(light_position[:,0]-self.light_center[0])<self.light_size[0]*.5)
            light_hit=light_hit&(torch.abs(light_position[:,2]-self.light_center[2])<self.light_size[1]*.5)
            light_pdf=to_light*to_light/(light_area*torch.clamp(direction[:,1],min=1e-9))
            hit_weight=previous_pdf**2/(previous_pdf**2+light_pdf**2)
            if bounce==0:
                hit_weight=torch.ones_like(hit_weight)
            result=result+torch.where(alive&light_hit,throughput*emitted*hit_weight,torch.zeros_like(result))
            miss=(distance>1e10)&(~light_hit)
            result=result+torch.where(alive&miss,throughput*.025,torch.zeros_like(result))
            alive=alive&(~miss)&(~light_hit)
            safe_distance=torch.where(alive,distance,torch.zeros_like(distance))
            point=origin+direction*safe_distance[:,None]
            diffuse=(colors[index]*weights).sum(-1)
            # One uniformly sampled area-light point per surface vertex.
            uv=random[:,bounce,:2]-.5
            light_sample=self.light_center[None,:]+torch.stack((uv[:,0]*self.light_size[0],torch.zeros_like(uv[:,0]),uv[:,1]*self.light_size[1]),-1)
            delta=light_sample-point
            distance2=torch.clamp(torch.sum(delta*delta,-1),min=1e-12)
            light_direction=delta/torch.sqrt(distance2[:,None])
            cosine=torch.clamp(scalar_product(normal,light_direction),min=0)
            emitter_cosine=torch.clamp(light_direction[:,1],min=1e-9)
            sample_pdf=distance2/(light_area*emitter_cosine)
            bsdf_pdf=cosine/math.pi
            mis=sample_pdf**2/(sample_pdf**2+bsdf_pdf**2)
            shadow_t,_,_=self.intersections(point+normal*2e-4,light_direction,centers,radii)
            visible=shadow_t>torch.sqrt(distance2)-5e-4
            estimate=throughput*diffuse/math.pi*emitted*cosine*mis/sample_pdf
            result=result+torch.where(alive&visible,estimate,torch.zeros_like(estimate))
            # Cosine-weighted continuation; all geometry/BSDF operations remain
            # on the AD graph, except the intentional discrete visibility tests.
            angle=2*math.pi*random[:,bounce,2]
            radial=torch.sqrt(random[:,bounce,3])
            local=torch.stack((radial*torch.cos(angle),radial*torch.sin(angle),torch.sqrt(torch.clamp(1-radial*radial,min=0))),-1)
            reference=torch.zeros_like(normal);reference[:,2]=1
            fallback=torch.zeros_like(normal);fallback[:,1]=1
            reference=torch.where((torch.abs(normal[:,2])>.999)[:,None],fallback,reference)
            tangent=unit(torch.linalg.cross(reference,normal,dim=-1))
            bitangent=torch.linalg.cross(normal,tangent,dim=-1)
            direction=unit(tangent*local[:,0,None]+bitangent*local[:,1,None]+normal*local[:,2,None])
            origin=point+normal*2e-4
            previous_pdf=torch.clamp(scalar_product(normal,direction),min=0)/math.pi
            throughput=throughput*diffuse
        xyz=result[:,None]*matching_functions(wavelength)*(470/106.856917101)
        return xyz@self.xyz_matrix.T


def camera_samples(width: int, height: int, spp: int, bands: int, *, depth: int=4,
                   seed: int=20, device: str='cpu') -> tuple[Tensor,Tensor,Tensor,Tensor]:
    generator=torch.Generator().manual_seed(seed)
    pixel_count=width*height
    yy,xx=torch.meshgrid(torch.arange(height),torch.arange(width),indexing='ij')
    jitter=torch.rand(pixel_count,spp,2,generator=generator)
    x=xx.reshape(-1,1)+jitter[:,:,0]
    y=yy.reshape(-1,1)+jitter[:,:,1]
    eye=torch.tensor([4.,2.7,7.0]);look=torch.tensor([0.,.65,0.]);up=torch.tensor([0.,1.,0.])
    forward=unit(look-eye);right=unit(torch.linalg.cross(forward,up));vertical=torch.linalg.cross(right,forward)
    scale=math.tan(math.radians(39)/2)
    px=(2*x/width-1)*width/height*scale;py=(1-2*y/height)*scale
    directions=unit(forward+px[:,:,None]*right+py[:,:,None]*vertical)
    rays=directions[:,:,None,:].expand(pixel_count,spp,bands,3).reshape(-1,3)
    origins=eye.expand_as(rays)
    random=torch.rand(pixel_count,spp,depth,4,generator=generator)
    random=random[:,:,None,:,:].expand(pixel_count,spp,bands,depth,4).reshape(-1,depth,4)
    shifts=torch.rand(pixel_count,spp,1,generator=generator)
    wavelengths=(360+(torch.arange(bands)+shifts)*470/bands).reshape(-1)
    return tuple(v.to(device) for v in (origins,rays,random,wavelengths))


def default_parameters(device: str='cpu') -> tuple[Tensor,Tensor,Tensor,Tensor]:
    centers=torch.tensor([[-1.35,.62,0.],[0.,.72,.1],[1.5,.55,-.15]],device=device)
    radii=torch.tensor([.62,.72,.55],device=device)
    # Final row is the ground plane.
    colors=torch.tensor([[.64,.07,.035],[.045,.43,.50],[.64,.43,.065],[.38,.38,.38]],device=device)
    energy=torch.tensor([10.,10.,10.],device=device)
    return centers,radii,colors,energy
