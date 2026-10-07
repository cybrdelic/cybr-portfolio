"""Export validated CYBR GEO CAD and native project inserts for the portfolio.

The binary contains actual tessellated parts, not projected beauty photographs.
Each draw batch retains named part ranges and exactly one rigid motion contract.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, shutil, sys
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'cybr-geo/src'))
from mechanism_lab.core import load_cache
from metal_finish import machining_uv
from refine_terrain_materials import build_filtered_albedo

WORK = ROOT/'portfolio/output/geo-working'
OUT = ROOT/'portfolio/assets/instrument-working-v1'
NAMES = ('geo', 'light', 'elements', 'song', 'combat', 'scenes')


def document(path):
    return json.loads(Path(path).read_text())


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''): h.update(block)
    return h.hexdigest()


def write_binary(folder, meshes):
    offset, digest, records = 0, hashlib.sha256(), []
    filename = folder/'instrument.bin.gz'
    with gzip.GzipFile(filename=str(filename), mode='wb', compresslevel=6, mtime=0) as stream:
        for mesh in meshes:
            record = {k:v for k,v in mesh.items() if not isinstance(v, np.ndarray)}
            for key, source in mesh.items():
                if not isinstance(source, np.ndarray): continue
                if key == 'normals':
                    value = np.round(np.clip(source, -1, 1)*32767).astype('<i2')
                elif key == 'indices': value = source.astype('<u4')
                else: value = source.astype('<f4')
                value = np.ascontiguousarray(value)
                padding = (-offset)%4
                if padding: stream.write(bytes(padding)); digest.update(bytes(padding)); offset += padding
                record[key] = dict(offset=offset, count=value.size,
                                   dtype='int16' if key=='normals' else 'uint32' if key=='indices' else 'float32')
                data = memoryview(value).cast('B')
                for start in range(0, len(data), 65536):
                    stream.write(data[start:start+65536]); digest.update(data[start:start+65536])
                offset += value.nbytes
            records.append(record)
    stats = dict(triangles=sum(m['indices'].size//3 for m in meshes), drawGroups=len(meshes),
                 geometryBytes=filename.stat().st_size, decodedGeometryBytes=offset,
                 sha256=digest.hexdigest(), sourceParts=sum(len(m['partRanges']) for m in meshes))
    return records, stats


def vertex_visibility(meshes, custom):
    """Raycast actual geometry within each rigid assembly, without beauty maps.

    Casters with different motion are deliberately separate. A contact shadow
    cannot remain stamped on a part when another mechanism moves away from it.
    """
    from trimesh.ray.ray_pyembree import RayMeshIntersector
    samples, reach = 12, 12.
    u = (np.arange(samples)+.5)/samples
    phi = np.arange(samples)*np.pi*(3-np.sqrt(5))
    directions = np.column_stack((np.sqrt(u)*np.cos(phi),np.sqrt(u)*np.sin(phi),np.sqrt(1-u)))
    rigid = {}
    for mesh in meshes:
        transparent = mesh['material'] in (3,7) or custom.get(str(mesh['material']),{}).get('transmission',0)>0
        if transparent: continue
        key = (mesh['module'],mesh['assemblyShiftX'],json.dumps(mesh['motion'],sort_keys=True))
        rigid.setdefault(key,[]).append(mesh)
    for members in rigid.values():
        caster = trimesh.util.concatenate([trimesh.Trimesh(m['positions'],m['indices'],process=False) for m in members])
        rays = RayMeshIntersector(caster)
        for mesh in members:
            v,n = mesh['positions'],mesh['normals']; visibility = np.ones(len(v),dtype='<f4')
            for start in range(0,len(v),2048):
                points, normal = v[start:start+2048],n[start:start+2048]
                axis = np.tile([0.,0.,1.],(len(points),1));axis[np.abs(normal[:,2])>.95]=[0,1,0]
                tangent = np.cross(normal,axis);tangent /= np.maximum(np.linalg.norm(tangent,axis=1,keepdims=True),1e-12)
                bitangent = np.cross(normal,tangent)
                d = (directions[None,:,0,None]*tangent[:,None,:]+directions[None,:,1,None]*bitangent[:,None,:]+directions[None,:,2,None]*normal[:,None,:]).reshape(-1,3)
                origins = np.repeat(points+normal*.025,samples,axis=0)
                hit = rays.intersects_first(origins,d);valid=hit>=0
                distance = np.full(len(hit),1000.)
                fn = caster.face_normals[hit[valid]]
                denominator = np.einsum('ij,ij->i',d[valid],fn)
                with np.errstate(divide='ignore',invalid='ignore'):
                    distance[valid] = np.einsum('ij,ij->i',caster.triangles[hit[valid],0]-origins[valid],fn)/denominator
                visibility[start:start+len(points)] = 1-((distance>0)&(distance<reach)).reshape(-1,samples).mean(axis=1)
            mesh['occlusion'] = visibility
    return dict(type='Actual native geometry ray visibility',samples=samples,reachMM=reach,
                rigidCasterGroups=len(rigid),differentMotionCasters=False,beautyImages=False)


def build(output=OUT, core_cache=None):
    output.mkdir(parents=True, exist_ok=True)
    core_metadata = document(WORK/'core-cad/metadata.json')
    assert core_metadata['clearanceReport']['passed'], 'Core CAD contact audit has not passed'
    assert core_metadata['structuralMeshAudit']['passed'], 'Core structural tessellation is not closed'
    core_path = Path(core_cache) if core_cache else WORK/'core-cad/runtime-cache'
    if not core_path.exists(): core_path = WORK/'core-cad/cache'
    if core_path.name=='runtime-cache':
        assert core_metadata['runtimeStructuralMeshAudit']['passed'], 'Runtime structural CAD tessellation has not passed'
    core = load_cache(core_path)
    batches, named, custom, material_keys = {}, {}, {}, {}
    kinematics, ports, routes = {}, dict(core_metadata['ports']), []
    validation = {
        'core': {k:core_metadata['clearanceReport'][k] for k in
                 ('passed','structuralSolids','exactIntersectionPairs','volumeToleranceMM3')},
        'coreMesh': {k:core_metadata['structuralMeshAudit'][k] for k in ('passed','checked')},
    }
    runtime_report_path = WORK/'core-cad/runtime-tessellation-report.json'
    runtime_report = document(runtime_report_path) if runtime_report_path.exists() else {}
    takeup_report_path = WORK/'core-cad/takeup-clearance-report.json'
    if takeup_report_path.exists():
        takeup_report = document(takeup_report_path)
        assert takeup_report.get('passed'), 'Native GEO takeup clearance has not passed'
        validation['takeup'] = {k:takeup_report[k] for k in
            ('passed','method','candidateSHA256','profileCount','structuralCADParts',
             'continuousCondenseCovered','allAngularPhasesCovered','cableRadiusMM',
             'requestedResidualClearanceMM','maxProofSpacingMM',
             'minimumResidualClearanceLowerBoundMM','geometryScope','limitation')}
    original = document(ROOT/'portfolio/assets/instrument-cartridges-c/manifest.json')
    environment = dict(original['environment'])
    # Both packages are siblings; the existing calibrated studio remains valid.
    if not environment['file'].startswith('../instrument-3d/'):
        environment['file'] = '../instrument-3d/'+environment['file']

    def custom_material(material, properties=None, role='hardware', vertex_colors=False):
        definition = dict(name=material.name, color=list(material.color), metalness=material.metal,
                          roughness=material.rough, ior=material.ior, opacity=material.opacity,
                          coat=material.coat, coatRoughness=material.coat_rough,
                          anisotropy=material.anisotropy, microfinish=material.microfinish,
                          materialSource=material.material_source, role=role, vertexColors=vertex_colors)
        for key,value in (properties or {}).items():
            definition['thicknessMM' if key=='thickness' else key] = value
        if definition.get('transmission', 0)>0: definition['opacity'] = 1
        key = json.dumps(definition, sort_keys=True)
        if key not in material_keys:
            index = 8+len(material_keys); material_keys[key] = index; custom[str(index)] = definition
        return material_keys[key]

    def add_part(part, module, material, motion=None, shift=0, colors=None, lineage=None):
        # Surface coordinates are split only at chart seams; CAD normals remain
        # distinct at real face boundaries. Geometry coordinates are not rounded.
        v, f, n = np.asarray(part.vertices), np.asarray(part.faces), np.asarray(part.normals)
        if len(v)==0 or len(f)==0 or not np.isfinite(v).all(): raise ValueError(part.name)
        n = n/np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        if material<8 or custom[str(material)].get('microfinish')=='machined':
            corner_uv = machining_uv(part).reshape(-1,3)[:,:2]
            keys = np.column_stack((f.ravel(), np.round(corner_uv, 8)))
            _, keep, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
            source = f.ravel()[keep]; v, n, uv, f = v[source], n[source], corner_uv[keep], inverse.reshape(-1,3)
            if colors is not None: colors = np.asarray(colors)[source]
        else: uv = v[:,:2]/40
        descriptor = motion or {'kind':'static'}
        key = (module, material, float(shift), json.dumps(descriptor, sort_keys=True), colors is not None)
        batch = batches.setdefault(key, dict(module=module, material=material, assemblyShiftX=float(shift),
                   motion=descriptor, partNames=[], partRanges=[], vertices=[], normals=[], faces=[],
                   uvs=[], colors=[], vertexCount=0, indexCount=0))
        batch['partNames'].append(part.name)
        batch['partRanges'].append(dict(name=part.name, firstVertex=batch['vertexCount'], vertexCount=len(v),
                                       firstIndex=batch['indexCount'], indexCount=f.size))
        batch['vertices'].append(v); batch['normals'].append(n); batch['faces'].append(f+batch['vertexCount'])
        batch['uvs'].append(uv)
        if colors is not None: batch['colors'].append(colors)
        batch['vertexCount'] += len(v); batch['indexCount'] += f.size
        named[part.name] = dict(module=module, role=part.role, provenance=part.provenance, tags=list(part.tags),
                               material=material, motion=descriptor, assemblyShiftX=shift,
                               boundsMM=part.bounds.tolist(), **({'cad':lineage} if lineage else {}))

    for part in core.parts:
        record = core_metadata['parts'][part.name]
        # Formed SONG bronze uses the native authored finish, including its
        # physical reflectance; the original fixed material table called this
        # slot ivory and must not override the redesigned native shell.
        material = custom_material(core.materials[part.material]) if part.group=='song' and part.material==5 else part.material
        add_part(part, part.group, material, shift=record['assemblyShiftX'], lineage={k:record[k] for k in
                 ('brepFile','brepSHA256','repaired','function') if k in record})
    core_routes = core_metadata.get('routes')
    if core_routes is None:
        route_path = WORK/'core-cad/routes.json'
        route_document = document(route_path) if route_path.exists() else {}
        core_routes = route_document.get('routes',route_document)
    if isinstance(core_routes,dict):
        core_routes = [dict(record,module=module,name=module) for module,record in core_routes.items()]
    assert {r.get('module',r.get('name')) for r in core_routes} >= {'light','elements','song'}, 'Missing exact core CAD wires'
    for record in core_routes:
        module = record.get('module', record['name'])
        routes.append(dict(record, name=module, module=module, sourcePart=record.get('sourcePart',record['name'])))

    for module in ('combat','scenes'):
        folder = WORK/'cad-cartridges'/module
        metadata = document(folder/'metadata.json')
        audit = document(folder/'cad-validation.json')
        assert not audit['hardwareContacts']['collisions'], module+' CAD contacts failed'
        assembly = load_cache(folder/'cache')
        ports[module] = metadata['ports']; kinematics.update(metadata['kinematics'])
        validation[module] = dict(parts=audit['parts'], triangles=audit['triangles'],
                                  checks=audit['checks'], hardwareContacts=audit['hardwareContacts'],
                                  exactJointDistances=audit.get('exactJointDistances'))
        palette = {i:custom_material(m, metadata.get('materialProperties',{}).get(str(i)))
                   for i,m in enumerate(assembly.materials)}
        for part in assembly.parts:
            add_part(part, module, palette[part.material], motion=metadata['partRig'].get(part.name),
                     lineage=dict(cadSHA256=metadata['cadSHA256'], nativeKernel=metadata['nativeKernel']))
        for record in metadata['routes']:
            routes.append(dict(record, name=module, module=module, sourcePart=record['name']))

    organic_folder = WORK/'organics'
    organic = load_cache(organic_folder/'cache'); organic_metadata = document(organic_folder/'metadata.json')
    mineral_sampling = build_filtered_albedo(organic_folder, assembly=organic)
    colors = np.load(organic_folder/'albedo-filtered.npz')
    for part in organic.parts:
        module = part.group
        water = part.name==organic_metadata['waterPart']
        role = part.role.removeprefix('Original ') if module=='combat' else 'springs-water' if water else 'landscape'
        properties = dict(transmission=1, thickness=12, ior=1.334,
                          attenuationColor=[.83,.95,.97], attenuationDistance=280) if water else {}
        palette = custom_material(organic.materials[part.material], properties, role, part.name in colors)
        add_part(part, module, palette, motion=organic_metadata['bodyMotion'] if module=='combat' else None,
                 colors=colors[part.name] if part.name in colors else None)
    validation['organics'] = organic_metadata['report']
    validation['mineralMaterialSampling'] = mineral_sampling
    meshes = []
    for i,batch in enumerate(batches.values()):
        v = np.concatenate(batch.pop('vertices')); n = np.concatenate(batch.pop('normals'))
        f = np.concatenate(batch.pop('faces')); uv = np.concatenate(batch.pop('uvs'))
        color = batch.pop('colors'); batch.pop('vertexCount'); batch.pop('indexCount')
        mesh = dict(batch, feature='native-rig-'+str(i), positions=v, normals=n, indices=f,
                    uv=uv, occlusion=np.ones(len(v)), finish=np.ones((len(v),2)))
        if color: mesh['colors'] = np.concatenate(color)
        meshes.append(mesh)
    visibility_report = vertex_visibility(meshes,custom)
    records, stats = write_binary(output, meshes)
    stats['nativeCADParts'] = sum(bool(r.get('cad')) for r in core_metadata['parts'].values())+sum(
        validation[n]['parts'] for n in ('combat','scenes'))
    stats['nativeCoreTriangles'] = runtime_report.get('nativeTriangles')
    modules = []
    old_modules = {m['name']:m for m in original['modules']}
    for module in NAMES:
        points = np.concatenate([m['positions'] for m in meshes if m['module']==module])
        lo,hi = points.min(0),points.max(0)
        modules.append(dict(name=module, explodedX=old_modules[module]['explodedX'],
                            assembledX=original.get('assembled',[-175,-68,18,110,188,308])[NAMES.index(module)],
                            bounds=[lo.tolist(),hi.tolist()], bakeCenter=((lo+hi)/2).tolist(),
                            parts=sum(n['module']==module for n in named.values())))
    routing = dict(minimumHousingGapMM=8, minBendRadiusMM=12)
    # Use the audited native guide and bearing sections, never a guessed shell.
    routing['takeup'] = core_metadata.get('routing',{}).get('takeup', dict(
        x0=-35,x1=35,maximumRadiusMM=20,minimumClearanceMM=.2,
        boreEnvelope=[dict(name='rear service',x=[-47,-35],innerRadiusMM=2.8),
                      dict(name='rear guide',x=[-35.6,-34.4],innerRadiusMM=4),
                      dict(name='inner barrel',x=[-33,8],innerRadiusMM=28),
                      dict(name='bearing',x=[17,31],innerRadiusMM=20),
                      dict(name='front guide',x=[34.4,35.6],innerRadiusMM=4),
                      dict(name='front service',x=[35,61],innerRadiusMM=2.8)]))
    manifest = dict(schema='cybr-geo-working-portfolio-v1', units='mm', axis='X shaft / Z up',
                    workingGeometry=True, source='CYBR GEO native CAD + original CYBR Combat + original CYBR GEO Springs',
                    modules=modules, meshes=records, stats=stats, customMaterials=custom,
                    environment=environment, kinematics=kinematics, routing=routing, routes=routes,
                    namedParts=named, cadValidation=validation, generatedImages=False,
                    legacyBeautyProjection=False, productionApproved=False,
                    surfaceVisibility=visibility_report,
                    runtimeTessellation={k:runtime_report[k] for k in
                        ('method','linearDeflectionMM','angularDeflectionRad','runtimeTriangles',
                         'structuralFeatureOmissions','measuredMaximumCADDeviationMM','deviationScope',
                         'omittedDuplicateCosmetics') if k in runtime_report},
                    validationScope='Geometric fit, rigid closure, cable routing and native mesh integrity; no force dynamics')
    route = dict(version=2,units='mm', cableRadius=2.35,minimumBoreRadius=2.8,minBendRadiusMM=12,
                 assembled=[-175,-68,18,110,188,308], ports=ports,routes=routes,
                 internalInterpolation='sampled-linear',internalRoutes={r['name']:r['points'] for r in routes})
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (output/'route.json').write_text(json.dumps(route, indent=2)+'\n')
    shutil.copyfile(ROOT/'portfolio/assets/instrument-3d/machined-roughness.png',output/'machined-roughness.png')
    receipt = dict(stats=stats, namedParts=len(named), generatedImages=0,
                   cacheSources=[str(core_path),str(WORK/'cad-cartridges'),str(organic_folder)],
                   sourceManifestSHA256=sha(output/'manifest.json'), routeSHA256=sha(output/'route.json'))
    (WORK/'package-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))
    return manifest,route


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--out',type=Path,default=OUT)
    parser.add_argument('--core-cache',type=Path)
    args=parser.parse_args(); build(args.out,args.core_cache)
