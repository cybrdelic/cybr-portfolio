"""Incremental native GEO edge-break revision; unchanged solids/meshes retained.

This edits authoring caches and exact BREP/STEP, never renderer or PBR shaders.
Run once. Affected predecessor artifacts are copied before any cache mutation.
"""
from pathlib import Path
from dataclasses import replace
import hashlib, json, shutil, time
import numpy as np
from working_core import (ROOT, DEFAULT_OUTPUT, GEO_EDGE_BREAKS, geo_finished_shape,
                          checked, properties, sha, audit_cached_meshes, audit_geo_takeup)
from mechanism_lab.core import cad_part, load_cache, save_cache, validate
import cadquery as cq
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepTools import BRepTools
from OCP.BRepMesh import BRepMesh_IncrementalMesh

REVISION = 'native-geo-edge-breaks-1'
PROOF = ROOT / 'portfolio/output/geo-working/geo-edge-refinement'


def write(path, obj):
    Path(path).write_text(json.dumps(obj, indent=2) + '\n')


def mesh_identity(p):
    h = hashlib.sha256()
    for a in (p.vertices,p.faces,p.normals): h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


def bounds(q):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(q.wrapped, box, False, False)
    v = box.Get()
    return np.asarray([v[:3], v[3:]])


def cylinders(q):
    values = []
    for f in q.Faces():
        if f.geomType() != 'CYLINDER': continue
        c = BRepAdaptor_Surface(f.wrapped).Cylinder()
        a, p = c.Axis().Direction(), c.Axis().Location()
        values.append(tuple(round(v, 9) for v in (c.Radius(), a.X(), a.Y(), a.Z(), p.Y(), p.Z())))
    return sorted(set(values))


def bearing_face(q):
    circles = [e for e in q.Edges() if e.geomType() == 'CIRCLE' and abs(e.radius()-2.7) < 1e-6]
    x = min(e.Center().x for e in circles)
    faces = [f for f in q.Faces() if f.geomType() == 'PLANE' and abs(f.Center().x-x) < 1e-7
             and abs(abs(f.normalAt().x)-1.) < 1e-7]
    return dict(planeXMM=x, areaMM2=sum(f.Area() for f in faces))


class AbsoluteMeshedShape(cq.Shape):
    def mesh(self, *args, **kwargs): return None


def retessellate(old, q, native_count, brep_hash):
    linear = .04
    angle = .18 if 'floating_fastener_' in old.name else .1
    before = properties(q)
    BRepTools.Clean_s(q.wrapped)
    BRepMesh_IncrementalMesh(q.wrapped, linear, False, angle, True).Perform()
    p = cad_part(old.name, AbsoluteMeshedShape(q.wrapped), old.material,
                 tolerance=linear, angular=angle, group=old.group, motion=old.motion,
                 center=old.center, explode=old.explode, role=old.role,
                 provenance=old.provenance, tags=old.tags,
                 finish_axis=old.finish_axis, finish_origin=old.finish_origin)
    if before != properties(q): raise ValueError(old.name + ': tessellation changed native solid')
    tri = p.vertices[p.faces]
    areas = np.linalg.norm(np.cross(tri[:,1]-tri[:,0], tri[:,2]-tri[:,0]), axis=1)
    ids = np.unique(np.r_[np.linspace(0,len(tri)-1,min(24,len(tri))).astype(int),np.argsort(areas)[-8:]])
    boundary = cq.Compound.makeCompound(q.Faces())
    distances = [float(boundary.distance(cq.Vertex.makeVertex(*point)))
                 for t in tri[ids] for point in (t.mean(0),(t[0]+t[1])/2,(t[1]+t[2])/2,(t[2]+t[0])/2)]
    if max(distances) > linear*1.13: raise ValueError(old.name + ': runtime deviation exceeds gate')
    return p, dict(name=old.name,nativeTriangles=native_count,runtimeTriangles=len(p.faces),
        linearDeflectionMM=linear,angularDeflectionRad=angle,absoluteDeflection=True,
        sampledMaxCADDeviationMM=max(distances),deviationSamples=len(distances),
        cadPropertiesUnchanged=True,nativeBrepSHA256=brep_hash)


