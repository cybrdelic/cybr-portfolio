"""CYBR LIGHT spectral rendering and scene-authoring API."""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Sequence, Any
import copy
import json
import math
import os
import shutil
import subprocess
import numpy as np

__version__ = "0.2.0"

Vector = Sequence[float]


def vec(value: float | Vector) -> list[float]:
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError("Expected a finite scalar")
        return [float(value)] * 3
    result = [float(x) for x in value]
    if len(result) != 3 or not all(math.isfinite(x) for x in result):
        raise ValueError("Expected a finite three-vector")
    return result


def normalized(value: Vector) -> np.ndarray:
    value = np.asarray(value, dtype=np.float64)
    if value.shape != (3,) or not np.isfinite(value).all():
        raise ValueError("Expected a finite three-vector")
    length = np.linalg.norm(value)
    if length < 1e-14:
        raise ValueError("Cannot normalize zero vector")
    return value / length


@dataclass
class Material:
    two_sided: bool = True
    name: str = "material"
    type: str = "diffuse"
    color: Vector | float = (0.5, 0.5, 0.5)
    roughness: float = 0.2
    ior_a: float = 1.5
    ior_b: float = 0.0
    eta: Vector | float = (0.25, 0.6, 1.2)
    k: Vector | float = (3.5, 2.8, 2.0)
    absorption: Vector | float = 0.0
    emission: float = 0.0
    kelvin: float = 6500.0
    checker: float = 0.0
    second: Vector | float = (0.1, 0.1, 0.1)
    axis: Vector = (1, 0, 0)
    angle: float = 0.0
    retardance: float = math.pi / 2
    spectra: dict[str, str] = field(default_factory=dict)
    shader: str | None = None
    shader_parameters: Vector = (0, 0, 0)
    alpha_u: float = 0.0
    alpha_v: float = 0.0
    opacity: float = 1.0
    weight: float = 0.5
    children: tuple[int, int] = (-1, -1)
    texture: str | None = None
    roughness_texture: str | None = None
    texture_ior: bool = False
    uv_scale: Vector = (1.0, 1.0)
    texture_repeat: bool = True
    uv_checker: bool = False
    bump_scale: float = 1.0
    film_nm: float = 0.0
    scattering: float = 0.0
    phase_g: float = 0.0
    film_ior: float = 1.0
    film_gradient: Vector = (0, 0, 0)


@dataclass
class Camera:
    origin: Vector = (0, 2, 6)
    target: Vector = (0, 1, 0)
    up: Vector = (0, 1, 0)
    fov: float = 40
    aperture: float = 0
    focus: float = 6
    shutter_open: float = 0
    shutter_close: float = 0
    orthographic: bool = False
    ortho_scale: float = 4
    spherical: bool = False


@dataclass
class Settings:
    width: int = 640
    height: int = 440
    spp: int = 96
    bands: int = 8
    max_depth: int = 20
    rr_depth: int = 5
    threads: int = 4
    seed: int = 12345
    exposure: float = 1.0
    polarized: bool = False
    ad: bool = False
    active_material: int = -1
    mis: bool = True
    nee: bool = True
    film_format: str = "pfm"
    integrator: str = "path"
    sampler: int = 0
    filter: str = "box"
    ao_distance: float = 1.0
    photon_count: int = 200_000
    photon_radius: float = 0.15


