"""Closed native mesh volumes for terrain inserts and imported rock fragments.

Mechanical interfaces still use analytic CAD. These operations preserve source
surface coordinates while giving organic geometry explicit, checkable volumes.
"""
from __future__ import annotations

import numpy as np
import trimesh
from scipy.spatial import ConvexHull, Delaunay


def topology(mesh):
    counts = np.bincount(mesh.edges_unique_inverse)
    return {
        'vertices': len(mesh.vertices), 'triangles': len(mesh.faces),
        'boundaryEdges': int((counts == 1).sum()),
        'nonmanifoldEdges': int((counts > 2).sum()),
        'watertight': bool(mesh.is_watertight),
        'consistentWinding': bool(mesh.is_winding_consistent),
        'volumeMM3': float(mesh.volume),
    }


def checked_volume(vertices, faces, name='mesh'):
    indexed = trimesh.Trimesh(vertices, faces, process=False)
    indexed.update_faces(indexed.unique_faces())
    indexed.update_faces(indexed.area_faces>1e-18)
    indexed.remove_unreferenced_vertices()
    # Negative inner boundary shells represent real cavities. Independently
    # making every disconnected shell outward would fill those cavities again.
    if not indexed.is_volume:indexed.fix_normals(multibody=False)
    mesh = trimesh.Trimesh(vertices, faces, process=True)
    mesh.update_faces(mesh.unique_faces())
    mesh.update_faces(mesh.area_faces>1e-18)
    mesh.remove_unreferenced_vertices()
    if not mesh.is_volume:mesh.fix_normals(multibody=False)
    report = topology(mesh)
    # A volume Boolean may retain distinct closed components touching at a
    # point/edge. Global coordinate welding would turn that legitimate contact
    # into a branching indexed edge. Preserve the Boolean's actual identities;
    # never accept an open or inconsistently wound indexed input this way.
    if not mesh.is_volume and indexed.is_volume and report['nonmanifoldEdges']:
        welded=report
        mesh=indexed;report=topology(mesh)
        report.update(coincidentContactsPreserved=True,
            coordinateWeldNonmanifoldEdges=welded['nonmanifoldEdges'],
            topologyPolicy='Preserved independently indexed closed components at zero-volume contacts')
    if not np.isfinite(mesh.vertices).all() or not mesh.is_volume:
        raise ValueError(f'{name} is not a finite, consistently wound closed volume: {report}')
    return mesh, report


def boolean_volumes(meshes, operation):
    """Native 64-bit Manifold volume Boolean preserving microscopic geometry.

    Trimesh's convenience wrapper casts all geometry to float32. CYBR GEO uses
    the engine's Mesh64 round-trip so thin native mineral chips and cut edges
    keep their actual coordinates and oriented cavity shells.
    """
    import manifold3d as manifold
    if not meshes or not all(m.is_volume for m in meshes):
        raise ValueError('All Boolean inputs must be actual closed oriented volumes')
    operators={'union':manifold.OpType.Add,'difference':manifold.OpType.Subtract,
               'intersection':manifold.OpType.Intersect}
    if operation not in operators:raise ValueError('Unsupported volume Boolean')
    inputs=[]
    for m in meshes:
        native=manifold.Manifold(manifold.Mesh64(
            vert_properties=np.array(m.vertices,dtype=np.float64,order='C',copy=True),
            tri_verts=np.array(m.faces,dtype=np.uint64,order='C',copy=True)))
        if native.status()!=manifold.Error.NoError:
            raise ValueError(f'Native volume import failed: {native.status()}')
        inputs.append(native)
    result=manifold.Manifold.batch_boolean(inputs,operators[operation])
    if result.status()!=manifold.Error.NoError:
        raise ValueError(f'Native volume Boolean failed: {result.status()}')
    packed=result.to_mesh64()
    return trimesh.Trimesh(np.asarray(packed.vert_properties)[:,:3],
        np.asarray(packed.tri_verts,dtype=np.int64),process=False)


def seal_heightfield(vertices, faces, bottom_z):
    """Close a single-valued source heightfield using its *same* boundary.

    Rebuild the planar connectivity from retained source vertices. This repairs
    nonmanifold LOD triangles without rasterizing or inventing new height values.
    The convex footprint is explicit; concave footprints must use another API.
    """
    source = np.asarray(vertices, dtype=np.float64)
    if source.ndim != 2 or source.shape[1] != 3 or not np.isfinite(source).all():
        raise ValueError('Expected finite XYZ source vertices')
    if bottom_z >= source[:, 2].min():
        raise ValueError('Section base must lie below the whole heightfield')
    xy, index = np.unique(source[:, :2], axis=0, return_index=True)
    if len(xy) != len(source):
        raise ValueError('Heightfield has multiple source heights at one XY coordinate')
    v = source[index]
    top = Delaunay(xy).simplices.copy()
    cross = np.cross(v[top[:, 1]] - v[top[:, 0]], v[top[:, 2]] - v[top[:, 0]])
    reverse = cross[:, 2] < 0
    top[reverse] = top[reverse, ::-1]
    boundary = ConvexHull(xy).vertices
    bottom = np.column_stack((v[boundary, :2], np.full(len(boundary), bottom_z)))
    start = len(v)
    center = start + len(boundary)
    closed_vertices = np.vstack((v, bottom, [*xy[boundary].mean(axis=0), bottom_z]))
    sides = []
    for j, a in enumerate(boundary):
        k = (j + 1) % len(boundary)
        b = boundary[k]
        sides.extend([[a, start+j, b], [b, start+j, start+k], [center, start+k, start+j]])
    mesh, report = checked_volume(closed_vertices, np.vstack((top, sides)), 'sealed heightfield')
    report.update(sourceVertices=len(source), retainedSourceHeights=True,
                  boundaryVertices=len(boundary), bottomZMM=float(bottom_z),
                  connectivity='Delaunay source XY; exact shared boundary wall and cap',
                  sourceTopology=topology(trimesh.Trimesh(source, faces, process=True)))
    return mesh, report


