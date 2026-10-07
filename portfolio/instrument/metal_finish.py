"""Measured conductor finishes and tessellation-independent lathe coordinates.

Optical constants: refractiveindex.info database (CC0), Al/Rakic,
Cr/Johnson and Ni/Johnson. Chromium is a finish, not a steel-alloy dataset.
Geometry and camera remain unchanged for the material comparison.
"""
import hashlib
import json
import numpy as np


def configure(scene, folder, microfinish=False):
    root = folder / 'studio' / 'optical-constants'
    provenance = []
    for index, element, author, label, slopes in (
        (0, 'Al', 'Rakic', 'Machined aluminium', (.035, .095)),
        (1, 'Cr', 'Johnson', 'Polished chromium finish', (.018, .035)),
        (5, 'Ni', 'Johnson', 'Turned nickel cymbal', (.045, .12)),
    ):
        source = root / (element + '.yml')
        rows = []
        for line in source.read_text().splitlines():
            try:
                values = [float(x) for x in line.split()]
            except ValueError:
                continue
            if len(values) == 3:
                rows.append(values)
        data = np.asarray(rows)
        assert len(data) > 20 and np.isfinite(data).all()
        assert data[:, 0].min() <= .36 and data[:, 0].max() >= .83
        material = scene.materials[index]
        material.name, material.type = label, 'metal'
        material.alpha_u, material.alpha_v = slopes
        for column, quantity in ((1, 'eta'), (2, 'k')):
            path = root / f'{element}-{quantity}.spd'
            np.savetxt(path, np.column_stack((data[:, 0] * 1000, data[:, column])), fmt='%.9g')
            material.spectra[quantity] = str(path.resolve())
        provenance.append(dict(element=element, material=index,
            source=f'https://raw.githubusercontent.com/polyanskiy/refractiveindex.info-database/master/database/data/main/{element}/nk/{author}.yml',
            sha256=hashlib.sha256(source.read_bytes()).hexdigest(), license='CC0',
            alpha_u=slopes[0], alpha_v=slopes[1]))
    (root / 'provenance.json').write_text(json.dumps(provenance, indent=2))
    mapping = {}
    if microfinish:
        # A tiny normal perturbation, not geometry displacement. It is authored
        # finish variation; the optical constants above remain measured data.
        u = np.arange(256)[None,:] / 256
        v = np.arange(1024)[:,None] / 1024
        height = np.full((1024,256), .5)
        for frequency, amplitude in ((28,.2),(71,.10),(163,.045),(311,.018)):
            height += amplitude*np.sin(2*np.pi*(frequency*v+.025*np.sin(2*np.pi*u)))
        texture = root / 'lathe-microfinish.pfm'
        rgb = np.repeat(height[:,:,None],3,axis=2).astype('<f4')
        with texture.open('wb') as stream:
            stream.write(b'PF\n256 1024\n-1.0\n')
            stream.write(rgb[::-1].tobytes())
        for parent, strength in ((0,.00016),(1,.000055),(5,.00022)):
            mapping[parent] = scene.material(name=scene.materials[parent].name+' / machining',
                type='bumpmap', children=(parent,-1), texture=str(texture.resolve()),
                bump_scale=strength)
    return mapping


def machining_uv(part):
    """Circumferential U; axial V on barrels and radial V on end faces.

    Coordinates are per corner, so the angular seam never interpolates across
    the full circle. Offset fasteners use their own bounding-box axis.
    """
    v = part.vertices[part.faces].copy()
    center = (part.vertices.min(axis=0) + part.vertices.max(axis=0)) * .5
    v -= center
    theta = np.arctan2(v[:, :, 2], v[:, :, 1]) / (2 * np.pi)
    delta = theta - theta[:, :1]
    theta = theta[:, :1] + (delta + .5) % 1 - .5
    cap = np.abs(part.normals[part.faces].mean(axis=1)[:, 0]) > .7
    radius = np.hypot(v[:, :, 1], v[:, :, 2])
    vv = np.where(cap[:, None], radius / 40, v[:, :, 0] / 40)
    uv = np.stack((theta, vv, np.zeros_like(theta)), axis=-1)
    # Degenerate axis triangles receive a stable planar parameterization.
    d1, d2 = uv[:, 1] - uv[:, 0], uv[:, 2] - uv[:, 0]
    bad = np.abs(d1[:, 0]*d2[:, 1] - d1[:, 1]*d2[:, 0]) < 1e-12
    if bad.any():
        n = np.abs(part.normals[part.faces].mean(axis=1))
        for axis in range(3):
            mask = bad & (np.argmax(n, axis=1) == axis)
            axes = [a for a in range(3) if a != axis]
            uv[mask, :, :2] = v[mask][:, :, axes] / 40
    assert np.isfinite(uv).all()
    return uv.reshape(-1, 9)
