"""Repair the four retained cartridges with the workspace CYBR GEO CAD kernel.

Millimetres, X shaft, Z up. Source meshes/names are retained; mating features are
real OpenCascade solids. This is a geometric fit audit, not a load/pressure or
manufacturing certification. No published portfolio assets are written here.
"""
from __future__ import annotations
from pathlib import Path
from dataclasses import replace
import argparse, hashlib, json, math, sys, time
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'cybr-geo' / 'src'))
import cadquery as cq
from mechanism_lab.core import Assembly, cad_part, mesh_part, load_cache, save_cache, validate
from mechanism_lab.geometry import ring, drill, bolt_circle, tube_mesh
from mechanism_lab.advanced_geometry import toroidal_groove, strut

SOURCE = Path('D:/CYBR-build/exploded-instrument/geometry-v4')
DEFAULT_OUTPUT = ROOT / 'portfolio/output/geo-working/core-cad'
MODULES = ('geo', 'light', 'elements', 'song')
SHIFTS = {'geo__exploded_interface': -16., 'geo__floating_fastener': -24.,
          'light__exploded_rear_mount': 17., 'light__exploded_locking_ring': -21.,
          'light__floating_optic_screw': -3.}
COSMETIC = ('lathe', 'lathed_', 'knurl_', 'staff_', 'note_', 'stem_', '_thread_',
            'engraving', 'identification', 'index_mark_', 'braid_', 'flange_recess_',
            'identity_plate', 'turned_outer_edge_')


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest()


def shift(name):
    return next((v for k, v in SHIFTS.items() if name.startswith(k)), 0.)


def properties(q):
    return dict(type=q.ShapeType(), solids=len(q.Solids()), shells=len(q.Shells()),
                volumeMM3=float(q.Volume()), isValid=bool(q.isValid()))


def checked(q, name):
    # Do not unify same-domain faces blindly. OCCT 7.9's clean() changes the
    # imported two-sphere optical intersection into an invalid whole sphere.
    # Audit the exact imported/boolean result instead of silently healing it.
    d = properties(q)
    if not d['isValid'] or d['solids'] != 1 or d['volumeMM3'] <= 1e-8:
        raise ValueError(f'{name}: expected one positive valid closed CAD solid: {d}')
    return q


GEO_EDGE_BREAKS = {
    'geo__front_flange': ((47., .35), (29., .25)),
    'geo__rear_flange': ((47., .35), (24., .25)),
    'geo__exploded_interface': ((42., .35), (29., .25)),
    'geo__polished_shoulder_rear': ((45., .45),),
    'geo__polished_shoulder_front': ((45., .45),),
    'geo__knurled_service_band': ((44.4, .18),),
}


def geo_finished_shape(name, shape):
    """Real subtractive CAD edge treatment, preserving shaft/seat datums.

    Main annular edges are selected by their analytic radius, not a render
    normal or a triangulated bounding box. Inner cladding seats and cylindrical
    bore axes/radii remain unchanged; the listed bore mouths are chamfered.
    Fastener bearing faces likewise retain their exact plane.
    """
    actions, q = [], shape
    for radius, amount in GEO_EDGE_BREAKS.get(name, ()):
        edges = [e for e in q.Edges() if e.geomType() == 'CIRCLE'
                 and abs(e.radius() - radius) < 1e-6
                 and math.hypot(e.Center().y, e.Center().z) < 1e-6]
        if len(edges) != 2:
            raise ValueError(f'{name}: expected two unbroken r{radius} annular edges, got {len(edges)}')
        q = checked(q.chamfer(amount, None, edges), name)
        actions.append(dict(kind='annular-chamfer', radiusMM=radius, sizeMM=amount, edges=len(edges)))
    if name == 'geo__vented_monocoque':
        edges = []
        for edge in q.Edges():
            if edge.geomType() != 'LINE': continue
            points = [edge.positionAt(t) for t in (0., .25, .5, .75, 1.)]
            radial_error = max(abs(math.hypot(p.y, p.z) - 43.) for p in points)
            span = max(p.x for p in points) - min(p.x for p in points)
            if radial_error < 1e-5 and abs(span - 25.) < 1e-5: edges.append(edge)
        if len(edges) != 24:
            raise ValueError(f'{name}: expected 24 outer longitudinal vent edges, got {len(edges)}')
        q = checked(q.chamfer(.12, None, edges), name)
        actions.append(dict(kind='outer-vent-edge-chamfer', sizeMM=.12, edges=len(edges),
                            retained='vent end arcs, internal keyways and bolt bores'))
    if name.startswith(('geo__front_flange_bolt_', 'geo__rear_flange_bolt_', 'geo__floating_fastener_')) and name.endswith('_socket_head'):
        circles = [e for e in q.Edges() if e.geomType() == 'CIRCLE' and abs(e.radius() - 2.7) < 1e-6]
        if len(circles) != 2: raise ValueError(f'{name}: expected two head-rim circles')
        front = max(e.Center().x for e in circles)
        rim = [e for e in circles if abs(e.Center().x - front) < 1e-6]
        q = checked(q.chamfer(.20, None, rim), name)
        socket = [e for e in q.Edges() if e.geomType() == 'LINE'
                  and all(abs(e.positionAt(t).x - front) < 1e-6 for t in (0., .5, 1.))]
        if len(socket) != 6: raise ValueError(f'{name}: expected six socket-mouth edges')
        q = checked(q.chamfer(.12, None, socket), name)
        actions.extend((dict(kind='outward-head-rim-chamfer', sizeMM=.20, edges=len(rim)),
                        dict(kind='hex-socket-mouth-chamfer', sizeMM=.12, edges=len(socket),
                             retained='bearing face, socket bottom and bolt axis')))
    return q, actions


def revolve(points):
    return cq.Workplane('XY').polyline([(float(x), float(r)) for x, r in points]).close().revolve(360, (0, 0), (1, 0)).val()