class Scene:
    def __init__(self, name: str = "scene") -> None:
        self.name = name
        self.settings = Settings()
        self.camera = Camera()
        self.materials: list[Material] = []
        self.primitives: list[dict[str, Any]] = []
        self.volumes: list[dict[str, Any]] = []
        self.environment: dict[str, Any] = {"color": [0.5, 0.6, 0.8], "strength": 0.0, "lobes": []}
        self._object = 0
        self.observer_path: str | None = None
        self.notes: list[str] = []
        self.delta_lights: list[dict[str, Any]] = []
        self.asset_base = str(Path.cwd())

    def clone(self, name: str | None = None) -> Scene:
        result = copy.deepcopy(self)
        if name is not None:
            result.name = name
        return result

    def material(self, **kwargs: Any) -> int:
        item = Material(**kwargs)
        if item.roughness < 0 or item.ior_a <= 0 or item.emission < 0:
            raise ValueError("Invalid material parameters")
        if not math.isfinite(item.film_nm) or item.film_nm < 0 or not math.isfinite(item.film_ior) or item.film_ior <= 0:
            raise ValueError("Invalid optical coating")
        vec(item.film_gradient)
        if item.film_nm and item.type != 'glass':
            raise ValueError("Optical coating currently requires smooth glass")
        self.materials.append(item)
        return len(self.materials) - 1

    def object_id(self) -> int:
        self._object += 1
        return self._object

    def sphere(self, center: Vector, radius: float, material: int, *, velocity: Vector = (0, 0, 0), object_id: int | None = None) -> int:
        if radius <= 0:
            raise ValueError("Sphere radius must be positive")
        oid = self.object_id() if object_id is None else object_id
        self.primitives.append({"type": "sphere", "material": material, "object": oid,
                                "center": vec(center), "radius": float(radius), "velocity": vec(velocity)})
        return oid

    def quad(self, corner: Vector, u: Vector, v: Vector, material: int, *, velocity: Vector = (0, 0, 0), object_id: int | None = None) -> int:
        if np.linalg.norm(np.cross(u, v)) < 1e-12:
            raise ValueError("Degenerate quadrilateral")
        oid = self.object_id() if object_id is None else object_id
        self.primitives.append({"type": "quad", "material": material, "object": oid,
                                "corner": vec(corner), "u": vec(u), "v": vec(v), "velocity": vec(velocity)})
        return oid

    def rectangle(self, center: Vector, u: Vector, v: Vector, material: int, **kwargs: Any) -> int:
        return self.quad(np.asarray(center) - np.asarray(u) * 0.5 - np.asarray(v) * 0.5, u, v, material, **kwargs)

    def mesh(self, vertices: Any, faces: Any, material: int, *, normals: Any = None, uv: Any = None,
             albedo: Any = None, parameters: Any = None,
             transform: Any = None, velocity: Vector = (0, 0, 0), object_id: int | None = None) -> int:
        vertices = np.asarray(vertices, dtype=np.float64)
        faces = np.asarray(faces, dtype=np.int64)
        if vertices.ndim != 2 or vertices.shape[1] != 3 or faces.ndim != 2 or faces.shape[1] != 3:
            raise ValueError("Expected Nx3 vertices and Mx3 triangle indices")
        if not np.isfinite(vertices).all() or (faces < 0).any() or (faces >= len(vertices)).any():
            raise ValueError("Invalid mesh data")
        if normals is not None:
            normals = np.asarray(normals, dtype=np.float64)
            if normals.shape != vertices.shape:
                raise ValueError("Normals must match vertices")
        if uv is not None:
            uv = np.asarray(uv, dtype=float)
            if uv.shape != (len(vertices), 2) or not np.isfinite(uv).all():
                raise ValueError("UV coordinates must be finite Nx2 values")
        if (albedo is None) != (parameters is None):
            raise ValueError("Vertex albedo and roughness/IOR parameters must be supplied together")
        if albedo is not None:
            albedo=np.asarray(albedo,dtype=float);parameters=np.asarray(parameters,dtype=float)
            if albedo.shape!=vertices.shape or parameters.shape!=vertices.shape or not np.isfinite(albedo).all() or not np.isfinite(parameters).all():
                raise ValueError("Vertex material attributes must be finite Nx3 arrays")
            if (albedo<0).any() or (albedo>1).any() or (parameters[:,0]<0).any() or (parameters[:,0]>1).any() or (parameters[:,1]<1).any() or (parameters[:,1]>4).any():
                raise ValueError("Invalid vertex reflectance, roughness or IOR")
            if self.materials[material].type not in ('diffuse','plastic','landscape'):
                raise ValueError("Vertex material requires diffuse, plastic or landscape leaf")
        if transform is not None:
            matrix = np.asarray(transform, dtype=float)
            if matrix.shape != (4, 4):
                raise ValueError("Transform must be 4x4")
            vertices = vertices @ matrix[:3, :3].T + matrix[:3, 3]
            if normals is not None:
                normals = normals @ np.linalg.inv(matrix[:3, :3])
                normals /= np.linalg.norm(normals, axis=1)[:, None]
            if np.linalg.det(matrix[:3, :3]) < 0:
                faces = faces[:, ::-1]
        oid = self.object_id() if object_id is None else object_id
        for face in faces:
            tri = vertices[face]
            if np.linalg.norm(np.cross(tri[1] - tri[0], tri[2] - tri[0])) < 1e-12:
                continue
            ns = normals[face] if normals is not None else np.zeros((3, 3))
            self.primitives.append({"type": "triangle", "material": material, "object": oid,
                                    "vertices": tri.tolist(), "normals": ns.tolist(), "smooth": normals is not None,
                                    "velocity": vec(velocity), "uv": uv[face].tolist() if uv is not None else None})
            if albedo is not None:
                self.primitives[-1].update(vertex_albedo=albedo[face].tolist(),vertex_parameters=parameters[face].tolist())
        return oid

    def obj(self, path: str | Path, material: int, *, smooth: bool = True, transform: Any = None) -> int:
        from .mesh_io import read_obj
        vertices, faces, normals, uv = read_obj(path)
        return self.mesh(vertices, faces, material, normals=normals if smooth else None, uv=uv, transform=transform)

    def ply(self, path: str | Path, material: int, *, transform: Any = None) -> int:
        from .mesh_io import read_ply
        vertices, faces, normals, uv = read_ply(path)
        return self.mesh(vertices, faces, material, normals=normals, uv=uv, transform=transform)

    def disk(self, center: Vector, normal: Vector, radius: float, material: int, *, object_id: int | None = None) -> int:
        if not math.isfinite(radius) or radius <= 0:
            raise ValueError("Disk radius must be positive and finite")
        oid = self.object_id() if object_id is None else object_id
        self.primitives.append({"type": "disk", "material": material, "object": oid,
                                "a": vec(center), "b": normalized(normal).tolist(), "radius": float(radius), "velocity": [0, 0, 0]})
        return oid

    def point_light(self, position: Vector, intensity: float | Vector = 1, *, scale: float = 1) -> int:
        self.delta_lights.append({"kind": 0, "position": vec(position), "direction": [0, -1, 0],
                                 "intensity": vec(intensity), "scale": float(scale), "cutoff": 0.5, "beam": 0.4})
        return len(self.delta_lights) - 1

    def directional_light(self, direction: Vector, irradiance: float | Vector = 1, *, scale: float = 1) -> int:
        i = self.point_light([0, 0, 0], irradiance, scale=scale)
        self.delta_lights[i].update(kind=1, direction=normalized(direction).tolist())
        return i

    def spot_light(self, position: Vector, direction: Vector, intensity: float | Vector = 1,
                   *, cutoff: float = 30, beam: float = 20, scale: float = 1) -> int:
        if not 0 < beam <= cutoff < 90:
            raise ValueError("Require 0 < beam <= cutoff < 90 degrees")
        i = self.point_light(position, intensity, scale=scale)
        self.delta_lights[i].update(kind=2, direction=normalized(direction).tolist(),
                                   cutoff=math.radians(cutoff), beam=math.radians(beam))
        return i

    def box(self, lower: Vector, upper: Vector, material: int, *, object_id: int | None = None) -> int:
        lo, hi = np.asarray(lower), np.asarray(upper)
        if np.any(hi <= lo):
            raise ValueError("Box has nonpositive extent")
        x, y, z = hi - lo
        oid = self.object_id() if object_id is None else object_id
        self.quad(lo, (0, y, 0), (x, 0, 0), material, object_id=oid)  # -z
        self.quad(lo + (0, 0, z), (x, 0, 0), (0, y, 0), material, object_id=oid)
        self.quad(lo, (0, 0, z), (0, y, 0), material, object_id=oid)  # -x
        self.quad(lo + (x, 0, 0), (0, y, 0), (0, 0, z), material, object_id=oid)
        self.quad(lo, (x, 0, 0), (0, 0, z), material, object_id=oid)  # -y
        self.quad(lo + (0, y, 0), (0, 0, z), (x, 0, 0), material, object_id=oid)
        return oid

    def cylinder(self, center: Vector, radius: float, height: float, material: int, segments: int = 96,
                 *, axis: Vector = (0, 1, 0), caps: bool = True, object_id: int | None = None) -> int:
        """Exact finite cylindrical side and optional exact disk caps; no tessellation."""
        if radius <= 0 or height <= 0 or not math.isfinite(radius + height):
            raise ValueError("Cylinder dimensions must be positive and finite")
        center = np.asarray(vec(center)); axis = normalized(axis)
        oid = self.object_id() if object_id is None else object_id
        a, b = center - axis * height / 2, center + axis * height / 2
        self.primitives.append({"type": "cylinder", "material": material, "object": oid,
                                "a": a.tolist(), "b": b.tolist(), "radius": float(radius), "velocity": [0, 0, 0]})
        if caps:
            self.disk(a, -axis, radius, material, object_id=oid)
            self.disk(b, axis, radius, material, object_id=oid)
        return oid

    def torus(self, center: Vector, major_radius: float, minor_radius: float, material: int,
              *, segments: int = 144, sides: int = 36, rotation: Any = None) -> int:
        vertices, normals, faces = [], [], []
        matrix = np.eye(3) if rotation is None else np.asarray(rotation)
        for i in range(segments):
            a = i * 2 * math.pi / segments
            for j in range(sides):
                b = j * 2 * math.pi / sides
                n = np.array([math.cos(a)*math.cos(b), math.sin(b), math.sin(a)*math.cos(b)])
                p = np.array([major_radius*math.cos(a), 0, major_radius*math.sin(a)]) + minor_radius*n
                vertices.append((matrix @ p + center).tolist()); normals.append((matrix @ n).tolist())
        for i in range(segments):
            for j in range(sides):
                a = i*sides+j; b = ((i+1)%segments)*sides+j
                c = ((i+1)%segments)*sides+(j+1)%sides; d = i*sides+(j+1)%sides
                faces.extend([[a, c, b], [a, d, c]])
        return self.mesh(vertices, faces, material, normals=normals)

    def volume(self, lower: Vector, upper: Vector, *, kind: int = 0,
               extinction: float | Vector = 1, albedo: float | Vector = 0.95, g: float = 0.2,
               scale: float = 2, lobes: list | None = None, grid: str | None = None, phase: str = "hg") -> int:
        if phase not in ("hg", "isotropic", "rayleigh"):
            raise ValueError("Unsupported phase function")
        if phase == "isotropic": g = 0.0
        self.volumes.append({"kind": kind, "lower": vec(lower), "upper": vec(upper),
                             "extinction": vec(extinction), "albedo": vec(albedo), "g": g,
                             "scale": scale, "majorant": 1.0, "lobes": lobes or [], "grid": grid, "phase": phase})
        return len(self.volumes)-1

    def save(self, path: str | Path) -> Path:
        from .workflow import validate_scene
        validate_scene(self)
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = ["# CYBR LIGHT scene 0.2 — independent native renderer", f"# {self.name}"]
        def asset_path(value: str) -> str:
            source = (Path(self.asset_base) / value).resolve()
            # Native scene assets resolve relative to the scene, never the process cwd.
            try:
                relative=os.path.relpath(source,path.parent.resolve())
            except ValueError:  # Windows assets and bakes may live on different drives.
                relative=str(source)
            return json.dumps(relative)
        def emit(*parts: Any) -> None:
            values = []
            def flatten(item: Any) -> None:
                if isinstance(item, (list, tuple, np.ndarray)):
                    for x in item: flatten(x)
                elif isinstance(item, bool): values.append(str(int(item)))
                elif isinstance(item, float): values.append(format(item, ".17g"))
                else: values.append(str(item))
            for part in parts: flatten(part)
            lines.append(" ".join(values))
        legacy = ("width", "height", "spp", "bands", "max_depth", "rr_depth", "threads", "seed", "exposure", "polarized", "ad", "active_material", "mis", "nee")
        emit("settings", *(getattr(self.settings, k) for k in legacy))
        emit("film_format", self.settings.film_format)
        emit("render_options", self.settings.integrator, self.settings.sampler, self.settings.filter, self.settings.ao_distance)
        emit("photon_options", self.settings.photon_count, self.settings.photon_radius)
        c = self.camera
        emit("camera", vec(c.origin), vec(c.target), vec(c.up), c.fov, c.aperture, c.focus,
             c.shutter_open, c.shutter_close, c.orthographic, c.ortho_scale)
        if c.spherical: emit("camera_spherical")
        for i, m in enumerate(self.materials):
            emit("material", m.type, vec(m.color), m.roughness, m.ior_a, m.ior_b, vec(m.eta),
                 vec(m.k), vec(m.absorption), m.emission, m.kelvin)
            lines.append(f"sidedness {i} {int(m.two_sided)}")
            if m.shader: emit("shader", i, asset_path(str(m.shader)), m.shader_parameters)
            if m.alpha_u > 0: emit("anisotropy", i, m.alpha_u, m.alpha_v or m.alpha_u)
            if m.film_nm > 0: emit("thin_film", i, m.film_nm, m.film_ior, vec(m.film_gradient))
            if m.children[0] >= 0: emit("nested", i, *m.children, m.weight)
            if m.opacity != 1: emit("coverage", i, m.opacity)
            if m.bump_scale != 1: emit("bump_scale", i, m.bump_scale)
            if m.texture: emit("texture", i, asset_path(str(m.texture)), m.uv_scale, m.texture_repeat)
            if m.roughness_texture: emit("roughness_texture", i, asset_path(str(m.roughness_texture)), m.uv_scale, m.texture_repeat)
            if m.scattering: emit("interior_scattering", i, m.scattering, m.phase_g)
            if m.texture_ior: emit("texture_ior", i, True)
            if m.uv_checker: emit("uv_checker", i)
            if m.checker:
                emit("checker", i, m.checker, vec(m.second))
            if m.type in ("polarizer", "retarder"):
                emit("optic", i, vec(m.axis), m.angle, m.retardance)
            for parameter, filename in m.spectra.items():
                emit("spectrum", i, parameter, asset_path(filename))
        if self.observer_path:
            emit("observer", asset_path(self.observer_path))
        emit("environment", self.environment["color"], self.environment["strength"])
        if self.environment.get("flat"): emit("environment_flat")
        if self.environment.get("texture"): emit("envmap", asset_path(self.environment["texture"]), self.environment.get("rotation", 0))
        for light in self.delta_lights:
            emit("delta_light", light["kind"], light["position"], light["direction"], light["intensity"], light["scale"], light["cutoff"], light["beam"])
        for lobe in self.environment["lobes"]:
            emit("env_lobe", lobe["direction"], lobe["exponent"], lobe["strength"], lobe.get("kelvin", 6500))
        for index, p in enumerate(self.primitives):
            kind = p["type"]
            args = [kind, p["material"], p["object"]]
            if kind == "sphere": args += [p["center"], p["radius"]]
            elif kind == "quad": args += [p["corner"], p["u"], p["v"]]
            elif kind in ("disk", "cylinder"): args += [p["a"], p["b"], p["radius"]]
            else: args += [p["vertices"], p["normals"], p["smooth"]]
            emit(*args, p["velocity"])
            if p.get("uv") is not None:
                emit("surface_uv", index, [[u, v, 0] for u, v in p["uv"]])
            if p.get('vertex_albedo') is not None:
                emit('surface_material',index,p['vertex_albedo'],p['vertex_parameters'])
        for i, v in enumerate(self.volumes):
            emit("volume", v["kind"], v["lower"], v["upper"], v["extinction"], v["albedo"],
                 v["g"], v["scale"], v["majorant"])
            if v.get("phase", "hg") == "rayleigh": emit("phase", i, 1)
            for lobe in v["lobes"]:
                emit("cloud_lobe", i, lobe["center"], lobe["radii"], lobe.get("strength", 1))
            if v["grid"]:
                from .volume_io import native_density_path
                native_grid=native_density_path(Path(self.asset_base)/v["grid"])
                emit("grid", i, asset_path(str(native_grid)))
        path.write_text("\n".join(lines) + "\n")
        metadata = {"name": self.name, "settings": asdict(self.settings), "camera": asdict(self.camera),
                    "materials": [asdict(m) for m in self.materials], "primitives": len(self.primitives),
                    "volumes": len(self.volumes), "notes": self.notes}
        path.with_suffix(".scene.json").write_text(json.dumps(metadata, indent=2, default=lambda v: v.tolist()))
        return path