def main():
    started = time.perf_counter()
    output = DEFAULT_OUTPUT
    meta = json.loads((output/'metadata.json').read_text())
    if meta.get('geoEdgeRefinement',{}).get('revision') == REVISION:
        raise ValueError('This edge revision is already applied; refusing to chamfer it twice')
    native, runtime = load_cache(output/'cache'), load_cache(output/'runtime-cache')
    names = [p.name for p in native.parts if p.name in GEO_EDGE_BREAKS or p.name=='geo__vented_monocoque'
             or (p.name.startswith(('geo__front_flange_bolt_','geo__rear_flange_bolt_','geo__floating_fastener_'))
                 and p.name.endswith('_socket_head'))]
    if len(names) != 23: raise ValueError('Expected exactly 23 current named GEO parts')
    PROOF.mkdir(parents=True,exist_ok=True)
    backup = PROOF/'before'
    if backup.exists(): raise ValueError('Backup already exists; inspect previous partial run before retry')
    backup.mkdir()
    paths = [output/f for f in ('metadata.json','clearance-report.json','mesh-audit.json','runtime-mesh-audit.json',
                              'runtime-tessellation-report.json','takeup-clearance-report.json')]
    paths += [output/cache/f for cache in ('cache','runtime-cache') for f in ('manifest.json','meshes.npz')]
    created_paths = []
    for name in names:
        for key in ('brepFile','stepFile'):
            if meta['parts'][name].get(key): paths.append(output/meta['parts'][name][key])
        if not meta['parts'][name].get('stepFile'):
            created_paths.append(str((output/'parts'/(name+'.step')).relative_to(ROOT)))
    package = ROOT/'portfolio/assets/instrument-working-v1'
    paths += [package/f for f in ('manifest.json','instrument.bin.gz','route.json')]
    if (ROOT/'portfolio/output/geo-working/package-receipt.json').exists():
        paths.append(ROOT/'portfolio/output/geo-working/package-receipt.json')
    backups = []
    for src in paths:
        relative = src.relative_to(ROOT)
        dst = backup/relative
        dst.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(src,dst)
        backups.append(dict(path=str(relative),bytes=src.stat().st_size,sha256=sha(src)))
    write(PROOF/'backup-manifest.json',dict(revision=REVISION,artifacts=backups,newArtifactPaths=created_paths))
    predecessor_recipe_hash = meta['lineage']['nativeRepairRecipeSHA256']
    print(json.dumps(dict(phase='backed-up',artifacts=len(backups),affectedParts=len(names))),flush=True)
    unchanged_native = {p.name:mesh_identity(p) for p in native.parts if p.name not in names}
    unchanged_runtime = {p.name:mesh_identity(p) for p in runtime.parts if p.name not in names}
    old_shapes, new_shapes, rows = {}, {}, []
    native_by_name = {p.name:p for p in native.parts}
    runtime_by_name = {p.name:p for p in runtime.parts}
    for name in names:
        record = meta['parts'][name]
        if sha(record['sourceSTEP']) != record['sourceSTEPSHA256']:
            raise ValueError(name + ': original source STEP identity mismatch')
        path = output/record['brepFile']
        if sha(path) != record['brepSHA256']: raise ValueError(name + ': predecessor identity mismatch')
        old = cq.Shape.importBrep(str(path))
        q, actions = geo_finished_shape(name, old)
        checked(q,name)
        added = abs(q.cut(old).Volume())
        removed = abs(old.cut(q).Volume())
        delta = float(np.max(np.abs(bounds(old)-bounds(q))))
        signatures = cylinders(old) == cylinders(q)
        bearing = None
        if name.endswith('_socket_head'):
            before_bearing, after_bearing = bearing_face(old),bearing_face(q)
            bearing = dict(before=before_bearing,after=after_bearing,
                           passed=abs(before_bearing['planeXMM']-after_bearing['planeXMM'])<1e-8
                           and abs(before_bearing['areaMM2']-after_bearing['areaMM2'])<1e-7)
        if added>1e-7 or removed<=0 or delta>1e-6 or not signatures or (bearing and not bearing['passed']):
            raise ValueError(name + ': subtractive/datum/bore/bearing gate failed')
        old_shapes[name],new_shapes[name] = old,q
        rows.append(dict(name=name,oldBrepSHA256=record['brepSHA256'],oldSTEP_SHA256=record.get('stepSHA256'),
            before=properties(old),after=properties(q),addedVolumeMM3=added,removedVolumeMM3=removed,
            exactNativeBoundsMM=bounds(q).tolist(),nativeBoundsMaxDeltaMM=delta,
            cylinderAxesRadiiUnchanged=signatures,bearingFace=bearing,edgeTreatments=actions,passed=True))
    # Native overlap evidence for every changed part and every adjacent solid.
    structural = {n:(new_shapes[n] if n in new_shapes else cq.Shape.importBrep(str(output/d['brepFile'])))
                  .translate((d['assemblyShiftX'],0,0)) for n,d in meta['parts'].items()
                  if d['group']=='geo' and 'structural' in d['tags']}
    boxes = {n:bounds(q) for n,q in structural.items()}
    pairs,seen = [],set()
    for a in names:
        for b in structural:
            key = tuple(sorted((a,b)))
            if a==b or key in seen: continue
            seen.add(key)
            overlap = np.minimum(boxes[a][1],boxes[b][1])-np.maximum(boxes[a][0],boxes[b][0])
            if np.any(overlap < 1e-7): continue
            volume = abs(structural[a].intersect(structural[b]).Volume())
            pairs.append(dict(a=a,b=b,volumeMM3=volume,passed=volume<=1e-4))
    if any(not p['passed'] for p in pairs): raise ValueError('Changed GEO solids intersect adjacent hardware')
    interfaces = []
    for fit in meta['clearanceReport']['interfaces']:
        if fit['a'] not in names and fit['b'] not in names: continue
        distance = float(structural[fit['a']].distance(structural[fit['b']]))
        row = dict(fit,distanceMM=distance,previousDistanceMM=fit['distanceMM'],
                   passed=fit['minMM']-1e-5<=distance<=fit['maxMM']+1e-5)
        fit.update(distanceMM=distance,passed=row['passed'])
        interfaces.append(row)
    if any(not f['passed'] for f in interfaces): raise ValueError('Retained GEO fitted interface failed')
    print(json.dumps(dict(phase='native-gates-passed',parts=len(rows),neighborBooleanPairs=len(pairs),
                         fittedInterfaces=len(interfaces))),flush=True)
    # Only now replace exact geometry and affected cache entries.
    runtime_report = json.loads((output/'runtime-tessellation-report.json').read_text())
    runtime_checks = {r['name']:r for r in runtime_report['checks']}
    revised_native,revised_runtime = {},{}
    for row in rows:
        name,q = row['name'],new_shapes[row['name']]
        record = meta['parts'][name]
        record.setdefault('stepFile',str(Path('parts')/(name+'.step')))
        q.exportBrep(str(output/record['brepFile']))
        cq.exporters.export(q,str(output/record['stepFile']))
        record.update(cad=properties(q),brepSHA256=sha(output/record['brepFile']),
                      stepSHA256=sha(output/record['stepFile']),edgeTreatments=row['edgeTreatments'],
                      nativeBoundsMM=row['exactNativeBoundsMM'],repaired=True)
        record['geometryRevision'] = dict(revision=REVISION,predecessorBrepSHA256=row['oldBrepSHA256'],
                                         sourceCADUnchanged=True,subtractiveOnly=True)
        old = native_by_name[name]
        p = cad_part(name,q,old.material,tolerance=.035,angular=.075,group=old.group,
                     motion=old.motion,center=old.center,explode=old.explode,role=old.role,
                     provenance=old.provenance,tags=old.tags,finish_axis=old.finish_axis,finish_origin=old.finish_origin)
        record['boundsMM'] = p.bounds.tolist()
        revised_native[name] = p
        rt,check = retessellate(runtime_by_name[name],q,len(p.faces),record['brepSHA256'])
        revised_runtime[name],runtime_checks[name] = rt,check
        row.update(newBrepSHA256=record['brepSHA256'],newSTEP_SHA256=record['stepSHA256'],
                   nativeTrianglesBefore=len(old.faces),nativeTrianglesAfter=len(p.faces),
                   runtimeTrianglesBefore=len(runtime_by_name[name].faces),runtimeTrianglesAfter=len(rt.faces),
                   runtimeDeviation=check,sampledMeshBoundsMM=rt.bounds.tolist())
    native.parts = [revised_native.get(p.name,p) for p in native.parts]
    runtime.parts = [revised_runtime.get(p.name,p) for p in runtime.parts]
    if any(mesh_identity(p)!=unchanged_native[p.name] for p in native.parts if p.name not in names):
        raise ValueError('Unchanged native mesh was modified')
    if any(mesh_identity(p)!=unchanged_runtime[p.name] for p in runtime.parts if p.name not in names):
        raise ValueError('Unchanged runtime mesh was modified')
    points = np.concatenate([p.vertices for p in native.parts if p.group=='geo'])
    meta['modules']['geo'].update(bounds=[points.min(0).tolist(),points.max(0).tolist()],
                                triangles=sum(len(p.faces) for p in native.parts if p.group=='geo'))
    meta['modules']['geo']['repairedParts'] = sorted(set(meta['modules']['geo']['repairedParts'])|set(names))
    refinement = dict(revision=REVISION,changedParts=len(rows),subtractiveOnly=True,
        sourceCADUnchanged=True,retainedAxesAndMotion=True,nativeBoundsUnchanged=True,
        cylinderAxesRadiiUnchanged=True,proofPath=str((PROOF/'validation.json').relative_to(ROOT)))
    meta['geoEdgeRefinement'] = refinement
    meta['lineage']['nativeRepairRecipeSHA256'] = sha(Path(__file__).with_name('working_core.py'))
    meta['lineage']['incrementalGeometryRecipe'] = str(Path(__file__).resolve())
    meta['lineage']['incrementalGeometryRecipeSHA256'] = sha(__file__)
    meta['clearanceReport']['edgeRefinement'] = dict(revision=REVISION,affectedParts=len(rows),
        exactNeighborPairs=len(pairs),affectedInterfaces=len(interfaces),
        addedVolumeMM3Maximum=max(r['addedVolumeMM3'] for r in rows),passed=True,
        previousUnaffectedPairsRetainedBySubtractiveContainment=True)
    meta['meshValidation'] = validate(native,expensive=False)
    for assembly in (native,runtime):
        assembly.metadata['modules'] = meta['modules']
        assembly.metadata['geoEdgeRefinement'] = refinement
        assembly.metadata['lineage'] = meta['lineage']
    write(output/'metadata.json',meta)
    write(output/'clearance-report.json',meta['clearanceReport'])
    save_cache(native,output/'cache')
    save_cache(runtime,output/'runtime-cache')
    runtime_report.update(checks=list(runtime_checks.values()),
        nativeTriangles=sum(len(p.faces) for p in native.parts),runtimeTriangles=sum(len(p.faces) for p in runtime.parts),
        measuredMaximumCADDeviationMM=max(r['sampledMaxCADDeviationMM'] or 0 for r in runtime_checks.values()),
        sourceMetadataSHA256=sha(output/'metadata.json'),geometryRevision=refinement)
    write(output/'runtime-tessellation-report.json',runtime_report)
    native_audit = audit_cached_meshes(output)
    runtime_audit = audit_cached_meshes(output,'runtime-cache')
    takeup = audit_geo_takeup(ROOT/'portfolio/output/geo-working/takeup-candidates.json',output)
    if not native_audit['passed'] or not runtime_audit['passed'] or not takeup['passed']:
        raise ValueError('Export/takeup gates failed; predecessor backup retained')
    final_meta = json.loads((output/'metadata.json').read_text())
    for cache in ('cache','runtime-cache'):
        manifest_path = output/cache/'manifest.json'
        doc = json.loads(manifest_path.read_text())
        predecessor = json.loads((backup/manifest_path.relative_to(ROOT)).read_text())
        analytic_flags = {p['name']:p.get('has_analytic_cad',False) for p in predecessor['parts']}
        for part in doc['parts']:
            # load_cache retains arrays and metadata, not live OCCT objects;
            # preserved BREP identities still supply unchanged analytic CAD.
            part['has_analytic_cad'] = bool(part['name'] in names or analytic_flags[part['name']])
        doc['metadata'].update(geoEdgeRefinement=refinement,
            structuralMeshAudit=final_meta['structuralMeshAudit'],
            runtimeStructuralMeshAudit=final_meta['runtimeStructuralMeshAudit'],
            takeupClearanceAudit=final_meta['takeupClearanceAudit'])
        write(manifest_path,doc)
    runtime_report['sourceMetadataSHA256'] = sha(output/'metadata.json')
    write(output/'runtime-tessellation-report.json',runtime_report)
    proof = dict(revision=REVISION,passed=True,changedParts=len(rows),parts=rows,
        nativeNeighbors=dict(exactPairs=len(pairs),pairs=pairs,failedPairs=0),interfaces=interfaces,
        nativeAudit=dict(checked=native_audit['checked'],passed=True),
        runtimeAudit=dict(checked=runtime_audit['checked'],passed=True),
        takeup=dict(structuralSolids=takeup['structuralCADParts'],profiles=takeup['profileCount'],
                    minimumResidualLowerBoundMM=takeup['minimumResidualClearanceLowerBoundMM'],
                    actualIdentitiesRefreshed=True,passed=True),
        sourceMaterialsAndMotionUnchanged=True,sourceCanonicalCADUnchanged=True,
        predecessorRepairRecipeSHA256=predecessor_recipe_hash,newArtifactPaths=created_paths,
        unchangedNativeMeshes=len(unchanged_native),unchangedRuntimeMeshes=len(unchanged_runtime),
        unchangedMeshArraysBitIdentical=True,
        preservedCachedAnalyticCADFlags=True,
        oldMetadataSHA256=next(r['sha256'] for r in backups if r['path']==str((output/'metadata.json').relative_to(ROOT))),
        newMetadataSHA256=sha(output/'metadata.json'),scriptSHA256=sha(__file__),
        authoringSourceSHA256=sha(Path(__file__).with_name('working_core.py')),
        nativeCacheSHA256=sha(output/'cache/meshes.npz'),runtimeCacheSHA256=sha(output/'runtime-cache/meshes.npz'),
        nativeCacheManifestSHA256=sha(output/'cache/manifest.json'),
        runtimeCacheManifestSHA256=sha(output/'runtime-cache/manifest.json'),
        elapsedSeconds=time.perf_counter()-started,
        limitation='Geometric fit and tessellation only; no manufacturing/load certification. Runtime deviation uses finite surface samples. Takeup uses the 129 declared sampled-linear profiles, continuous fixture translations and all X-axis angular phases.')
    write(PROOF/'validation.json',proof)
    print(json.dumps(dict(passed=True,changedParts=len(rows),exactNeighborPairs=len(pairs),
        interfaces=len(interfaces),nativeAudit=native_audit['checked'],runtimeAudit=runtime_audit['checked'],
        takeupSolids=takeup['structuralCADParts'],nativeTriangles=runtime_report['nativeTriangles'],
        runtimeTriangles=runtime_report['runtimeTriangles'],proof=str(PROOF/'validation.json'))),flush=True)


if __name__ == '__main__': main()
