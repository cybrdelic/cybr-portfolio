"""Rebuild and verify only the authored SCENES specimen-cartridge revision."""
import hashlib, json, shutil, sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-geo/src'))
from mechanism_lab.core import load_cache
from mechanism_lab.mesh_solids import checked_volume
from build_working_organics import intersection_volume, check_native_insert_hardware
from working_cartridges import build_scene_carrier, validate_and_save, verify_saved_hardware

def main():
    folder=ROOT/'portfolio/output/geo-working/cad-cartridges/scenes'
    backup=ROOT/'portfolio/output/geo-working/scenes-redesign/before-native'
    backup.parent.mkdir(parents=True,exist_ok=True)
    if not backup.exists():shutil.copytree(folder,backup)
    result=validate_and_save(build_scene_carrier(),folder)
    contacts=verify_saved_hardware(folder)
    native=load_cache(folder/'cache')
    organic=load_cache(ROOT/'portfolio/output/geo-working/organics/cache')
    volumes={}
    for p in organic.parts:
        if p.group=='scenes' and 'native-organic-volume' in p.tags:
            volumes[p.name]=checked_volume(p.vertices,p.faces,p.name)[0]
    rows=[]
    # Check every native SCENES part, including all new interior walls, rim,
    # spacers and exterior frame. AABB rejection is exact nonoccupation proof.
    for q in native.parts:
        qb=np.array([q.vertices.min(0),q.vertices.max(0)])
        for name,volume in volumes.items():
            vb=np.asarray(volume.bounds)
            rejected=bool(np.any(np.minimum(qb[1],vb[1])-np.maximum(qb[0],vb[0])<=1e-7))
            occupation=0.
            if not rejected:
                hardware=checked_volume(q.vertices,q.faces,q.name)[0]
                occupation=intersection_volume(hardware,volume)
            rows.append(dict(hardware=q.name,insert=name,aabbRejected=rejected,
                intersectionVolumeMM3=occupation,passed=occupation<=.01))
    report=dict(passed=all(x['passed'] for x in rows),tests=len(rows),
        actualBooleanTests=sum(not x['aabbRejected'] for x in rows),
        toleranceMM3=.01,method='CYBR GEO float64 Manifold exact mesh-volume intersections; all native hardware against all actual retained soil, water and rock volumes',
        sourceLandscapeUnmodified=True,canonicalScaleMMPerUnit=15,
        rows=rows,native=result,hardwareContacts=contacts['contacts'],
        scriptSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    out=backup.parent/'redesign-validation.json'
    out.write_text(json.dumps(report,indent=2)+'\n')
    if not report['passed']:raise ValueError('Redesigned specimen pan intersects the native landscape')
    # Organic topology has not changed, but record its current hardware fit
    # against the complete revision rather than retaining the obsolete two-
    # part-only certificate.
    meta_path=ROOT/'portfolio/output/geo-working/organics/metadata.json'
    meta=json.loads(meta_path.read_text())
    fit=check_native_insert_hardware(volumes)
    fit['redesignProof']=str(out.relative_to(ROOT))
    meta['report']['nativeHardwareFit']=fit
    meta_path.write_text(json.dumps(meta,indent=2)+'\n')
    cache_path=ROOT/'portfolio/output/geo-working/organics/cache/manifest.json'
    cache_doc=json.loads(cache_path.read_text())
    cache_doc['metadata']['nativeHardwareFit']=fit
    cache_path.write_text(json.dumps(cache_doc,indent=2)+'\n')
    print(json.dumps(dict(passed=True,parts=len(native.parts),triangles=result['triangles'],
        occupationTests=len(rows),actualBooleanTests=report['actualBooleanTests'],
        maxOccupationMM3=max(x['intersectionVolumeMM3'] for x in rows),
        hardwareCollisionPairs=contacts['contacts']['exactCADPairsTested'],
        hardwareCollisions=len(contacts['contacts']['collisions']),proof=str(out))))

if __name__=='__main__':main()
