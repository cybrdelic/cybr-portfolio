"""Literal transparent CAD/organic model icons for the working portfolio rail.

Reads the staged, validated caches. No generated imagery or geometry edits.
Run with D:/CYBR-build/exploded-instrument/venv/Scripts/python.exe.
"""
from pathlib import Path
import argparse, copy, hashlib, json, sys
import numpy as np
import vtk
from vtk.util.numpy_support import numpy_to_vtk, numpy_to_vtkIdTypeArray, vtk_to_numpy
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'cybr-geo/src'))
from mechanism_lab.core import load_cache

WORK = ROOT / 'portfolio/output/geo-working'
OUT = ROOT / 'portfolio/assets/instrument-working-v1'


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()


def srgb(rgb):
    rgb = np.clip(np.asarray(rgb), 0, 1)
    return np.where(rgb <= .0031308, rgb*12.92, 1.055*rgb**(1/2.4)-.055)


def actor(part, material, color=None, water=False):
    poly = vtk.vtkPolyData()
    points = vtk.vtkPoints()
    points.SetData(numpy_to_vtk(np.ascontiguousarray(part.vertices, dtype=np.float32), deep=True))
    poly.SetPoints(points)
    faces = np.ascontiguousarray(part.faces, dtype=np.int64)
    cells = vtk.vtkCellArray()
    cells.SetData(numpy_to_vtkIdTypeArray(np.arange(len(faces)+1, dtype=np.int64)*3, deep=True),
                  numpy_to_vtkIdTypeArray(faces.ravel(), deep=True))
    poly.SetPolys(cells)
    normals = np.asarray(part.normals, dtype=np.float32)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    poly.GetPointData().SetNormals(numpy_to_vtk(np.ascontiguousarray(normals), deep=True))
    mapper = vtk.vtkPolyDataMapper(); mapper.SetInputData(poly)
    if color is not None:
        if len(color) != len(part.vertices): raise ValueError(part.name + ': albedo count differs from geometry')
        colors = numpy_to_vtk(np.ascontiguousarray(np.round(srgb(color[:, :3])*255).astype(np.uint8)), deep=True)
        colors.SetName('OriginalNativeAlbedo')
        poly.GetPointData().SetScalars(colors)
        mapper.SetColorModeToDirectScalars(); mapper.SetScalarModeToUsePointData(); mapper.ScalarVisibilityOn()
    else: mapper.ScalarVisibilityOff()
    result = vtk.vtkActor(); result.SetMapper(mapper)
    prop = result.GetProperty(); prop.SetColor(*srgb(material.color)); prop.SetInterpolationToPhong()
    prop.SetAmbient(.20); prop.SetDiffuse(.76)
    prop.SetSpecular(.38 if material.metal > .5 else .10)
    prop.SetSpecularPower(float(12 + (1-material.rough)*65))
    prop.SetOpacity(.73 if water else material.opacity)
    if water:
        # Keep the tiny pool legible: a broad raster highlight must not clip the
        # entire lake to white at icon scale. Native color/geometry are retained.
        prop.SetDiffuse(.55); prop.SetAmbient(.18)
        prop.SetSpecular(.28); prop.SetSpecularPower(75)
    return result