def formed_song_cymbal(k, x):
    """A closed, smooth formed-bronze bell on the existing spindle datum.

    The first 3mm of radial seat keeps the retained clamping prescription. The
    bow then sweeps back 9--14mm from the bell instead of reading as a flat
    washer. The edge is a true rounded solid return, not a separate torus laid
    across a surface. Every shell has an open 14mm pilot hole and finite wall.
    """
    radius = (40., 35., 30.)[k]
    rim_depth = (-8., -6., -4.)[k]
    original_radius = 40. - 2*k
    def legacy_depth(r):
        return 5.6*math.exp(-((r-7)/7.5)**2) + 1.4*(r/original_radius)**2
    def smooth(t):
        t = max(0., min(1., t))
        return t*t*(3.-2.*t)
    def upper(r):
        # C1 blend begins beyond the felt/clamp's exact r=10mm contact edge.
        return x + legacy_depth(r) - (legacy_depth(radius)-rim_depth)*smooth((r-10)/(radius-10))
    def wall(r):
        original = .24 + .45*(1-r/original_radius)
        formed = .52 + .40*(1-r/radius)
        return original + (formed-original)*smooth((r-10)/6)
    rr = np.unique(np.r_[np.linspace(7, 10, 32), np.linspace(10, radius, 129)])
    top = [(upper(float(r)), float(r)) for r in rr]
    lower = [(upper(float(r))-wall(float(r)), float(r)) for r in reversed(rr)]
    mid_x = upper(radius)-wall(radius)/2
    q = (cq.Workplane('XY').moveTo(*top[0]).spline(top[1:], includeCurrent=True)
         .threePointArc((mid_x, radius+wall(radius)/2), lower[0])
         .spline(lower[1:], includeCurrent=True).close()
         .revolve(360, (0, 0), (1, 0)).val())
    return checked(q, f'song__dished_cymbal_{k}')


def sweep(points, radius):
    wire = cq.Wire.assembleEdges([cq.Edge.makeSpline([cq.Vector(*p) for p in points])])
    # Endpoint tangent is horizontal for this authored route. Keep the same
    # non-Frenet frame as the retained water exclusion, so their bores coincide.
    return cq.Workplane('YZ', origin=points[0]).circle(radius).sweep(cq.Workplane(obj=wire), isFrenet=False).val()


def helix(x, length, radius, section, pitch=.65):
    """Round crest, actual helical BREP, generated along Z then rotated to X."""
    w = cq.Wire.makeHelix(pitch, length, radius)
    q = cq.Workplane('XZ', origin=(radius, 0, 0)).circle(section).sweep(cq.Workplane(obj=w), isFrenet=True).val()
    return q.rotate((0, 0, 0), (0, 1, 0), 90).translate((x, 0, 0))


