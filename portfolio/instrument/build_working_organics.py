"""Package the actual Combat mannequin and volumetric CYBR GEO landscape.

No generated images, nonuniform terrain transforms, or separate skirt skins.
Organic artist surfaces are distinguished from closed physical volumes.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, sys
import numpy as np
import trimesh
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'cybr-geo/src'))
from mechanism_lab import Assembly, Material
from mechanism_lab.core import Part, mesh_part, save_cache
from mechanism_lab.mesh_solids import checked_volume, seal_heightfield, subtract_volume, cap_open_component, thicken_open_surface, boolean_volumes, topology
from build_springs_physical import load

OUT = ROOT/'portfolio/output/geo-working/organics'


def transformed(v):
    # One rigid axis change and ONE uniform scale from canonical source units.
    return np.column_stack((v[:, 0], -v[:, 2], v[:, 1])) * 15.0


def close_lamina(mesh, thickness=.03):
    """Close planar or gently folded native chips without moving their exterior."""
    return thicken_open_surface(mesh,thickness)[0]


def repair_rocks(vertices, faces):
    source = trimesh.Trimesh(vertices, faces, process=True)
    source.update_faces(source.unique_faces())
    source.update_faces(source.nondegenerate_faces())
    source.remove_unreferenced_vertices()
    components = source.split(only_watertight=False)
    repaired, methods = [], {'retained': 0, 'cutLoopCap': 0, 'nominalLamina': 0}
    lamina_diagnostics=[]
    for component in components:
        component.fix_normals(multibody=True)
        if component.is_volume:
            repaired.append(component); methods['retained'] += 1
            continue
        try:
            result = cap_open_component(component)
            methods['cutLoopCap'] += 1
        except ValueError as cap_error:
            points = np.asarray(component.vertices)
            edge_counts=np.bincount(component.edges_unique_inverse)
            boundary=component.edges_unique[edge_counts==1]
            boundary_vertices=np.unique(boundary)
            centered=points-points.mean(axis=0)
            _,_,axes=np.linalg.svd(centered,full_matrices=False)
            departure=float(np.abs(centered@axes[-1]).max())
            # A clipped triangulated patch may be nonplanar. A two-triangle
            # warped quad is not a full rock shell; its original face remains
            # exact while its explicit inward thickness creates real volume.
            patch=component.euler_number==1 and (len(boundary_vertices)==len(points) or departure<.02)
            if not patch:
                raise ValueError(f'Source rock needs genuine exterior repair, not nominal shell thickening: {topology(component)}; cap: {cap_error}')
            result,chip_report=thicken_open_surface(component,.03)
            lamina_diagnostics.append(dict(vertices=len(points),triangles=len(component.faces),
                nonplanarDepartureMM=departure,exteriorCoordinatesModified=False,
                addedInwardThicknessMM=.03,volumeMM3=chip_report['volumeMM3']))
            methods['nominalLamina'] += 1
        repaired.append(result)
    # Union touching imported pieces instead of welding coincident vertices and
    # calling the resulting branched triangle soup a physical volume.
    result = boolean_volumes(repaired,'union')
    result, report = checked_volume(result.vertices, result.faces, 'source rock union')
    report.update(source=topology(source), components=len(components), methods=methods,
                  nominalChipThicknessMM=.03, sourceExteriorCoordinatesModified=False,
                  unionMaySplitAtActualIntersections=True,hiddenHull=False,
                  laminaExamples=lamina_diagnostics[:12],
                  maxLaminaDepartureMM=max((d['nonplanarDepartureMM'] for d in lamina_diagnostics),default=0))
    return result, report


def intersection_volume(a,b):
    common=boolean_volumes([a,b],'intersection')
    return 0. if common is None or len(common.faces)==0 else abs(float(common.volume))


def check_native_insert_hardware(volumes):
    """Compare the repaired insert against every saved native SCENES part."""
    folder=ROOT/'portfolio/output/geo-working/cad-cartridges/scenes/cache'
    manifest=json.loads((folder/'manifest.json').read_text())
    hardware={}
    with np.load(folder/'meshes.npz') as cache:
        for i,part in enumerate(manifest['parts']):
            m,_=checked_volume(cache[f'p{i}_vertices'],cache[f'p{i}_faces'],part['name'])
            hardware[part['name']]=m
    rows=[]
    for organic_name,organic in volumes.items():
        for hardware_name,shape in hardware.items():
            rejected=bool(np.any(np.minimum(organic.bounds[1],shape.bounds[1])-np.maximum(organic.bounds[0],shape.bounds[0])<=1e-6))
            if rejected:
                overlap=0.
            else:overlap=intersection_volume(organic,shape)
            tolerance=max(1e-4,min(abs(float(organic.volume)),abs(float(shape.volume)))*1e-7)
            row=dict(organic=organic_name,hardware=hardware_name,intersectionMM3=overlap,
                toleranceMM3=tolerance,aabbRejected=rejected,passed=bool(overlap<=tolerance))
            rows.append(row)
            if not row['passed']:raise ValueError(f'Physical source insert penetrates native hardware: {row}')
    return dict(passed=True,method='Manifold actual closed volume intersections against native CAD tessellation',
        checkedParts=len(hardware),checkedPairs=len(rows),actualBooleanTests=sum(not x['aabbRejected'] for x in rows),
        cadCacheSHA256=hashlib.sha256((folder/'meshes.npz').read_bytes()).hexdigest(),pairs=rows,
        sourceTransforms='Single uniform 15 mm/unit scale and rigid Y-up to Z-up conversion')


def build(output=OUT):
    output.mkdir(parents=True, exist_ok=True)
    original_dir = ROOT/'portfolio/assets/instrument-cartridges-c'
    original = json.loads((original_dir/'manifest.json').read_text())
    binary = gzip.decompress((original_dir/'instrument.bin.gz').read_bytes())
    digest = hashlib.sha256(binary).hexdigest()
    assert digest == original['stats']['sha256']
    materials, parts, attributes = [], [], {}
    report = {'sourceHumanoidGeometrySHA256': digest, 'terrainUniformScaleMMPerUnit': 15.0,
              'nonuniformTransforms': False, 'generatedImages': False, 'meshVolumes': {}}
    material_lookup = {}
    # Preserve actual body/garment source topology and normals. Garment hems and
    # anatomical openings are authored surfaces, never mislabeled CAD solids.
    body_parts = []
    for record in original['meshes']:
        if record['module'] != 'combat': continue
        definition = original['customMaterials'].get(str(record['material']), {})
        role = definition.get('role')
        if role not in ('body', 'shirt', 'shorts'): continue
        def read(key, columns):
            spec = record[key]
            dtype = {'float32':'<f4', 'int16':'<i2', 'uint32':'<u4'}[spec['dtype']]
            value = np.frombuffer(binary, dtype=dtype, offset=spec['offset'], count=spec['count']).copy()
            if key == 'normals' and spec['dtype'] == 'int16': value = value.astype(float)/32767
            return value.reshape(-1, columns)
        mat = len(materials)
        materials.append(Material('Original CYBR Combat '+role, tuple(definition['color']),
                                  definition['metalness'], definition['roughness'],
                                  material_source='Original CYBR Combat mannequin; unchanged source arrays'))
        part = Part('combat__source_'+role+'_'+record['feature'], read('positions', 3), read('indices', 3),
                    read('normals', 3), mat, group='combat', motion='deck',
                    provenance='retained-cybr-combat', role='Original '+role,
                    tags=('artist-surface', 'original-source', 'moves-with-deck'))
        body_parts.append(part)
    assert {p.role for p in body_parts} == {'Original body', 'Original shirt', 'Original shorts'}
    foot_min = min(p.vertices[:, 2].min() for p in body_parts)
    for part in body_parts:
        part.vertices[:, 2] -= foot_min
        parts.append(part)
    report['mannequin'] = {'originalSoleZMM': float(foot_min), 'groundedSoleZMM': 0.,
                            'translationMM': [0., 0., -float(foot_min)],
                            'scale': 1., 'sourceSurfacesPreserved': True}
    del binary
    low_doc, low = load(ROOT/'portfolio/assets/springs-runtime-v1')
    high_doc, high = load(ROOT/'portfolio/assets/springs-native-v1')
    assert low_doc['sourceGeometry'] == high_doc['sha256']
    report['landscapeSourceSHA256'] = high_doc['sha256']
    high_by_name = {m['name']:m for m in high}
    terrain_material = len(materials)
    materials.append(Material('Original CYBR GEO mineral albedo', (1., 1., 1.), 0., .8,
                              material_source='Unlit native source material samples'))
    water_material = len(materials)
    materials.append(Material('Physical spring water', (.83, .95, .97), 0., .025, ior=1.334,
                              material_source='Original closed native spring water volume'))
    terrain_source = low[0]
    top = transformed(terrain_source['position'])
    sealed, sealing_report = seal_heightfield(top, terrain_source['index'].reshape(-1, 3), -12.45)
    water_source = next(m for m in high if m['material'] == 'water')
    water, water_report = checked_volume(transformed(water_source['position']), water_source['index'].reshape(-1, 3), 'native water')
    soil, soil_report = subtract_volume(sealed, water, 'closed terrain with actual basin')
    report['meshVolumes']['terrain'] = {'sealing':sealing_report, 'basin':soil_report}
    report['meshVolumes']['water'] = water_report
    def add_organic(name, vertices, faces, colors, color_source_vertices=None, solid=False):
        part_name='scenes__'+name.replace(' ', '_')
        kw=dict(group='scenes',role='Actual CYBR GEO landscape / '+name,
            provenance='retained-cybr-geo',tags=('native-organic-volume' if solid else 'artist-surface',))
        if solid:
            volume,_=checked_volume(vertices,faces,part_name)
            # Preserve actual Boolean component identities. VTK global cleaning
            # would weld zero-volume contacts and recreate branching edges.
            part=Part(part_name,np.asarray(volume.vertices),np.asarray(volume.faces),
                np.asarray(volume.vertex_normals),terrain_material,**kw)
        else:part=mesh_part(part_name,vertices,faces,terrain_material,**kw)
        source_vertices = np.asarray(vertices) if color_source_vertices is None else color_source_vertices
        ids = cKDTree(source_vertices).query(part.vertices)[1]
        attributes[part.name] = np.asarray(colors)[ids].astype('<f4')
        parts.append(part)
    rocks=[];surfaces=[]
    for source in low[2:]:
        if source['name'] == 'Sealed mineral section': continue
        if source['name'].startswith('Buried_weathered'):
            source = high_by_name[source['name']]
            v = transformed(source['position'])
            rock, rock_report = repair_rocks(v, source['index'].reshape(-1, 3))
            report['meshVolumes'][source['name']] = rock_report
            rocks.append((source,rock,v))
            print(json.dumps({'phase':'repaired-source-rocks','source':source['name'],
                'components':rock_report['components'],'methods':rock_report['methods'],
                'closedTriangles':len(rock.faces)}),flush=True)
        else:
            v = transformed(source['position'])
            surfaces.append((source,v))
    rock_union=boolean_volumes([r for _,r,_ in rocks],'union')
    rock_union,rock_union_report=checked_volume(rock_union.vertices,rock_union.faces,'all actual mineral rocks')
    report['meshVolumes']['Native_mineral_rock_union']=rock_union_report
    # Keep real submerged rock exteriors. Water must occupy the space around
    # them, rather than deleting the rocks to make room for an overlapping fluid.
    water,water_carve=subtract_volume(water,rock_union,'physical water around retained native rocks')
    soil,soil_carve=subtract_volume(soil,rock_union,'physical mineral matrix around retained native rocks')
    report['meshVolumes']['water']['rockCavity']=water_carve
    report['meshVolumes']['terrain']['mineralCavities']=soil_carve
    soil_water=intersection_volume(soil,water)
    report['physicalOccupation']=dict(soilWaterIntersectionMM3=soil_water,
        waterRockIntersectionMM3=intersection_volume(water,rock_union),
        soilRockIntersectionMM3=intersection_volume(soil,rock_union),
        operation='Actual volume Booleans; native source rock exteriors are retained')
    if max(v for k,v in report['physicalOccupation'].items() if k.endswith('MM3'))>.01:
        raise ValueError('Physical insert still contains overlapping soil/water/rock material')
    report['nativeHardwareFit']=check_native_insert_hardware({'soil':soil,'water':water,'rocks':rock_union})
    add_organic('Closed_terrain_and_basin', soil.vertices, soil.faces, terrain_source['albedo'], top, True)
    water_part = Part('scenes__Closed_native_spring_water',np.asarray(water.vertices),np.asarray(water.faces),
                          np.asarray(water.vertex_normals),water_material,group='scenes',
                          role='Closed water surrounding the retained submerged mineral geometry',
                          provenance='retained-cybr-geo',tags=('native-organic-volume','water'))
    parts.append(water_part)
    add_organic('Native_mineral_rock_union',rock_union.vertices,rock_union.faces,
        np.concatenate([source['albedo'] for source,_,_ in rocks]),np.concatenate([v for _,_,v in rocks]),True)
    for source,v in surfaces:add_organic(source['name'],v,source['index'].reshape(-1,3),source['albedo'])
    assembly = Assembly('working_original_project_inserts', parts, materials, {}, metadata=report)
    save_cache(assembly, output/'cache')
    np.savez_compressed(output/'albedo.npz', **attributes)
    metadata = {'report':report, 'bodyMotion':{'rig':'combat','kind':'deck'},
                'waterPart':water_part.name, 'vertexColorParts':list(attributes),
                'physicalVolumes':list(report['meshVolumes']), 'materials': [m.as_dict() for m in materials]}
    (output/'metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')
    print(json.dumps({'parts':len(parts), 'triangles':sum(len(p.faces) for p in parts),
                      'grounded':report['mannequin']['groundedSoleZMM'], 'cache':str(output/'cache')}))
    return assembly, metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=OUT)
    build(parser.parse_args().out)