def subtract_volume(solid, cavity, name='carved solid'):
    """Perform an actual volume Boolean, then verify the retained mesh."""
    result = boolean_volumes([solid,cavity],'difference')
    if result is None or len(result.faces) == 0:
        raise ValueError('Volume subtraction removed the entire solid')
    result, report = checked_volume(result.vertices, result.faces, name)
    overlap = boolean_volumes([result,cavity],'intersection')
    residual = 0.0 if overlap is None or len(overlap.faces) == 0 else abs(float(overlap.volume))
    tolerance = max(1e-4, solid.volume * 1e-7)
    if residual > tolerance:
        raise ValueError(f'Volume subtraction left {residual} mm³ inside the cavity')
    report.update(sourceVolumeMM3=float(solid.volume), cavityVolumeMM3=float(cavity.volume),
                  residualIntersectionMM3=residual, intersectionToleranceMM3=tolerance,
                  nativeBooleanPrecision='float64 Mesh64/to_mesh64; oriented nested cavities retained')
    return result, report


def cap_open_component(mesh):
    """Cap simple cut loops on an imported component, preserving its exterior."""
    import mapbox_earcut
    mesh = mesh.copy()
    counts = np.bincount(mesh.edges_unique_inverse)
    if (counts > 2).any():
        raise ValueError('A component with branching edges needs source repair')
    boundary = mesh.edges_unique[counts == 1]
    if not len(boundary):
        return checked_volume(mesh.vertices, mesh.faces, 'imported component')[0]
    neighbors = {}
    for a, b in boundary:
        neighbors.setdefault(int(a), []).append(int(b))
        neighbors.setdefault(int(b), []).append(int(a))
    if any(len(n) != 2 for n in neighbors.values()):
        raise ValueError('Cut boundary is not a collection of simple loops')
    remaining = set(neighbors)
    caps = []
    while remaining:
        first = min(remaining)
        loop, previous, current = [first], -1, first
        while True:
            following = next(n for n in neighbors[current] if n != previous)
            if following == first:
                break
            if following in loop:
                raise ValueError('Self-connected boundary loop')
            loop.append(following)
            previous, current = current, following
        remaining.difference_update(loop)
        points = np.asarray(mesh.vertices)[loop]
        _, _, axes = np.linalg.svd(points - points.mean(axis=0), full_matrices=False)
        planar = np.ascontiguousarray((points - points.mean(axis=0)) @ axes[:2].T)
        triangles = mapbox_earcut.triangulate_float64(planar, np.array([len(loop)], dtype=np.uint32))
        if len(triangles) != (len(loop)-2)*3:
            raise ValueError('Could not triangulate the complete cut boundary')
        caps.extend(np.asarray(loop)[triangles.reshape(-1, 3)].tolist())
    vertices = np.asarray(mesh.vertices)
    faces = np.vstack((mesh.faces, caps))
    return checked_volume(vertices, faces, 'capped imported component')[0]


def thicken_open_surface(mesh, thickness=.03):
    """Make a closed chip from an actual open source patch.

    Retains the complete original exterior at exactly its original coordinates.
    Only an inward, nominal normal offset and the patch's real boundary walls
    are added. This is not a convex hull, image skin, or reconstructed outline.
    Intended for clipped mineral chips, not a replacement for a solid rock.
    """
    if not np.isfinite(thickness) or thickness <= 0:
        raise ValueError('Nominal chip thickness must be positive and finite')
    source=mesh.copy()
    source.update_faces(source.unique_faces())
    source.update_faces(source.nondegenerate_faces())
    source.remove_unreferenced_vertices()
    if len(source.faces)==0 or not np.isfinite(source.vertices).all():
        raise ValueError('Cannot thicken an empty/nonfinite patch')
    source.fix_normals(multibody=True)
    counts=np.bincount(source.edges_unique_inverse)
    if (counts>2).any() or not source.is_winding_consistent:
        raise ValueError('Patch must have a consistent nonbranching source surface')
    boundary=source.edges[counts[source.edges_unique_inverse]==1]
    if not len(boundary):
        raise ValueError('A closed source rock must not be thickened into a shell')
    degree=np.bincount(boundary.ravel(),minlength=len(source.vertices))
    if np.any((degree!=0)&(degree!=2)):
        raise ValueError('Patch has a branched or self-connected boundary')
    vertices=np.asarray(source.vertices,dtype=np.float64)
    normals=np.array(source.vertex_normals,dtype=np.float64,copy=True)
    magnitude=np.linalg.norm(normals,axis=1)
    if np.any(magnitude<1e-8) or not np.isfinite(normals).all():
        raise ValueError('Patch has undefined offset directions')
    normals/=magnitude[:,None]
    count=len(vertices)
    closed_vertices=np.vstack((vertices,vertices-normals*thickness))
    front=np.asarray(source.faces,dtype=np.int64)
    back=front[:,::-1]+count
    # Directed source boundary edges determine the outward wall winding.
    sides=np.array([[a,a+count,b] for a,b in boundary]+
                   [[b,a+count,b+count] for a,b in boundary],dtype=np.int64)
    result,report=checked_volume(closed_vertices,np.vstack((front,back,sides)),'normal-offset mineral chip')
    report.update(method='Preserved native exterior + inward normal offset + exact source boundary walls',
        nominalThicknessMM=float(thickness),sourceVertices=len(vertices),sourceTriangles=len(front),
        exteriorCoordinatesModified=False,boundaryEdgesAdded=len(boundary),hiddenHull=False)
    return result,report