def audit_cached_meshes(output_dir=DEFAULT_OUTPUT, cache_name='cache'):
    """Independent cache/CAD identity and welded structural mesh topology audit."""
    import trimesh
    output_dir = Path(output_dir)
    a = load_cache(output_dir / cache_name)
    metadata = json.loads((output_dir / 'metadata.json').read_text())
    results, bad_hashes = [], []
    for p in a.parts:
        record = metadata['parts'][p.name]
        if record.get('brepFile'):
            if sha(output_dir / record['brepFile']) != record['brepSHA256']: bad_hashes.append(p.name)
        if 'structural' not in p.tags: continue
        m = trimesh.Trimesh(vertices=p.vertices, faces=p.faces, process=True)
        m.remove_unreferenced_vertices()
        expected_shells = record['cad']['shells']
        results.append(dict(name=p.name, triangles=len(p.faces), watertight=bool(m.is_watertight),
                            windingConsistent=bool(m.is_winding_consistent), signedVolumeMM3=float(m.volume),
                            connectedComponents=int(m.body_count), expectedBoundaryShells=expected_shells,
                            repaired=record['repaired']))
    failures = [d for d in results if not d['watertight'] or not d['windingConsistent'] or d['signedVolumeMM3'] <= 0 or d['connectedComponents'] != d['expectedBoundaryShells']]
    report = dict(scope='Welded exported structural triangle meshes; no cosmetic claims',
                  checked=len(results), failures=failures, brepHashFailures=bad_hashes,
                  passed=not failures and not bad_hashes, parts=results)
    metadata['runtimeStructuralMeshAudit' if cache_name != 'cache' else 'structuralMeshAudit'] = report
    (output_dir / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (output_dir / ('runtime-mesh-audit.json' if cache_name != 'cache' else 'mesh-audit.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(dict(meshAuditChecked=len(results), meshAuditFailures=len(failures), brepHashFailures=len(bad_hashes))), flush=True)
    return report


def authoritative_routes(output_dir):
    """Sample the actual OCCT interpolation edge used by the annular sweeps."""
    output_dir = Path(output_dir)
    tt = np.linspace(0, 1, 61)
    vectors = [cq.Vector(float(-35 + 70*t), float(-8 - 5*math.sin(math.pi*t)**2),
                         float(-2.5 - 7*math.sin(math.pi*t)**2)) for t in tt]
    edges = dict(light=cq.Edge.makeLine(cq.Vector(-31, 0, 0), cq.Vector(31, 0, 0)),
                 elements=cq.Edge.makeSpline(vectors),
                 song=cq.Edge.makeLine(cq.Vector(-35, 0, 0), cq.Vector(36, 0, 0)))
    records = {}
    for name, edge in edges.items():
        parameters = np.linspace(0, 1, 257 if name == 'elements' else 2)
        points = np.array([edge.positionAt(float(t)).toTuple() for t in parameters])
        errors = []
        for i, (a, b) in enumerate(zip(parameters[:-1], parameters[1:])):
            c = np.asarray(edge.positionAt(float((a + b)/2)).toTuple())
            v = points[i+1] - points[i]
            near = points[i] + v*np.clip(np.dot(c-points[i], v)/np.dot(v, v), 0, 1)
            errors.append(float(np.linalg.norm(c - near)))
        curvature = [abs(edge.curvatureAt(float(t))) for t in np.linspace(0, 1, 1025)]
        maximum = max(curvature)
        path = output_dir / 'parts' / (name + '__harness_centerline.brep')
        edge.exportBrep(str(path))
        records[name] = dict(interpolation='sampled-linear', mode='sampled-linear', units='mm',
                             points=points.tolist(), radiusMM=2.35,
                             outerEnvelopeRadiusMM=2.54 if name == 'elements' else 2.35,
                             entryTangent=edge.tangentAt(0).toTuple(), exitTangent=edge.tangentAt(1).toTuple(),
                             endpointTangents=[edge.tangentAt(0).toTuple(), edge.tangentAt(1).toTuple()],
                             lengthMM=edge.Length(), sampleCount=len(points),
                             maxMidpointChordErrorMM=max(errors),
                             minimumCADBendRadiusMM=1/maximum if maximum > 1e-12 else None,
                             curvatureSamples=1025, sourceCurveBrep=str(path.relative_to(output_dir)),
                             sourceCurveSHA256=sha(path),
                             lineage='Exact shared OCCT edge for the authored CAD sweep; not Catmull-Rom')
        if max(errors) > .005: raise ValueError(f'{name}: wire chord error exceeds .005mm')
    return records


def build_runtime_core(output_dir=DEFAULT_OUTPUT, linear=.04, angular=.1, micro_angular=.18):
    """Retessellate retained CAD surfaces, preserving every structural feature.

    No simplifier/decimator is used. Remove only duplicated decorative turning,
    knurl and thread ridges; their native parts and analytic CAD remain saved.
    """
    from OCP.BRepTools import BRepTools
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    class AbsoluteMeshedShape(cq.Shape):
        # CYBR GEO's analytic-normal reader calls Shape.mesh(), whose CadQuery
        # implementation uses relative deflection. Consume the already-built
        # absolute OCCT triangulation without replacing it with another mesh.
        def mesh(self, *args, **kwargs): return None
    output_dir = Path(output_dir)
    native = load_cache(output_dir / 'cache')
    metadata = json.loads((output_dir / 'metadata.json').read_text())
    parts, omitted, checks = [], [], []
    micro = ('score_spindle', '__hub_', 'inlet_collar', 'floating_fastener_',
             'front_interface_nut_', 'floating_optic_screw_', 'optic_locknut_',
             'bearing_ball_', 'bearing_race', '__retainer', 'air_bubbles',
             'felt_washer_', 'upper_clamp_washer_', 'cymbal_pilot_spacer_')
    redundant = ('lathe', 'lathed_', 'knurl_', 'turned_outer_edge_', '_thread_')
    for old in native.parts:
        record = metadata['parts'][old.name]
        obsolete_score = old.group == 'song' and any(t in old.name for t in ('__staff_', '__note_', '__stem_'))
        if 'cosmetic' in old.tags and (any(t in old.name for t in redundant) or obsolete_score):
            reason = ('Flat score appliques retired by formed-bell redesign; original source CAD retained as archival geometry'
                      if obsolete_score else 'Duplicate surface finish / nominal thread decoration; actual structural CAD retained')
            omitted.append(dict(name=old.name, triangles=len(old.faces), reason=reason))
            continue
        if not record.get('brepFile'):
            parts.append(old); continue
        q = cq.Shape.importBrep(str(output_dir / record['brepFile']))
        before = properties(q)
        BRepTools.Clean_s(q.wrapped)  # Triangulation only; never Shape.clean().
        angle = micro_angular if any(t in old.name for t in micro) else angular
        mesher = BRepMesh_IncrementalMesh(q.wrapped, linear, False, angle, True)
        mesher.Perform()
        p = cad_part(old.name, AbsoluteMeshedShape(q.wrapped), old.material, tolerance=linear, angular=angle,
                     group=old.group, motion=old.motion, center=old.center, explode=old.explode,
                     role=old.role, provenance=old.provenance, tags=old.tags,
                     finish_axis=old.finish_axis, finish_origin=old.finish_origin)
        after = properties(q)
        if before != after: raise ValueError(old.name + ': retessellation changed CAD properties')
        # Independent geometric samples use CAD *faces*, avoiding solid-inside
        # classification returning zero for an interior triangle barycentre.
        sampled_error = None
        samples = 0
        if 'structural' in old.tags:
            tri = p.vertices[p.faces]
            area = np.linalg.norm(np.cross(tri[:, 1]-tri[:, 0], tri[:, 2]-tri[:, 0]), axis=1)
            ids = np.unique(np.r_[np.linspace(0, len(tri)-1, min(24, len(tri))).astype(int), np.argsort(area)[-8:]])
            boundary = cq.Compound.makeCompound(q.Faces())
            distances = []
            for t in tri[ids]:
                for point in (t.mean(0), (t[0]+t[1])/2, (t[1]+t[2])/2, (t[2]+t[0])/2):
                    distances.append(float(boundary.distance(cq.Vertex.makeVertex(*point))))
            sampled_error, samples = max(distances), len(distances)
            if sampled_error > linear * 1.13:
                raise ValueError(f'{old.name}: measured runtime CAD deviation {sampled_error:.6g} exceeds {linear*1.13:.6g}mm')
        checks.append(dict(name=old.name, nativeTriangles=len(old.faces), runtimeTriangles=len(p.faces),
                           linearDeflectionMM=linear, angularDeflectionRad=angle, absoluteDeflection=True,
                           sampledMaxCADDeviationMM=sampled_error, deviationSamples=samples,
                           cadPropertiesUnchanged=True, nativeBrepSHA256=record['brepSHA256']))
        parts.append(p)
    a = Assembly('portfolio_working_core_runtime', parts, native.materials, metadata=native.metadata)
    report = dict(method='OpenCascade absolute CAD surface tessellation; no decimation',
                  linearDeflectionMM=linear, angularDeflectionRad=angular, microAngularDeflectionRad=micro_angular,
                  nativeTriangles=sum(len(p.faces) for p in native.parts), runtimeTriangles=sum(len(p.faces) for p in parts),
                  structuralFeatureOmissions=0, omittedDuplicateCosmetics=omitted, checks=checks,
                  measuredMaximumCADDeviationMM=max(d['sampledMaxCADDeviationMM'] or 0 for d in checks),
                  deviationScope='Deterministic surface samples and largest triangles; not a continuous deviation proof',
                  parts=len(parts), sourceMetadataSHA256=sha(output_dir / 'metadata.json'))
    save_cache(a, output_dir / 'runtime-cache')
    (output_dir / 'runtime-tessellation-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(dict(runtimeParts=len(parts), runtimeTriangles=report['runtimeTriangles'],
                         omittedDuplicateCosmetics=len(omitted), maxMeasuredDeviationMM=report['measuredMaximumCADDeviationMM'])), flush=True)
    return dict(parts=parts, assembly=a, report=report, cache=output_dir / 'runtime-cache')


def audit_geo_takeup(candidate_path, output_dir=DEFAULT_OUTPUT, spacing=.1):
    """Conservative continuous swept-jacket certificate against actual CAD.

    For each actual solid, exact OCCT distance to a sufficiently long X-axis
    gives a radial lower bound. Combine it with the union of source/condensed
    axial bounds: this includes all intermediate translations and phases.
    Distance to a closed set is 1-Lipschitz, so subtracting half the subdivision
    spacing bounds the entire sampled-linear wire, not only its vertices.
    """
    output_dir, candidate_path = Path(output_dir), Path(candidate_path)
    metadata = json.loads((output_dir / 'metadata.json').read_text())
    candidate = json.loads(candidate_path.read_text())
    profiles = []
    maximum_spacing = 0
    for profile in candidate['profiles']:
        original = np.asarray(profile['points'], float)
        vv = [original[0]]
        for a, b in zip(original[:-1], original[1:]):
            steps = max(1, int(math.ceil(np.linalg.norm(b-a)/spacing)))
            vv.extend(a + (b-a)*(i/steps) for i in range(1, steps+1))
        vv = np.asarray(vv)
        maximum_spacing = max(maximum_spacing, np.linalg.norm(np.diff(vv, axis=0), axis=1).max())
        profiles.append((profile['turns'], vv))
    correction = maximum_spacing / 2
    axis = cq.Edge.makeLine(cq.Vector(-1000, 0, 0), cq.Vector(1000, 0, 0))
    checks = []
    for name, record in metadata['parts'].items():
        if record['group'] != 'geo' or 'structural' not in record['tags']: continue
        if not record.get('brepFile'): raise ValueError('Unchecked structural GEO mesh: ' + name)
        path = output_dir / record['brepFile']
        if sha(path) != record['brepSHA256']: raise ValueError('Changed CAD fixture: ' + name)
        q = cq.Shape.importBrep(str(path)); bb = q.BoundingBox()
        if bb.xmin <= -1000 or bb.xmax >= 1000: raise ValueError('CAD exceeds certificate axis')
        rmin = float(q.distance(axis))
        xmin = min(bb.xmin, bb.xmin + record['assemblyShiftX'])
        xmax = max(bb.xmax, bb.xmax + record['assemblyShiftX'])
        worst = None
        for turns, points in profiles:
            r = np.linalg.norm(points[:, 1:], axis=1)
            axial = np.maximum(np.maximum(xmin-points[:, 0], points[:, 0]-xmax), 0)
            radial = np.maximum(rmin-r, 0)
            lower = np.sqrt(axial**2 + radial**2)
            i = int(np.argmin(lower))
            residual = float(lower[i] - candidate['cableRadiusMM'] - correction)
            if worst is None or residual < worst['residualClearanceLowerBoundMM']:
                worst = dict(turns=turns, point=points[i].tolist(), residualClearanceLowerBoundMM=residual)
        checks.append(dict(name=name, actualBrepSHA256=record['brepSHA256'], exactCADAxisDistanceMM=rmin,
                           sourceAndCondensedAxialUnionMM=[xmin, xmax], **worst,
                           passed=worst['residualClearanceLowerBoundMM'] >= candidate['minimumClearanceMM'] - 1e-6))
    insufficient = [d for d in checks if not d['passed']]
    report = dict(method='Exact CAD radial separation + actual axial bounds + 1-Lipschitz sampled-linear spacing bound',
                  candidatePath=str(candidate_path), candidateSHA256=sha(candidate_path),
                  profileCount=len(profiles), originalPointCount=sum(len(p['points']) for p in candidate['profiles']),
                  proofPointCount=sum(len(p) for _, p in profiles), structuralCADParts=len(checks),
                  testedCondenseRange=[0, 1], continuousCondenseCovered=True, allAngularPhasesCovered=True,
                  cableRadiusMM=candidate['cableRadiusMM'], requestedResidualClearanceMM=candidate['minimumClearanceMM'],
                  maxProofSpacingMM=maximum_spacing, spacingAllowanceMM=correction,
                  minimumResidualClearanceLowerBoundMM=min(d['residualClearanceLowerBoundMM'] for d in checks),
                  insufficientBounds=insufficient, passed=not insufficient, checks=checks,
                  geometryScope='All named structural GEO solids, including guards, internal keys, bearing balls, races, stand-offs and fasteners',
                  limitation='Candidate wire is sampled-linear; forces, jacket flattening and material elasticity are not modeled')
    (output_dir / 'takeup-clearance-report.json').write_text(json.dumps(report, indent=2) + '\n')
    metadata['takeupClearanceAudit'] = report
    metadata['modules']['geo']['takeupBay'].update(centerlineRadiusLimitMM=26.45,
                                                   bearingCenterlineRadiusLimitMM=18.45,
                                                   guardCenterlineRadiusLimitMM=1.45,
                                                   conduitCenterlineRadiusLimitMM=.25)
    (output_dir / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(dict(takeupProfiles=report['profileCount'], checkedSolids=len(checks),
                         minimumResidualLowerBoundMM=report['minimumResidualClearanceLowerBoundMM'],
                         insufficientBounds=len(insufficient), passed=report['passed'])), flush=True)
    return report


def build_working_core(output_dir=DEFAULT_OUTPUT, source_dir=SOURCE):
    """Return Parts/materials/modules/ports/clearanceReport/lineage and save cache.

    Parts remain in the original *exploded source* coordinates. Consume the
    per-part assemblyShiftX metadata when making a condensed pose. The cache is
    sufficient for a mesh exporter; BREP files supply retained CAD on demand.
    """
    started = time.perf_counter()
    output_dir, source_dir = Path(output_dir), Path(source_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    cad_dir = output_dir / 'parts'; cad_dir.mkdir(exist_ok=True)
    parts, by_name, originals, source_records, replacements = [], {}, {}, {}, {}
    materials = None
    lineage = dict(sourceRoot=str(source_dir), kernel='workspace cybr-geo/src/mechanism_lab',
                   recipe=str(ROOT / 'portfolio/instrument/recipe.py'), recipeSHA256=sha(ROOT / 'portfolio/instrument/recipe.py'),
                   nativeRepairRecipe=str(Path(__file__).resolve()), nativeRepairRecipeSHA256=sha(Path(__file__).resolve()),
                   sourceCaches={}, originalNamesPreserved=True, sourceGeometryModified=False)
    for module in MODULES:
        folder = source_dir / module
        a = load_cache(folder)
        info = json.loads((folder / 'manifest.json').read_text())
        if materials is None: materials = a.materials
        if [m.as_dict() for m in a.materials] != [m.as_dict() for m in materials]:
            raise ValueError('Retained source material numbering differs between modules')
        lineage['sourceCaches'][module] = {n: sha(folder / n) for n in ('manifest.json', 'meshes.npz')}
        for p, record in zip(a.parts, info['parts']):
            cosmetic = any(t in p.name for t in COSMETIC)
            p.tags = tuple(p.tags) + (('cosmetic', 'nonstructural') if cosmetic else ('structural',))
            path = folder / (p.name + '.step')
            if record['has_analytic_cad']:
                if not path.exists(): raise FileNotFoundError(path)
                q = cq.importers.importStep(str(path)).val()
                p.cad = q
                source_records[p.name] = dict(sourceSTEP=str(path), sourceSTEPSHA256=sha(path), sourceCAD=properties(q))
                if not cosmetic: checked(q, p.name)
            else:
                p.tags = tuple(t for t in p.tags if t != 'structural') + ('cosmetic', 'nonstructural', 'mesh-only-source')
                source_records[p.name] = dict(sourceCAD=None, note='Retained source mesh; no analytic solid claimed')
            originals[p.name] = p
            parts.append(p); by_name[p.name] = p
    print(json.dumps(dict(phase='source-loaded', parts=len(parts), analytic=sum(p.cad is not None for p in parts))), flush=True)
    # This slot belongs solely to the three SONG shells. Its former ivory
    # artwork palette is replaced by the physical alloy; imported source
    # definitions and STEP/cache files are left unchanged.
    materials = list(materials)
    materials[5] = replace(materials[5], name='Formed phosphor bronze',
                           color=(.50, .44, .32), metal=.99, rough=.34,
                           microfinish='machined', material_source='Authored physical bronze alloy for SONG formed resonators')

    def get(name):
        p = by_name[name]
        if p.cad is None: raise ValueError('CAD required: ' + name)
        return p.cad

    def put(name, q, function, material=None, group=None):
        q = checked(q, name)
        old = by_name.get(name)
        module = group or name.split('__')[0]
        mat = old.material if old is not None and material is None else (material or 0)
        p = cad_part(name, q, mat, tolerance=.035, angular=.075, group=module,
                     role=(old.role if old else function), provenance='CYBR GEO source-solid repair',
                     tags=('structural', 'functional-cad', 'closed-solid'))
        if old is not None:
            p = replace(p, motion=old.motion, center=old.center, explode=old.explode,
                        finish_axis=old.finish_axis, finish_origin=old.finish_origin)
            parts[parts.index(old)] = p
        else: parts.append(p)
        by_name[name] = p
        replacements[name] = dict(function=function, added=old is None)
        return q

    def cosmetic_tube(name, points, radius):
        old = by_name[name]
        v, f = tube_mesh(np.asarray(points), radius, 5)
        p = mesh_part(name, v, f, old.material, group=old.group, role=old.role,
                      provenance='Source braid finish trimmed at real compression glands',
                      tags=('cosmetic', 'nonstructural', 'mesh-only-source'))
        parts[parts.index(old)] = p; by_name[name] = p
        replacements[name] = dict(function='Braid finish terminates before compression seals; structural jacket remains continuous', added=False)

    # GEO: real separated liner, raceways, through-drilled bolts and stand-offs.
    barrel = get('geo__vented_monocoque')
    liner = ring(33.85, 29, -40, 10)
    for i in range(24):
        key = get(f'geo__internal_key_{i}')
        barrel = barrel.cut(key); liner = liner.cut(key)
    barrel = drill(barrel, bolt_circle(41, 4), 1.42, 7.8, 12.2)
    barrel = drill(barrel, bolt_circle(41, 8), 2.78, -42.1, -38.95)
    lip = get('geo__inner_front_lip')
    for i, (y, z) in enumerate(bolt_circle(39, 4, math.pi / 4)):
        barrel = barrel.cut(ring(2.86, 0, 8.8, 12.2).translate((0, y, z)))
        lip = lip.cut(ring(2.72, 0, 17, 31).translate((0, y, z)))
        put(f'geo__front_interface_spacer_{i}', ring(2.65, 1.62, 17, 31).translate((0, y, z)),
            'Coaxial stand-off carries the front interface plate to the actual flange')
        male = helix(34.2, 1.7, 1.22, .15, pitch=.5).translate((0, y, z))
        female = helix(10.2, 1.7, 1.22, .21, pitch=.5).translate((0, y, z))
        put(f'geo__floating_fastener_{i}_shank', get(f'geo__floating_fastener_{i}_shank').fuse(male),
            'True male helical retention through the flange and front stand-off bores', 1)
        put(f'geo__front_interface_nut_{i}', ring(2.8, 1.30, 9, 12).translate((0, y, z)).cut(female),
            'Actual internally helical rear nut on the common drilled fastener axis', 1)
    put('geo__vented_monocoque', barrel, 'Vented closed monocoque with actual keyways and bolt counterbores')
    put('geo__inner_front_lip', lip, 'Real stand-off clearance pockets in the otherwise retained front lip', 1)
    put('geo__inner_black_barrel', liner, 'Liner has .15mm radial running clearance to the shell and fitted keyways')
    for label, a, b in [('polished_shoulder_rear', -39, -28), ('polished_shoulder_front', 0, 10)]:
        put('geo__' + label, ring(45, 43.05, a, b), 'Outer cladding fits the 43mm shell without overlapping it', 1)
    put('geo__knurled_service_band', ring(44.4, 43.05, -27, -17), 'Separate knurled sleeve with .05mm radial clearance')
    raceway = toroidal_groove(26, 2.68, center=(26, 0, 0))
    put('geo__bearing_race', get('geo__bearing_race').cut(raceway), 'True toroidal raceway around the retained 18 rolling elements')
    put('geo__retainer', get('geo__retainer').cut(raceway), 'Opposing true toroidal retaining raceway; .08mm ball clearance', 2)
    for side in (-35, 35):
        q = get(f'geo__takeup_guard_{side}')
        for angle in (0, 2 * math.pi / 3, 4 * math.pi / 3):
            c, s = math.cos(angle), math.sin(angle)
            if side < 0:
                q = q.fuse(strut((side, 16 * c, 16 * s), (side, 29.7 * c, 29.7 * s), .85))
            else:
                q = q.fuse(strut((side, 16 * c, 16 * s), (side, 30 * c, 30 * s), .85))
                q = q.fuse(ring(.85, 0, 34, 35.6).translate((0, 30 * c, 30 * s)))
        if side < 0: q = q.cut(liner)
        put(f'geo__takeup_guard_{side}', q, 'Three-spoke guard seats on liner / front interface, not a floating ring', 1)

    # Repaired cladding had lost the source's edge breaks. These native cuts
    # restore an actual machined rim without moving a mating face or fastener.
    for name in list(by_name):
        if not name.startswith('geo__'): continue
        finished, actions = geo_finished_shape(name, get(name)) if by_name[name].cad is not None else (None, [])
        if actions:
            put(name, finished, 'Subtractive native machined edge breaks; retained shaft axes, seating faces and bores')
            replacements[name]['edgeTreatments'] = actions

    # LIGHT: glass is retained by actual matching annular seats, while the service
    # sleeve passes through the source lens's real 4.3mm bore.
    lens = get('light__biconvex_optical_lens')
    lens_env = cq.Solid.makeSphere(110.035, cq.Vector(-102.45, 0, 0), angleDegrees1=-90).intersect(
        cq.Solid.makeSphere(110.035, cq.Vector(102.45, 0, 0), angleDegrees1=-90))
    carrier = ring(44, 40.35, -4.95, 4.95)
    rear = ring(44.6, 38, -8, -5).fuse(ring(40.32, 38, -5, 0)).cut(lens_env)
    front = ring(42.5, 38.6, 5, 7).fuse(ring(40.32, 38.4, 0, 5)).cut(lens_env)
    seal = ring(39.8, 38, -1.3, -.8).cut(lens_env)
    rear = rear.cut(ring(39.83, 37.97, -1.33, -.77))
    for y, z in bolt_circle(46, 3, math.pi / 2):
        tool = ring(3.54, 0, -12, 10).translate((0, y, z))
        carrier = carrier.cut(tool); rear = rear.cut(tool); front = front.cut(tool)
    rear_mount, locking_ring = get('light__exploded_rear_mount'), get('light__exploded_locking_ring')
    for y, z in bolt_circle(46, 3, math.pi / 2):
        tool = ring(3.54, 0, -12, 10).translate((0, y, z))
        rear_mount = rear_mount.cut(tool.translate((-17, 0, 0)))
        locking_ring = locking_ring.cut(tool.translate((21, 0, 0)))
    put('light__exploded_rear_mount', rear_mount, 'Mount-lug clearance sockets in its actual condensed rear seat', 1)
    put('light__exploded_locking_ring', locking_ring, 'Mount-lug clearance sockets in the true locking-ring pose', 1)
    put('light__lens_cartridge', carrier, 'Clean cylindrical glass clearance and actual lug sockets', 1)
    put('light__rear_bezel', rear, 'Source-curvature rear optical seat and cut elastomer recess')
    put('light__front_polished_lip', front, 'Source-curvature front optical seat captures glass rim', 1)
    put('light__black_seal', seal, 'Annular elastomer in its actual rear seat; no glass penetration', 2)
    for i, (y, z) in enumerate(bolt_circle(46, 3, math.pi / 2)):
        male = helix(-10.7, 2.4, 1.22, .15, pitch=.5).translate((0, y, z))
        female = helix(-13.7, 2.4, 1.22, .21, pitch=.5).translate((0, y, z))
        put(f'light__floating_optic_screw_{i}_shank', get(f'light__floating_optic_screw_{i}_shank').fuse(male),
            'True helical optical mounting bolt through the real lug bore', 1)
        put(f'light__optic_locknut_{i}', ring(3.8, 1.30, -14, -11).translate((0, y, z)).cut(female),
            'Actual helical mounting locknut in the condensed bolt pose', 2)
    for side in (-1, 1):
        if side < 0: q = ring(5.5, 4.25, -31, -27).fuse(ring(5.5, 2.8, -32.2, -31))
        else: q = ring(5.5, 4.25, 27, 31).fuse(ring(5.5, 2.8, 31, 32.2))
        put(f'light__axial_cable_gland_{side}', q, 'Stepped gland supports the sleeve end; real 2.8mm cable bore', 1)
    put('light__optical_service_cable', ring(2.35, 0, -31, 31), 'Closed analytic cable envelope in the hollow optical sleeve', 4)

    # ELEMENTS: retain the exact vessel/free surface/bubbles. Use one common
    # spline for closed jacket, conductor, gland and compression-seal bores.
    tt = np.linspace(0, 1, 61)
    route = [(float(-35 + 70 * t), float(-8 - 5 * math.sin(math.pi * t)**2),
              float(-2.5 - 7 * math.sin(math.pi * t)**2)) for t in tt]
    s235, s170 = sweep(route, 2.35), sweep(route, 1.70)
    s304 = sweep(route, 3.04)
    put('elements__cable_0_jacket', s235.cut(s170), 'Closed annular spline jacket, aligned to native liquid exclusion', 4)
    put('elements__cable_0_conductor', sweep(route, 1.60), 'Analytic enclosed conductor with .10mm insulation clearance', 1)
    for side in (-1, 1):
        a, b = (-35, -26.5) if side < 0 else (26.5, 35)
        gland = ring(7.8, 0, a, b).translate((0, -8, -2.5)).cut(s304)
        seal = s304.cut(s235).intersect(ring(5, 0, a + .15, b - .15).translate((0, -8, -2.5)))
        put(f'elements__port_gland_{side}', gland, 'Bored compression gland spans the entire true vessel wall', 1)
        put(f'elements__port_seal_{side}', seal, 'Spline-matched insert nominally contacts smooth jacket and gland bore; braid terminates upstream', 2)
        a, b = (-30, -27) if side < 0 else (27, 30)
        put(f'elements__vessel_port_gasket_{side}', ring(8, 7.8, a, b).translate((0, -8, -2.5)),
            'Nominal-contact outer gland gasket closes the true glass port without entering liquid', 2)
    xx = np.linspace(-26.45, 26.45, 180); phase = (xx + 35) / 70
    centers = np.column_stack((xx, -8 - 5*np.sin(np.pi*phase)**2, -2.5 - 7*np.sin(np.pi*phase)**2))
    for handedness in (-1, 1):
        for strand in range(6):
            angle = xx*.95*handedness + strand*np.pi/3
            pp = centers + np.column_stack((np.zeros_like(xx), 2.4*np.cos(angle), 2.4*np.sin(angle)))
            cosmetic_tube(f'elements__cable_0_braid_{handedness}_{strand}', pp, .14)
    outer_env = cq.Workplane('XY').box(60.08, 62.08, 66.08).edges().fillet(13.04).val()
    inlet = ring(33, 25, -37, -32).fuse(ring(33, 25, -32, -28).cut(outer_env))
    outlet = get('elements__outlet_collar').fuse(ring(30, 24, 28, 32).cut(outer_env))
    # The existing collar bolts must pass through these new support shoulders.
    inlet = drill(inlet, bolt_circle(27, 8), 1.30, -38, -27.9)
    for i, (y, z) in enumerate(bolt_circle(27, 8)):
        male = helix(-35.5, 4.8, 1.23, .15, pitch=.5).translate((0, y, z))
        female = helix(-35.5, 4.8, 1.23, .21, pitch=.5).translate((0, y, z))
        inlet = inlet.cut(female)
        shank = ring(1.25, 0, -37, -30.05).translate((0, y, z)).fuse(male)
        head = ring(2.7, 0, -40, -37).translate((0, y, z))
        socket = cq.Workplane('YZ', origin=(-40.1, y, z)).polygon(6, 3).extrude(1.8).val()
        put(f'elements__inlet_collar_bolt_{i}_socket_head', head.cut(socket), 'Outward accessible socket head bears on collar, not on glass', 1)
        put(f'elements__inlet_collar_bolt_{i}_shank', shank, 'Actual male helical bolt engages collar; stops .05mm before glass', 1)
    put('elements__inlet_collar', inlet, 'True conforming vessel collar with through-drilled support shoulder')
    put('elements__outlet_collar', outlet, 'True conforming vessel collar with matching native glass seat', 1)

    # SONG: three graduated formed bronze resonators replace the shallow flat
    # score plates. Their exact original r7--10 mounting seats are retained, so
    # the supported hollow spindle, felt and threaded retainers remain fitted.
    spindle = get('song__score_spindle')
    for k, x in enumerate((-25., 0., 25.)):
        radius = 40 - k * 2
        put(f'song__dished_cymbal_{k}', formed_song_cymbal(k, x),
            'Smooth revolved formed-bronze bell, deep swept shoulder and rounded solid rim; exact retained pilot/clamp datum', 5)
        def depth(r): return 5.6 * math.exp(-((r - 7) / 7.5)**2) + 1.4 * (r / radius)**2
        def underside(r): return depth(r) - (.24 + .45 * (1 - r / radius))
        rr = np.linspace(6.98, 10, 32)
        top = [(x + underside(max(7, r)) - .035, r) for r in rr]
        felt = revolve(top + [(xx - .65, r) for xx, r in reversed(top)])
        put(f'song__felt_washer_{k}', felt, 'Conforming lower washer, real 6.98mm pilot bore, no cymbal overlap', 2)
        # Shoulder conforms to the underside of the felt and seats on a shaft
        # shoulder. Pilot is below 7mm cymbal bore and above 4.2mm spindle.
        bottom = [(x + underside(max(7, r)) - .715, r) for r in np.linspace(6.92, 10, 32)]
        shoulder = revolve([(x + 2.5, 4.27), (x + 2.5, 10)] + list(reversed(bottom)) + [(x + 4.4, 4.27)])
        pilot = ring(6.92, 4.27, x + 2.5, x + 5.68)
        put(f'song__cymbal_pilot_spacer_{k}', shoulder.fuse(pilot), 'Piloted shoulder supports lower washer and cymbal on the shared shaft datum', 1)
        rr = np.linspace(7.02, 10, 32)
        lower = [(x + depth(r) + .035, r) for r in rr]
        upper = revolve(lower + [(x + 6.32, r) for r in reversed(rr)])
        put(f'song__upper_clamp_washer_{k}', upper, 'Conforming upper washer has a flat real clamping face and clear pilot bore', 1)
        male = helix(x + 6.5, 3.1, 4.18, .22)
        female = helix(x + 6.5, 3.1, 4.18, .29)
        spindle = spindle.fuse(ring(6.8, 3, x + 1.8, x + 2.5)).fuse(male)
        nut = ring(8.8, 4.25, x + 6.35, x + 9.8).cut(female)
        put(f'song__hub_{k}', nut, 'Real internally helical threaded retainer clamps upper washer on hollow spindle', 1)
    put('song__score_spindle', spindle, 'Hollow spindle with integral stop shoulders and three true helical retention zones', 1)
    put('song__spindle_cable', ring(2.35, 0, -35, 36), 'Closed cable envelope inside the actual 3mm spindle bore', 4)

    print(json.dumps(dict(phase='features-built', repairs=len(replacements), parts=len(parts))), flush=True)
    # Retained STEP can be a valid compound (for example text); such parts are
    # explicitly cosmetic. All structural parts must remain one closed solid.
    cad_records = {}
    for p in parts:
        d = dict(source_records.get(p.name, {}), name=p.name, material=p.material,
                 group=p.group, role=p.role, tags=list(p.tags), assemblyShiftX=shift(p.name),
                 sourceBoundsMM=originals[p.name].bounds.tolist() if p.name in originals else None,
                 boundsMM=p.bounds.tolist(), function=replacements.get(p.name, {}).get('function', p.role),
                 repaired=p.name in replacements)
        if replacements.get(p.name, {}).get('edgeTreatments'):
            d['edgeTreatments'] = replacements[p.name]['edgeTreatments']
        if p.cad is not None:
            d['cad'] = properties(p.cad)
            if 'structural' in p.tags: checked(p.cad, p.name)
            # Keep all named analytic source parts as BREP; export STEP only for
            # new/repaired features because original named STEP paths are kept.
            brep = cad_dir / (p.name + '.brep'); p.cad.exportBrep(str(brep))
            d.update(brepFile=str(brep.relative_to(output_dir)), brepSHA256=sha(brep))
            if p.name in replacements:
                step = cad_dir / (p.name + '.step'); cq.exporters.export(p.cad, str(step))
                d.update(stepFile=str(step.relative_to(output_dir)), stepSHA256=sha(step))
        else: d['cad'] = None
        cad_records[p.name] = d

    assembled = {p.name: p.cad.translate((shift(p.name), 0, 0)) for p in parts if p.cad is not None and 'structural' in p.tags}
    overlaps, pairs, broad = [], 0, 0
    for module in MODULES:
        names = [n for n in assembled if n.startswith(module + '__')]
        boxes = {n: assembled[n].BoundingBox() for n in names}
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                pairs += 1
                aa, bb = boxes[a], boxes[b]
                if any(min(getattr(aa, ax + 'max'), getattr(bb, ax + 'max')) - max(getattr(aa, ax + 'min'), getattr(bb, ax + 'min')) < 1e-7 for ax in 'xyz'): continue
                broad += 1
                volume = abs(assembled[a].intersect(assembled[b]).Volume())
                if volume > 1e-4: overlaps.append(dict(a=a, b=b, volumeMM3=volume))
    interfaces = []
    def fit(label, a, b, maximum, minimum=0., reason=''):
        distance = float(assembled[a].distance(assembled[b]))
        interfaces.append(dict(name=label, a=a, b=b, distanceMM=distance, minMM=minimum, maxMM=maximum,
                               passed=minimum - 1e-5 <= distance <= maximum + 1e-5, reason=reason))
    for i in range(18):
        fit(f'geo-ball-race-{i}', f'geo__bearing_ball_{i}', 'geo__bearing_race', .15, .01)
        fit(f'geo-ball-retainer-{i}', f'geo__bearing_ball_{i}', 'geo__retainer', .15, .01)
    for i in range(4):
        fit(f'geo-spacer-flange-{i}', f'geo__front_interface_spacer_{i}', 'geo__front_flange', .05)
        fit(f'geo-spacer-plate-{i}', f'geo__front_interface_spacer_{i}', 'geo__exploded_interface', .05)
        fit(f'geo-head-plate-{i}', f'geo__floating_fastener_{i}_socket_head', 'geo__exploded_interface', .05)
    fit('light-rear-seat-glass', 'light__rear_bezel', 'light__biconvex_optical_lens', .15, .015)
    fit('light-front-seat-glass', 'light__front_polished_lip', 'light__biconvex_optical_lens', .15, .015)
    fit('light-service-sleeve-bore', 'light__optical_service_sleeve', 'light__biconvex_optical_lens', .15, .05)
    for side in (-1, 1):
        fit(f'light-gland-sleeve-{side}', f'light__axial_cable_gland_{side}', 'light__optical_service_sleeve', .055)
        fit(f'elements-gland-glass-{side}', f'elements__port_gland_{side}', 'elements__rounded_square_glass_vessel', .21, .1)
        fit(f'elements-seal-gland-{side}', f'elements__port_seal_{side}', f'elements__port_gland_{side}', .01,
            reason='Nominal contact between identical shared spline surfaces; compression not simulated')
        fit(f'elements-seal-jacket-{side}', f'elements__port_seal_{side}', 'elements__cable_0_jacket', .01,
            reason='Nominal sealing contact on the smooth jacket, beyond cosmetic braid termination')
        fit(f'elements-outer-gasket-glass-{side}', f'elements__vessel_port_gasket_{side}', 'elements__rounded_square_glass_vessel', .01)
        fit(f'elements-outer-gasket-gland-{side}', f'elements__vessel_port_gasket_{side}', f'elements__port_gland_{side}', .01)
    for k in range(3):
        fit(f'song-pilot-shaft-{k}', f'song__cymbal_pilot_spacer_{k}', 'song__score_spindle', .08)
        fit(f'song-pilot-cymbal-{k}', f'song__cymbal_pilot_spacer_{k}', f'song__dished_cymbal_{k}', .1, .03)
        fit(f'song-felt-cymbal-{k}', f'song__felt_washer_{k}', f'song__dished_cymbal_{k}', .08, .005)
        fit(f'song-upper-cymbal-{k}', f'song__upper_clamp_washer_{k}', f'song__dished_cymbal_{k}', .08, .005)
        fit(f'song-retainer-clamp-{k}', f'song__hub_{k}', f'song__upper_clamp_washer_{k}', .04, .01)
    water, vessel = assembled['elements__water_with_free_surface_and_air_bubbles'], assembled['elements__rounded_square_glass_vessel']
    liquid = dict(waterVolumeMM3=water.Volume(), freeSurfaceBoundsMM=by_name['elements__water_with_free_surface_and_air_bubbles'].bounds.tolist(),
                  nominalInteriorTopZ=29.5, observedWaterMaxZ=water.BoundingBox().zmax,
                  headspaceMinimumHeightMM=29.5 - water.BoundingBox().zmax,
                  glassIntersectionVolumeMM3=abs(water.intersect(vessel).Volume()),
                  excludedEnvelopeRadiusMM=2.58, outerBraidedJacketRadiusMM=2.54,
                  jacketClearanceMM=.04, boreFollowsJacketSpline=True, airTunnelThroughLiquid=False)
    report = dict(scope='First-four condensed-pose structural CAD pairs and declared interfaces',
                  parts=len(parts), structuralSolids=len(assembled), cosmeticParts=sum('cosmetic' in p.tags for p in parts),
                  allPairCandidates=pairs, exactIntersectionPairs=broad, volumeToleranceMM3=1e-4,
                  overlaps=overlaps, interfaces=interfaces, liquid=liquid,
                  passed=not overlaps and all(d['passed'] for d in interfaces),
                  unchecked=['Cosmetic source details excluded from structural overlap audit',
                             'Material compression, load, fatigue, optical prescription and pressure sealing not simulated',
                             'Source-pose-to-condensed paths and inter-module cable motion checked by the route owner'])
    ports = dict(geo=[[-47, 0, 0], [61, 0, 0]], light=[[-31, 0, 0], [31, 0, 0]],
                 elements=[[-35, -8, -2.5], [35, -8, -2.5]], song=[[-35, 0, 0], [36, 0, 0]])
    modules = {}
    for module in MODULES:
        pp = [p for p in parts if p.group == module]
        points = np.concatenate([p.vertices for p in pp])
        modules[module] = dict(name=module, bounds=[points.min(0).tolist(), points.max(0).tolist()],
                               ports=ports[module], parts=len(pp), triangles=sum(len(p.faces) for p in pp),
                               structuralSolids=sum(p.name in assembled for p in pp),
                               retainedSourceParts=sum(p.name in originals for p in pp),
                               repairedParts=[p.name for p in pp if p.name in replacements])
    modules['geo']['takeupBay'] = dict(axialMM=[-33, 8], radialLimitMM=28,
                                     bearingPassageRadialLimitMM=20, guardBoreRadiusMM=4,
                                     conduitBoreRadiusMM=2.8, geometryOnly=True)
    modules['song']['formedShellDesign'] = dict(
        authoring='Smooth spline-of-revolution closed native CAD solids',
        nominalRadiiMM=[40, 35, 30], rimDepthFromMountDatumMM=[-8, -6, -4],
        roundedRimRadiusMM=.26, pilotBoreRadiusMM=7, retainedClampingRadialRangeMM=[7, 10],
        physicalMaterial='Formed phosphor bronze',
        flatScoreAppliques='Retired from runtime; unchanged original source and native archive retained',
        acousticQualification=False)
    routes = authoritative_routes(output_dir)
    metadata = dict(schema=1, name='portfolio-working-core', units='mm', axis='X-shaft/Z-up',
                    sourcePose='retained exploded local coordinates', condensedShifts=SHIFTS,
                    parts=cad_records, modules=modules, ports=ports, routes=routes,
                    materials=[m.as_dict() for m in materials], lineage=lineage,
                    clearanceReport=report, productionApproved=False,
                    kernelVersions=dict(cadquery=cq.__version__, python=sys.version.split()[0]),
                    elapsedSeconds=time.perf_counter() - started)
    a = Assembly('portfolio_working_core', parts, materials, metadata=dict(modules=modules, ports=ports, lineage=lineage,
                  productionApproved=False, not_manufacturing_qualified=True))
    structural_validation = validate(a, expensive=False)
    metadata['meshValidation'] = structural_validation
    save_cache(a, output_dir / 'cache')
    (output_dir / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (output_dir / 'routes.json').write_text(json.dumps(routes, indent=2) + '\n')
    (output_dir / 'clearance-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(dict(output=str(output_dir), parts=len(parts), repairs=len(replacements), structuralSolids=len(assembled),
                         overlaps=len(overlaps), failedInterfaces=sum(not d['passed'] for d in interfaces),
                         passed=report['passed'], triangles=sum(len(p.faces) for p in parts))), flush=True)
    return dict(parts=parts, materials=materials, modules=modules, ports=ports, routes=routes, clearanceReport=report, lineage=lineage,
                assembly=a, cache=output_dir / 'cache', metadata=metadata)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--runtime-only', action='store_true')
    parser.add_argument('--runtime', action='store_true')
    parser.add_argument('--runtime-angular', type=float, default=.1)
    parser.add_argument('--micro-angular', type=float, default=.18)
    parser.add_argument('--takeup-only', type=Path)
    args = parser.parse_args()
    if args.takeup_only:
        audit_geo_takeup(args.takeup_only, args.output)
    elif not args.runtime_only:
        build_working_core(args.output, args.source)
        audit_cached_meshes(args.output)
    if not args.takeup_only and (args.runtime_only or args.runtime):
        build_runtime_core(args.output, angular=args.runtime_angular, micro_angular=args.micro_angular)
        audit_cached_meshes(args.output, 'runtime-cache')
