"""Checked dense volume I/O for the VOL v3 container.

The format has a 48-byte little-endian header followed by X-fastest sample data.
Arrays are returned in Z,Y,X,C order. The renderer uses scalar density;
RGB and six-channel files can be inspected but are not silently reduced to gray.
"""
from __future__ import annotations
from pathlib import Path
from dataclasses import dataclass
import hashlib
import struct
import numpy as np

@dataclass
class VolumeGrid:
    data: np.ndarray
    bounds: tuple[tuple[float,float,float],tuple[float,float,float]]=((0.,0.,0.),(1.,1.,1.))

    def __post_init__(self):
        array=np.asarray(self.data,dtype=np.float32)
        if array.ndim==3:array=array[...,None]
        if array.ndim!=4 or array.shape[3] not in (1,3,6) or min(array.shape[:3])<2:
            raise ValueError('Volume data must have shape Z,Y,X[,C], dimensions >=2 and 1,3,6 channels')
        if array.size>128_000_000 or not np.isfinite(array).all():raise ValueError('Volume is too large or nonfinite')
        bounds=np.asarray(self.bounds,dtype=float)
        if bounds.shape!=(2,3) or not np.isfinite(bounds).all() or np.any(bounds[1]<=bounds[0]):raise ValueError('Invalid volume bounding box')
        self.data=np.ascontiguousarray(array)
        self.bounds=tuple(tuple(float(v) for v in row) for row in bounds)

    @classmethod
    def read(cls,path: str|Path)->VolumeGrid:
        path=Path(path)
        with path.open('rb') as stream:
            header=stream.read(48)
            if len(header)!=48 or header[:4]!=b'VOL\x03':raise ValueError('Expected a VOL version 3 header')
            encoding,nx,ny,nz,channels=struct.unpack('<5i',header[4:24])
            if encoding!=1:raise ValueError('Only float32 VOL encoding 1 is supported')
            if min(nx,ny,nz)<2 or channels not in (1,3,6):raise ValueError('Invalid VOL dimensions/channels')
            count=nx*ny*nz*channels
            if count>128_000_000 or path.stat().st_size!=48+count*4:raise ValueError('VOL size mismatch or excessive grid')
            bounds=np.array(struct.unpack('<6f',header[24:48])).reshape(2,3)
            data=np.fromfile(stream,dtype='<f4',count=count).reshape(nz,ny,nx,channels)
        return cls(data,bounds)

    def write(self,path: str|Path)->Path:
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        nz,ny,nx,channels=self.data.shape
        header=b'VOL\x03'+struct.pack('<5i6f',1,nx,ny,nz,channels,*np.asarray(self.bounds).ravel())
        with path.open('wb') as stream:stream.write(header);stream.write(self.data.astype('<f4').tobytes())
        return path

    def write_native_density(self,path: str|Path)->Path:
        if self.data.shape[-1]!=1:raise ValueError('The native density field requires one channel; no RGB conversion is implicit')
        if np.min(self.data)<0:raise ValueError('Density cannot be negative')
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        nz,ny,nx,_=self.data.shape
        with path.open('wb') as stream:
            stream.write(struct.pack('<3i',nx,ny,nz));stream.write(self.data.astype('<f4').tobytes())
        return path


def native_density_path(path: str|Path)->Path:
    """Return a native scalar grid, converting a VOL container without resampling.

    Explicit Scene.volume(lower, upper) bounds define the placement in CYBR.
    This conversion preserves all scalar samples, not the external grid transform.
    """
    path=Path(path).resolve()
    if path.suffix.lower()!='.vol':return path
    grid=VolumeGrid.read(path);digest=hashlib.sha256(path.read_bytes()).hexdigest()
    target=path.parent/'.cybr_cache'/(digest[:24]+'.cgrid')
    return grid.write_native_density(target)