def read_pfm(path: str | Path) -> np.ndarray:
    with Path(path).open("rb") as stream:
        kind = stream.readline().strip()
        if kind not in (b"PF", b"Pf"): raise ValueError("Not a PFM image")
        width, height = map(int, stream.readline().split())
        scale = float(stream.readline())
        if width <= 0 or height <= 0 or not math.isfinite(scale) or scale == 0:
            raise ValueError("Invalid PFM dimensions or scale")
        channels = 3 if kind == b"PF" else 1
        data = np.fromfile(stream, dtype="<f4" if scale < 0 else ">f4")
        if data.size != width*height*channels: raise ValueError("Truncated PFM image")
        return np.flipud(data.reshape(height, width, channels)).copy() * abs(scale)


def render(scene: Scene | str | Path, output: str | Path, *, executable: str | Path | None = None,
           spp: int | None = None, size: tuple[int, int] | None = None, bands: int | None = None,
           threads: int | None = None, resume: str | Path | None = None, checkpoint: str | Path | None = None) -> dict:
    root = Path(__file__).resolve().parents[2]
    selected = executable or os.environ.get("CYBR_LIGHT_BINARY")
    if not selected:
        local = root / "build" / "cybr-light"
        selected = local if local.is_file() else shutil.which("cybr-light") or local
    exe = Path(selected).resolve()
    if not exe.exists():
        raise FileNotFoundError(f"Build renderer first: cmake -S {root} -B {root / 'build'} && cmake --build {root / 'build'} -j")
    output = Path(output); output.parent.mkdir(parents=True, exist_ok=True)
    scene_path = scene.save(output.with_suffix(".cys")) if isinstance(scene, Scene) else Path(scene)
    command = [str(exe), "--scene", str(scene_path), "--out", str(output)]
    if spp is not None: command += ["--spp", str(spp)]
    if size is not None: command += ["--size", *map(str, size)]
    if bands is not None: command += ["--bands", str(bands)]
    if threads is not None: command += ["--threads", str(threads)]
    if resume is not None: command += ["--resume", str(resume)]
    if checkpoint is not None: command += ["--checkpoint", str(checkpoint)]
    subprocess.run(command, check=True)
    from PIL import Image
    Image.open(output.with_suffix(".ppm")).save(output.with_suffix(".png"))
    return json.loads(output.with_suffix(".json").read_text())


from .workflow import load_dict, load_file, traverse, ScalarTransform4f, register_bsdf, register_shape, plugins, save_snapshot, load_snapshot, bundle_scene, rebuild_shaders
