"""Resolve native mineral detail to the physical portfolio material footprint.

The landscape still has every original closed rock, grain and terrain face.
Only unresolved unlit albedo samples are integrated, separately for sediment
and mineral rocks. Water, vegetation, clothing and CAD finishes are excluded.
"""
from pathlib import Path
import argparse, hashlib, json, sys
import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'cybr-geo/src'))
from mechanism_lab.core import load_cache

MINERALS = ('scenes__Closed_terrain_and_basin', 'scenes__Native_mineral_rock_union')
LUMA = np.array([.2126, .7152, .0722])


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''): h.update(block)
    return h.hexdigest()


def integrate_albedo(vertices, colors, footprint_mm=.6):
    """Gaussian area estimate on a density-neutral physical sample lattice.

    Mesh density is not material area: Boolean cuts and inward micro-shells
    add repeated samples. Average a 0.06 mm lattice first so those vertices
    cannot dominate the mineral field. A 0.3 mm standard deviation resolves
    grit below roughly two pixels in the portfolio's bowl view while keeping
    millimetre-scale staining and the original palette.
    """
    v = np.asarray(vertices, dtype=np.float64)
    c = np.asarray(colors, dtype=np.float64)
    if v.shape != c.shape or v.ndim != 2 or v.shape[1] != 3 or not len(v):
        raise ValueError('Expected one RGB albedo sample per 3D vertex')
    if not np.isfinite(v).all() or not np.isfinite(c).all() or (c < 0).any() or (c > 1).any():
        raise ValueError('Invalid physical mineral samples')
    if not np.isfinite(footprint_mm) or footprint_mm <= 0:
        raise ValueError('Material footprint must be positive')
    # Repeated interface vertices have the same source-field sample. Remove
    # exact positional repetition before lattice integration so tessellation
    # and Boolean seam duplication cannot change the material weighting.
    _, unique_ids = np.unique(v, axis=0, return_index=True)
    sample_vertices, sample_colors = v[unique_ids], c[unique_ids]
    lattice = footprint_mm / 10
    cells, inverse = np.unique(np.floor(sample_vertices/lattice).astype(np.int64), axis=0, return_inverse=True)
    count = np.bincount(inverse, minlength=len(cells))
    points = np.column_stack([np.bincount(inverse, weights=sample_vertices[:,j], minlength=len(cells))/count for j in range(3)])
    values = np.column_stack([np.bincount(inverse, weights=sample_colors[:,j], minlength=len(cells))/count for j in range(3)])
    tree = cKDTree(points)
    k = min(64, len(points)); sigma = footprint_mm/2
    result = np.empty_like(c)
    # Bound neighbour-array memory rather than materializing the whole model.
    for start in range(0, len(v), 8192):
        end = min(start+8192, len(v))
        distance, ids = tree.query(v[start:end], k=k)
        if k == 1: distance, ids = distance[:,None], ids[:,None]
        weight = np.exp(-.5*(distance/sigma)**2)
        weight[distance > footprint_mm*1.5] = 0
        weight[:,0] = np.maximum(weight[:,0], 1e-9)
        smooth = (values[ids]*weight[:,:,None]).sum(axis=1)/weight.sum(axis=1)[:,None]
        # Retain a small, authored mineral-grain modulation after integrating
        # the unresolved frequencies; this is not illumination or AO.
        result[start:end] = smooth*.88+c[start:end]*.12
    before, after = c@LUMA, result@LUMA
    return result.astype('<f4'), {
        'vertices':len(v), 'materialSamples':len(points), 'footprintMM':footprint_mm,
        'standardDeviationMM':sigma, 'latticeMM':lattice, 'neighbors':k,
        'retainedOriginalFineAlbedoFraction':.12,
        'meanLuminanceBefore':float(before.mean()), 'meanLuminanceAfter':float(after.mean()),
        'rmsAlbedoChange':float(np.sqrt(np.mean((result-c)**2))),
        'luminanceQuantilesBefore':np.quantile(before,[.01,.5,.99]).tolist(),
        'luminanceQuantilesAfter':np.quantile(after,[.01,.5,.99]).tolist(),
    }


def build_filtered_albedo(directory, assembly=None):
    directory = Path(directory)
    source = directory/'albedo.npz'; target = directory/'albedo-filtered.npz'
    if assembly is None: assembly = load_cache(directory/'cache')
    parts = {part.name:part for part in assembly.parts}
    with np.load(source) as data: arrays = {name:data[name].copy() for name in data.files}
    report = {
        'operation':'Physical footprint integration of unlit native mineral albedo',
        'sourceAlbedoSHA256':digest(source), 'sourceFile':'albedo.npz',
        'outputFile':target.name, 'geometryChanged':False, 'illuminationBaked':False,
        'protectedParts':[name for name in arrays if name not in MINERALS], 'minerals':{},
    }
    for name in MINERALS:
        if name not in arrays or name not in parts: raise ValueError('Missing original mineral part: '+name)
        arrays[name], stats = integrate_albedo(parts[name].vertices, arrays[name])
        stats['positionSHA256'] = hashlib.sha256(np.asarray(parts[name].vertices).tobytes()).hexdigest()
        stats['indexSHA256'] = hashlib.sha256(np.asarray(parts[name].faces).tobytes()).hexdigest()
        report['minerals'][name] = stats
    np.savez_compressed(target, **arrays)
    report['outputAlbedoSHA256'] = digest(target)
    (directory/'albedo-filtering.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, default=ROOT/'portfolio/output/geo-working/organics')
    report = build_filtered_albedo(parser.parse_args().directory)
    print(json.dumps({k:report[k] for k in ('outputFile','outputAlbedoSHA256','geometryChanged','minerals')}))