def render(module, organics, albedo, size=320):
    core = module in ('geo', 'light', 'elements', 'song')
    source = WORK / 'core-cad' / 'runtime-cache' if core else WORK / 'cad-cartridges' / module / 'cache'
    cad = load_cache(source)
    if core:
        metadata = json.loads((WORK / 'core-cad' / 'metadata.json').read_text())
        # Reuse the exact compact native pose used by the live instrument.
        # A thumbnail must follow a geometry revision rather than showing the
        # earlier flat artwork after the physical shell has changed.
        selected_cad = []
        for original in cad.parts:
            if original.group != module: continue
            part = copy.copy(original)
            part.vertices = original.vertices.copy()
            part.vertices[:, 0] += metadata['parts'][part.name]['assemblyShiftX']
            selected_cad.append(part)
        cad.parts = selected_cad
    selected = [p for p in organics.parts if p.group == module]
    if module == 'combat' and len(selected) != 5: raise ValueError('Expected the five actual humanoid body/garment meshes')
    renderer = vtk.vtkRenderer()
    renderer.SetBackground(*(244/255, 244/255, 242/255)); renderer.SetBackgroundAlpha(0)
    renderer.SetUseDepthPeeling(True); renderer.SetMaximumNumberOfPeels(100); renderer.SetOcclusionRatio(.025)
    actors = []
    for p in cad.parts:
        a = actor(p, cad.materials[p.material]); actors.append(a); renderer.AddActor(a)
    for p in selected:
        a = actor(p, organics.materials[p.material], albedo[p.name] if p.name in albedo else None,
                  water=p.name == 'scenes__Closed_native_spring_water')
        actors.append(a); renderer.AddActor(a)
    vertices = np.concatenate([p.vertices for p in cad.parts] + [p.vertices for p in selected])
    lo, hi = vertices.min(0), vertices.max(0); center = (lo+hi)/2
    extent = np.linalg.norm(hi-lo)
    direction = np.asarray([50., -80., 50.]); direction /= np.linalg.norm(direction)
    camera = vtk.vtkCamera(); camera.SetPosition(*(center+direction*extent*2.5)); camera.SetFocalPoint(*center)
    camera.SetViewUp(0, 0, 1); camera.ParallelProjectionOn(); renderer.SetActiveCamera(camera)
    renderer.ResetCamera(); camera.SetPosition(*(center+direction*extent*2.5)); camera.SetFocalPoint(*center)
    # Measure screen-plane bounds explicitly so every source part is retained.
    right = np.cross(direction, [0, 0, 1]); right /= np.linalg.norm(right)
    up = np.cross(right, direction); uv = np.column_stack(((vertices-center)@right, (vertices-center)@up))
    projected_center = (uv.min(0)+uv.max(0))/2
    focal = center + right*projected_center[0] + up*projected_center[1]
    camera.SetFocalPoint(*focal); camera.SetPosition(*(focal+direction*extent*2.5))
    camera.SetParallelScale(float(max(np.ptp(uv[:, 0]), np.ptp(uv[:, 1]))/2*1.12))
    renderer.ResetCameraClippingRange()
    for vector, power in [([.4, -.9, 1.4], .9), ([-1, -.3, .7], .55), ([.6, 1, .9], .7)]:
        light = vtk.vtkLight(); light.SetLightTypeToSceneLight(); light.PositionalOff()
        light.SetPosition(*(center+np.asarray(vector)*extent*3)); light.SetFocalPoint(*center); light.SetIntensity(power)
        renderer.AddLight(light)
    window = vtk.vtkRenderWindow(); window.SetOffScreenRendering(1); window.SetShowWindow(False)
    window.SetSize(size, size); window.SetAlphaBitPlanes(1); window.SetMultiSamples(0); window.AddRenderer(renderer)
    window.Render()
    capture = vtk.vtkWindowToImageFilter(); capture.SetInput(window); capture.SetInputBufferTypeToRGBA()
    capture.ReadFrontBufferOff(); capture.Update()
    pixels = vtk_to_numpy(capture.GetOutput().GetPointData().GetScalars()).reshape(size, size, 4)[::-1].copy()
    image = Image.fromarray(pixels, 'RGBA')
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / ('thumb-' + module + '.webp'); image.save(target, 'WEBP', lossless=True, method=6)
    preview = Image.new('RGB', image.size, '#f4f4f2'); preview.paste(image, mask=image.getchannel('A'))
    preview_path = WORK / ('thumb-' + module + '-preview.png'); preview.save(preview_path)
    window.Finalize()
    alpha = np.asarray(image.getchannel('A'))
    if not (alpha.max() > 0 and alpha.min() == 0): raise ValueError(module + ': expected transparent geometry render')
    bbox = image.getchannel('A').getbbox()
    if bbox is None or min(bbox[2]-bbox[0], bbox[3]-bbox[1]) < size*.45: raise ValueError(module + ': model framing is too small')
    return dict(module=module, file=str(target), preview=str(preview_path), size=[size, size], bytes=target.stat().st_size,
                sha256=sha(target), alphaBounds=list(bbox), CADParts=len(cad.parts), organicParts=len(selected),
                sourceTriangles=sum(len(p.faces) for p in cad.parts+selected), cameraDirection=[50, -80, 50],
                sourceCaches={str(source/'manifest.json'):sha(source/'manifest.json'),
                              str(WORK/'organics/cache/manifest.json'):sha(WORK/'organics/cache/manifest.json')},
                nativeAlbedoParts=[p.name for p in selected if p.name in albedo], generatedImages=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--size', type=int, default=320)
    parser.add_argument('--modules', nargs='+', choices=('geo', 'light', 'elements', 'song', 'combat', 'scenes'), default=('combat', 'scenes'))
    args = parser.parse_args()
    organic = load_cache(WORK/'organics/cache')
    albedo_source = WORK/'organics/albedo-filtered.npz'
    if not albedo_source.exists(): albedo_source = WORK/'organics/albedo.npz'
    with np.load(albedo_source) as colors:
        records = [render(module, organic, colors, args.size) for module in args.modules]
    for record in records:
        record['materialSamplesSHA256'] = sha(albedo_source)
        record['materialSamplesFile'] = str(albedo_source)
    receipt_path = WORK/'working-thumbnails-receipt.json'
    previous = json.loads(receipt_path.read_text()) if receipt_path.exists() else []
    updated = {record['module']: record for record in previous + records}
    receipt_path.write_text(json.dumps(list(updated.values()), indent=2)+'\n')
    print(json.dumps([{k:r[k] for k in ('module', 'file', 'size', 'bytes', 'CADParts', 'organicParts')} for r in records]))
