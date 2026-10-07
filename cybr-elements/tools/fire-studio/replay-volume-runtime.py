"""Replay recorded production JS commands offscreen, without a browser.

Only COPY_SRC usage is added for evidence readback. Pipeline layouts, bound
resources, shaders, dispatches, pass boundaries and submission order are the
recorded production values. This does not measure browser FPS or RAF pacing.
"""
import argparse, hashlib, json, re, sys, time, traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
Q = REPO / 'work/adaptive-volume-qa'
ap = argparse.ArgumentParser()
ap.add_argument('recording')
ap.add_argument('--adapter', choices=['integrated', 'discrete'], default='integrated')
ap.add_argument('--profile', action='store_true', help='Calibrated native timestamps per recorded submission')
ap.add_argument('--profile-passes', action='store_true', help='Also record native GPU timestamps for each production pass')
ap.add_argument('--save-fields', action='store_true', help='Save full snapshot RGBA16F fields as .npy evidence')
ap.add_argument('--field-summaries', action='store_true', help='Read reduced wood/chemistry summaries at snapshots without saving full field arrays')
ap.add_argument('--output', help='New output subdirectory under the recording; preserves previous evidence')
ap.add_argument('--stream', action='store_true', help='Persistent native worker: JSON batch paths on stdin, real mapped readback paths on stdout')
args = ap.parse_args()
if args.stream and args.profile_passes:
    ap.error('--stream supports submission profiling; pass profiling needs a complete fixed recording.')
source = Path(args.recording)
if not source.is_absolute(): source = Q / source
if source.is_dir(): source = source / 'commands.json'
data = json.loads(source.read_text())
folder = (source.parent / (args.output or ('native-' + args.adapter))).resolve()
if not folder.is_relative_to(source.parent.resolve()) or folder == source.parent.resolve():
    ap.error('--output must stay within the recording directory.')
folder.mkdir(exist_ok=False)
# Existing local QA dependencies are optional; ordinary installed packages work.
sys.path.insert(0, str(REPO / 'work/smoke-shapes-qa/vendor'))
import wgpu
import numpy as np
from PIL import Image
from native_wood_fault import material_peaks, flux_summary

(folder/'initialization-progress.json').write_text(json.dumps({'stage':'adapter'}))
adapter = wgpu.gpu.request_adapter_sync(power_preference='low-power' if args.adapter == 'integrated' else 'high-performance')
(folder/'initialization-progress.json').write_text(json.dumps({'stage':'device','adapter':dict(adapter.info)}))
dev = adapter.request_device_sync(required_features=['timestamp-query'] if args.profile else [])
queue = dev.queue
objects, descriptions = {}, {r['id']: r for r in data['resources']}
report = {'nativeOnly': True, 'recording': str(source), 'options': data.get('options'), 'adapter': dict(adapter.info),
    'textureCopySrcReadbackUsageAdded': True, 'resourceCount': len(data['resources']), 'submissions': [], 'frames': [], 'pass': False}
if args.stream:
    report['feedback'] = {'actualNativeReadbacks': True, 'productionCollectors': True,
        'serialNativeCompletion': True, 'readbackLagFrames': data.get('options', {}).get('readbackLagFrames', 0), 'readbacks': []}
location = {}
pending_submissions = []
pass_profile = []
last_frame_operation = None

def snake(key): return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', key).lower()
def resolve(value):
    if isinstance(value, list): return [resolve(v) for v in value]
    if isinstance(value, dict):
        if '$ref' in value: return objects[value['$ref']]
        return {snake(k): resolve(v) for k, v in value.items()}
    return value
def size3(size):
    if isinstance(size, dict): return (size['width'], size.get('height',1), size.get('depthOrArrayLayers',size.get('depth_or_array_layers',1)))
    return tuple(size) + (1,) * (3-len(size))
def create(item):
    global location
    location = {'resource': item['id'], 'kind': item['kind'], 'label': item['desc'].get('label')}
    kind, desc = item['kind'], resolve(item['desc'])
    if kind == 'texture': desc['usage'] |= wgpu.TextureUsage.COPY_SRC;return dev.create_texture(**desc)
    if kind == 'view': texture = desc.pop('texture');return texture.create_view(**desc)
    if kind == 'buffer': return dev.create_buffer(**desc)
    if kind == 'sampler': return dev.create_sampler(**desc)
    if kind == 'module': return dev.create_shader_module(**desc)
    if kind == 'computePipeline': return dev.create_compute_pipeline(**desc)
    if kind == 'renderPipeline': return dev.create_render_pipeline(**desc)
    if kind == 'bindGroup':
        layout = desc['layout'];desc['layout'] = layout['pipeline'].get_bind_group_layout(layout['index'])
        return dev.create_bind_group(**desc)
    raise RuntimeError('Unsupported recorded resource: ' + kind)

def command(encoder, record, ordinal):
    global location
    location = {'command': ordinal, 'kind': record['kind']}
    kind = record['kind']
    if kind == 'clearBuffer':
        encoder.clear_buffer(objects[record['buffer']], record['offset'], record.get('size'));return
    if kind == 'copyBuffer':
        encoder.copy_buffer_to_buffer(objects[record['src']],record['srcOffset'],objects[record['dst']],record['dstOffset'],record['size']);return
    if kind not in ('compute','render'): raise RuntimeError('Unsupported recorded command: ' + kind)
    desc = resolve(record['desc'])
    if args.profile and args.profile_passes:
        pipeline_id=next((c['id'] for c in record['commands'] if c['kind']=='pipeline'),None)
        label=descriptions[pipeline_id]['desc'].get('label',kind) if pipeline_id else kind
        first=2+len(pass_profile)*2
        desc['timestamp_writes']={'query_set':query,'beginning_of_pass_write_index':first,'end_of_pass_write_index':first+1}
        pass_profile.append({'label':label,'kind':kind,'command':ordinal})
    p = encoder.begin_compute_pass(**desc) if kind == 'compute' else encoder.begin_render_pass(**desc)
    pipeline = None
    for sub_index, sub in enumerate(record['commands']):
        location = {'command': ordinal, 'kind': kind, 'subCommand': sub_index, 'operation': sub['kind'], 'pipeline': pipeline}
        if sub['kind'] == 'pipeline': pipeline = sub['id'];p.set_pipeline(objects[pipeline])
        elif sub['kind'] == 'group': p.set_bind_group(sub['index'],objects[sub['id']])
        elif sub['kind'] == 'dispatch': p.dispatch_workgroups(*sub['work'])
        elif sub['kind'] == 'indirect': p.dispatch_workgroups_indirect(objects[sub['buffer']],sub['offset'])
        elif sub['kind'] == 'draw': p.draw(*sub['work'])
        elif sub['kind'] == 'vertexBuffer': p.set_vertex_buffer(sub['index'],objects[sub['buffer']],sub['offset'])
        elif sub['kind'] == 'indexBuffer': p.set_index_buffer(objects[sub['buffer']],sub['format'],sub['offset'])
        elif sub['kind'] == 'drawIndexed': p.draw_indexed(*sub['work'])
        else: raise RuntimeError('Unsupported recorded pass operation: ' + sub['kind'])
    p.end()

def read_image(texture_id, name):
    desc = descriptions[texture_id]['desc'];width,height,depth=size3(desc['size'])
    if desc['format'] not in ('rgba8unorm','bgra8unorm'): raise RuntimeError('Unsupported snapshot format: '+desc['format'])
    raw = queue.read_texture({'texture':objects[texture_id]}, {'bytes_per_row':width*4,'rows_per_image':height},(width,height,depth))
    pixels=np.frombuffer(raw,np.uint8).reshape(depth,height,width,4)[0].copy()
    if desc['format']=='bgra8unorm': pixels=pixels[:,:,[2,1,0,3]]
    target=folder/(name+'.png');Image.fromarray(pixels,'RGBA').save(target)
    return {'path':str(target),'width':width,'height':height,'sha256':hashlib.sha256(raw).hexdigest(),
        'nonzeroRGB':int(np.count_nonzero(pixels[:,:,:3])),'meanRGB':pixels[:,:,:3].mean(axis=(0,1)).tolist()}

def read_chemistry(frame):
    pool=frame.get('pool');state=None;stale=0
    if pool:
        state=np.frombuffer(queue.read_buffer(objects[pool['metadata']]),np.uint32).copy()
    if not pool or state[0]==1:
        raw=queue.read_texture({'texture':objects[frame['dense']]},{'bytes_per_row':256*8,'rows_per_image':256},(256,256,256))
        values=np.frombuffer(raw,np.float16).reshape(256,256,256,4).copy()
    else:
        plan=pool['plan'];brick=plan['brick'];tx,ty,tz=plan['tiles'];ax,ay,az=plan['atlasSize'];axis=plan['pagesAxis'];offset=plan['offsets']
        pages=np.frombuffer(queue.read_buffer(objects[pool['pages']]),np.uint32).reshape(-1,2)
        raw=queue.read_texture({'texture':objects[pool['atlas']]},{'bytes_per_row':ax*8,'rows_per_image':ay},(ax,ay,az))
        atlas=np.frombuffer(raw,np.float16).reshape(az,ay,ax,4)
        values=np.zeros((256,256,256,4),np.float16)
        for logical,(mapped,generation) in enumerate(pages):
            if mapped==0: continue
            slot=int(mapped)-1
            if slot>=plan['capacity'] or generation!=state[offset['generation']+slot] or state[offset['owner']+slot]!=logical+1:
                stale+=1;continue
            px,py,pz=logical%axis,(logical//axis)%axis,logical//(axis*axis)
            sx,sy,sz=slot%tx,(slot//tx)%ty,slot//(tx*ty)
            values[pz*brick:(pz+1)*brick,py*brick:(py+1)*brick,px*brick:(px+1)*brick]=atlas[sz*brick:(sz+1)*brick,sy*brick:(sy+1)*brick,sx*brick:(sx+1)*brick]
    flat=values.reshape(-1,4);finite=np.isfinite(flat);result={'mode':'sparse' if pool and state[0]==0 else 'dense','staleMappings':stale,
        'sha256':hashlib.sha256(values).hexdigest(),'nonFinite':int(np.count_nonzero(~finite)),
        'nonzeroByChannel':np.count_nonzero(flat,axis=0).tolist(),'sumByChannel':flat.sum(axis=0,dtype=np.float64).tolist(),
        'maxByChannel':flat.max(axis=0).astype(float).tolist(),'minByChannel':flat.min(axis=0).astype(float).tolist()}
    result['maxVoxelZYXByChannel']=[list(map(int,np.unravel_index(int(i),values.shape[:3]))) for i in flat.argmax(axis=0)]
    # Spatial diagnostics use the actual gas field, not post-tonemap pixels.
    # Process one slab at a time to keep QA memory bounded on long recordings.
    variation=np.zeros(3,np.float64);curvature=np.zeros(3,np.float64)
    parity=np.zeros(8,np.float64);mass=float(result['sumByChannel'][0])
    for z in range(values.shape[0]):
        slab=values[z,...,0].astype(np.float32)
        variation[2]+=np.abs(np.diff(slab,axis=1)).sum(dtype=np.float64)
        variation[1]+=np.abs(np.diff(slab,axis=0)).sum(dtype=np.float64)
        curvature[2]+=np.abs(np.diff(slab,n=2,axis=1)).sum(dtype=np.float64)
        curvature[1]+=np.abs(np.diff(slab,n=2,axis=0)).sum(dtype=np.float64)
        if z>0:variation[0]+=np.abs(slab-values[z-1,...,0].astype(np.float32)).sum(dtype=np.float64)
        if z>1:curvature[0]+=np.abs(slab-2*values[z-1,...,0].astype(np.float32)+values[z-2,...,0].astype(np.float32)).sum(dtype=np.float64)
        for y in range(2):
            for x in range(2):parity[(z%2)*4+y*2+x]+=slab[y::2,x::2].sum(dtype=np.float64)
    result['sootSpatial']={'variationZYX':variation.tolist(),'curvatureZYX':curvature.tolist(),
        'variationPerMass':float(variation.sum()/max(mass,1e-12)),
        'curvaturePerMass':float(curvature.sum()/max(mass,1e-12)),
        'parityMass':parity.tolist(),'parityImbalance':float((parity.max()-parity.min())/max(mass/8,1e-12))}
    if pool: result['poolStatus']={name:int(state[i]) for i,name in enumerate(['mode','requested','resident','allocated','free','overflow','epoch','migration'])}
    if args.save_fields and frame.get('saveField', True):
        target=folder/('chemistry-'+str(frame['index'])+'.npy');np.save(target,values);result['path']=str(target)
    return result

def read_floor(texture_id, frame):
    desc=descriptions[texture_id]['desc'];width,height,depth=size3(desc['size'])
    dtype=np.float32 if desc['format']=='rgba32float' else np.float16
    raw=queue.read_texture({'texture':objects[texture_id]}, {'bytes_per_row':width*4*np.dtype(dtype).itemsize,'rows_per_image':height},(width,height,depth))
    values=np.frombuffer(raw,dtype).reshape(height,width,4).copy()
    result={'sha256':hashlib.sha256(raw).hexdigest(),'sumByChannel':values.sum(axis=(0,1),dtype=np.float64).tolist(),
            'maxByChannel':values.max(axis=(0,1)).astype(float).tolist(),'nonFinite':int(np.count_nonzero(~np.isfinite(values)))}
    if result['nonFinite'] or np.any(values[:,:,[0,2,3]]<0) or np.min(values[:,:,1])<(293.15-300)/1200-1e-6 or np.max(values[:,:,0])>4.01:
        raise RuntimeError('Invalid floor fuel state at frame '+str(frame['index']))
    if data.get('options',{}).get('unlit') and not data.get('options',{}).get('igniteFuel') and (values[:,:,1].max()>1e-6 or values[:,:,2].max()>1e-5):
        raise RuntimeError('Cold deposits ignited without a heat source')
    if args.save_fields:
        target=folder/('floor-'+str(frame['index'])+'.npy');np.save(target,values);result['path']=str(target)
    return result

def failure_evidence(frame):
    """First unsafe state only, without advancing or saving full field dumps."""
    result={'index':frame['index'],'time':frame['time'],'substeps':frame.get('substeps')}
    if frame.get('output'): result['image']=read_image(frame['output'],'unsafe-frame-'+str(frame['index']))
    if frame.get('wood'):
        wood=frame['wood']
        def material(name):
            raw=queue.read_texture({'texture':objects[wood[name]]},{'bytes_per_row':64*16,'rows_per_image':64},[64,64,64])
            return np.frombuffer(raw,np.float32).reshape(64,64,64,4).copy()
        stock=material('stock');wear=material('wear');metadata=material('mass');mass=metadata[...,3]*wood['scale']**3
        poses=np.frombuffer(queue.read_buffer(objects[wood['poses']]),np.float32).reshape(-1,16)
        fractures=np.frombuffer(queue.read_buffer(objects[wood['fractures']]),np.uint32)
        flux=np.frombuffer(queue.read_buffer(objects[wood['flux']],wood['fluxStatsOffset'],64),np.uint32)
        result['wood']={'initialDryKg':float(mass.sum()),'virginKg':float((stock[...,0]*mass).sum()),'charKg':float((stock[...,3]*mass).sum()),
            'releaseKgSec':float((stock[...,2]*mass).sum()),'maxHeatK':float(293.15+500*stock[...,1].max()),'maxCrack':float(wear[...,2].max()),
            'brokenBonds':int(fractures[0]),'detachedNodes':int((poses[:,3]>=0).sum()),
            'nonFinite':int(np.count_nonzero(~np.isfinite(stock))+np.count_nonzero(~np.isfinite(wear))+np.count_nonzero(~np.isfinite(poses))),
            'blockedKg':float((int(flux[0])+2**32*int(flux[1]))/1e8),'escapedKg':float((int(flux[8])+2**32*int(flux[9]))/1e8)}
        result['wood']['temperaturePeaks']=material_peaks(stock,metadata,wood['scale'],wood.get('origin'))
        result['wood']['blockedEnergyJ']=float((int(flux[2])+2**32*int(flux[3]))/256)
        result['wood']['escapedEnergyJ']=float((int(flux[10])+2**32*int(flux[11]))/256)
        result['woodFlux']=flux_summary(queue.read_buffer(objects[wood['flux']],0,wood['fluxStatsOffset']),wood.get('fluxLayout'))
        if wood.get('residual'):
            residual=np.frombuffer(queue.read_buffer(objects[wood['residual']]),np.float32).reshape(-1,2)
            result['woodFlux']['remainder']={'sumMassKgEnergyJ':residual.sum(axis=0,dtype=np.float64).tolist(),
                'minMassKgEnergyJ':residual.min(axis=0).tolist(),'maxMassKgEnergyJ':residual.max(axis=0).tolist(),
                'nonFinite':int(np.count_nonzero(~np.isfinite(residual)))}
    if frame.get('dense'): result['chemistry']=read_chemistry({**frame,'saveField':False})
    if frame.get('floorFuel'): result['floorFuel']=read_floor(frame['floorFuel'],frame)
    if frame.get('velocity'):
        result['velocitySlots']=[]
        for index,texture_id in enumerate(frame['velocity']):
            desc=descriptions[texture_id]['desc'];width,height,depth=size3(desc['size'])
            dtype=np.float32 if desc['format']=='rgba32float' else np.float16
            raw=queue.read_texture({'texture':objects[texture_id]},{'bytes_per_row':width*4*np.dtype(dtype).itemsize,'rows_per_image':height},(width,height,depth))
            values=np.frombuffer(raw,dtype).reshape(depth,height,width,4).astype(np.float32)
            speed=np.linalg.norm(values[...,:3],axis=-1)
            flat_index=int(np.nanargmax(speed)) if np.any(np.isfinite(speed)) else 0
            result['velocitySlots'].append({'index':index,'active':index==frame.get('velocityIndex'),
                'maxSpeed':float(np.nanmax(speed)),'maxSpeedVoxelZYX':list(map(int,np.unravel_index(flat_index,speed.shape))),
                'nonFinite':int(np.count_nonzero(~np.isfinite(values))),'minByChannel':np.nanmin(values,axis=(0,1,2)).tolist(),
                'maxByChannel':np.nanmax(values,axis=(0,1,2)).tolist()})
    (folder/('unsafe-state-'+str(frame['index'])+'.json')).write_text(json.dumps(result,indent=2))
    return result

def execute_operation(operation_index, operation):
    global location, pass_profile, last_frame_operation
    location={'operation':operation_index,'kind':operation['kind']}
    kind=operation['kind']
    if kind=='writeBuffer': queue.write_buffer(objects[operation['buffer']],operation['offset'],(source.parent/operation['file']).read_bytes())
    elif kind=='writeTexture': queue.write_texture(resolve(operation['target']),(source.parent/operation['file']).read_bytes(),resolve(operation['layout']),operation['size'])
    elif kind=='writeImage':
        image=Image.open(source.parent/operation['file']).convert('RGBA')
        if operation.get('flipY'): image=image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        queue.write_texture(resolve(operation['target']),image.tobytes(),{'bytes_per_row':image.width*4,'rows_per_image':image.height},operation['size'])
    elif kind=='submit':
        started=time.perf_counter();encoder=dev.create_command_encoder()
        pass_profile=[]
        if args.profile:
            p=encoder.begin_compute_pass(timestamp_writes={'query_set':query,'beginning_of_pass_write_index':0});p.end()
        for command_index, record in enumerate(operation['commands']): command(encoder,record,command_index)
        if args.profile:
            p=encoder.begin_compute_pass(timestamp_writes={'query_set':query,'beginning_of_pass_write_index':1});p.end();encoder.resolve_query_set(query,0,2+2*len(pass_profile),resolved,0)
        queue.submit([encoder.finish()]);timing={'operation':operation_index,'commands':len(operation['commands'])}
        if args.profile:
            ticks=np.frombuffer(queue.read_buffer(resolved),np.uint64);timing['gpuMs']=float(ticks[1]-ticks[0])*period/1e6
            if args.profile_passes:
                timing['passes']=[{**entry,'gpuMs':float(ticks[3+2*i]-ticks[2+2*i])*period/1e6} for i,entry in enumerate(pass_profile)]
            timing['completedWallMs']=(time.perf_counter()-started)*1000
        report['submissions'].append(timing)
        pending_submissions.append(timing)
    elif kind=='frame':
        last_frame_operation=operation
        result={'index':operation['index'],'time':operation['time'], 'submissionCount':len(pending_submissions)}
        if args.profile:
            result['gpuMs']=sum(s['gpuMs'] for s in pending_submissions)
            result['completedWallMs']=sum(s['completedWallMs'] for s in pending_submissions)
        pending_submissions.clear()
        if operation.get('fluxDiagnostics'):
            counts=np.frombuffer(queue.read_buffer(objects[operation['fluxDiagnostics']]),np.uint32).copy()
            result['fluxDiagnostics']={'cflViolations':int(counts[0]),'negativeConcentrations':int(counts[1])}
            if np.any(counts[:2]):raise RuntimeError('Unsafe conservative transport: '+str(result['fluxDiagnostics']))
        if 'stats' in operation:
            stats=np.frombuffer(queue.read_buffer(objects[operation['stats']]),np.float32).copy()
            substeps=operation['substeps'];step_dt=operation['dt']/max(1,substeps)
            result['stats']={'maxSpeed':float(stats[0]),'preDivergenceMean':float(stats[1]/max(1,stats[3])),
                'postDivergenceMean':float(stats[2]/max(1,stats[3])),'cellCount':float(stats[3]),'substeps':substeps,'stepDt':step_dt,
                'measuredCFL':float(stats[0])*step_dt/(6/128),'cflLimit':1.5,'withinMeasuredCFL':bool(stats[0]*step_dt<=1.5*6/128)}
            unsafe=not np.all(np.isfinite(stats)) or not result['stats']['withinMeasuredCFL']
            if unsafe and 'firstUnsafeFrame' not in report:
                report['firstUnsafeFrame']={**result,'evidence':failure_evidence(operation)}
            if not args.stream and unsafe:
                result['failureEvidence']=report['firstUnsafeFrame']['evidence']
                report['frames'].append(result)
                raise RuntimeError('Recorded telemetry fixture is unsafe at frame '+str(operation['index'])+
                    ': measured CFL='+str(result['stats']['measuredCFL'])+'. No performance acceptance is valid beyond this point.')
        if operation.get('snapshot'):
            result['image']=read_image(operation['output'],'frame-'+str(operation['index']))
            if operation.get('wood') and (not args.stream or args.save_fields or args.field_summaries):
                wood=operation['wood']
                def material(name):
                    raw=queue.read_texture({'texture':objects[wood[name]]},{'bytes_per_row':64*16,'rows_per_image':64},[64,64,64])
                    return np.frombuffer(raw,np.float32).reshape(64,64,64,4).copy()
                stock=material('stock');wear=material('wear');metadata=material('mass');mass=metadata[...,3]*wood['scale']**3
                poses=np.frombuffer(queue.read_buffer(objects[wood['poses']]),np.float32).reshape(-1,16)
                fractures=np.frombuffer(queue.read_buffer(objects[wood['fractures']]),np.uint32)
                flux_stats=np.frombuffer(queue.read_buffer(objects[wood['flux']],wood['fluxStatsOffset'],64),np.uint32)
                nonfinite=int(np.count_nonzero(~np.isfinite(stock))+np.count_nonzero(~np.isfinite(wear))+np.count_nonzero(~np.isfinite(poses)))
                result['wood']={'initialDryKg':float(mass.sum()),'virginKg':float((stock[...,0]*mass).sum()),'charKg':float((stock[...,3]*mass).sum()),
                    'releaseKgSec':float((stock[...,2]*mass).sum()),'maxHeatK':float(293.15+500*stock[...,1].max()),
                    'maxCrack':float(wear[...,2].max()),'brokenBonds':int(fractures[0]),'detachedNodes':int((poses[:,3]>=0).sum()),
                    'nonFinite':nonfinite,'blockedKg':float((int(flux_stats[0])+2**32*int(flux_stats[1]))/1e8),
                    'escapedKg':float((int(flux_stats[8])+2**32*int(flux_stats[9]))/1e8)}
                if args.field_summaries:result['wood']['temperaturePeaks']=material_peaks(stock,metadata,wood['scale'],wood.get('origin'))
                if operation.get('saveField') and (not args.field_summaries or args.save_fields):np.savez_compressed(folder/('wood-'+str(operation['index'])+'.npz'),stock=stock,wear=wear,mass=mass,poses=poses)
                if nonfinite:raise RuntimeError('Nonfinite wood material or rigid pose')
            if operation.get('floorFuel'):result['floorFuel']=read_floor(operation['floorFuel'],operation)
            if 'dense' in operation and (operation.get('saveField', True) or args.field_summaries) and (not args.stream or args.save_fields or args.field_summaries):
                result['chemistry']=read_chemistry(operation)
                if result['chemistry']['nonFinite'] or result['chemistry']['staleMappings']:
                    report['frames'].append(result)
                    raise RuntimeError('Non-finite chemistry or stale page ownership at frame '+str(operation['index']))
        if operation.get('pool'):
            state=np.frombuffer(queue.read_buffer(objects[operation['pool']['metadata']]),np.uint32)
            result['poolStatus']=state[:8].tolist()
        report['frames'].append(result)
        (folder/'progress.json').write_text(json.dumps({'frames':len(report['frames']),'last':result},indent=2))
    else: raise RuntimeError('Unsupported recorded operation: '+kind)

try:
    started=time.perf_counter()
    for resource in data['resources']:
        (folder/'initialization-progress.json').write_text(json.dumps({'stage':'resource','resource':resource['id'],'kind':resource['kind'],'label':resource['desc'].get('label')}))
        objects[resource['id']]=create(resource)
    report['compileAndResourcesSeconds']=time.perf_counter()-started
    if args.profile:
        from wgpu.backends.wgpu_native._api import libf
        period=float(libf.wgpuQueueGetTimestampPeriod(queue._internal));report['timestampPeriodNs']=period
        max_passes=max((sum(c['kind'] in ('compute','render') for c in op.get('commands',[])) for op in data['operations']),default=0)
        query_count=2+2*max_passes if args.profile_passes else 2
        query=dev.create_query_set(type='timestamp',count=query_count)
        resolved=dev.create_buffer(size=query_count*8,usage=wgpu.BufferUsage.QUERY_RESOLVE|wgpu.BufferUsage.COPY_SRC)
    if args.stream:
        def control(message):
            print(json.dumps(message, allow_nan=False), flush=True)
        def within_recording(value):
            target=(source.parent/value).resolve()
            if not target.is_relative_to(source.parent.resolve()):
                raise RuntimeError('Stream payload escaped the recording directory')
            return target
        operation_count=0
        control({'kind':'ready','adapter':dict(adapter.info),'resourceCount':len(objects)})
        for line in sys.stdin:
            if len(line)>20000: raise RuntimeError('Oversized stream control message')
            message=json.loads(line)
            if message.get('kind')=='finish':
                host_error=message.get('hostError')
                report['productionHostPass']=not bool(host_error)
                report['numericalPass']='firstUnsafeFrame' not in report
                report['pass']=report['productionHostPass'] and report['numericalPass']
                if host_error: report['error']={'location':{'productionHost':True},'type':'ProductionRuntimeGuard','message':str(host_error)[:12000]}
                elif not report['numericalPass']:
                    report['error']={'location':{'frame':report['firstUnsafeFrame']['index']},'type':'NumericalAcceptance',
                        'message':'Measured CFL exceeded 1.5. Production continued until the requested end without substituting telemetry.'}
                if host_error and last_frame_operation and 'firstUnsafeFrame' not in report:
                    report['guardState']=failure_evidence(last_frame_operation)
                control({'kind':'finished','path':str(folder/'report.json'),'pass':report['pass'],'productionHostPass':report['productionHostPass'],
                    'numericalPass':report['numericalPass'],'frames':len(report['frames'])})
                break
            if message.get('kind')!='batch': raise RuntimeError('Unsupported stream control message')
            batch=json.loads(within_recording(message['file']).read_text())
            for resource in batch.get('resources',[]):
                if resource['id'] in objects: raise RuntimeError('Duplicate stream resource')
                descriptions[resource['id']]=resource;objects[resource['id']]=create(resource)
            for operation in batch.get('operations',[]):
                execute_operation(operation_count,operation);operation_count+=1
            readbacks=[]
            for request in batch.get('readbacks',[]):
                buffer=objects[request['buffer']]
                # MAP_READ buffers retain their exact production usage. Adding
                # COPY_SRC here would violate the WebGPU MAP_READ combination.
                buffer.map_sync(wgpu.MapMode.READ,request['offset'],request['size'])
                try: raw=bytes(buffer.read_mapped(request['offset'],request['size']))
                finally: buffer.unmap()
                if len(raw)!=request['size']: raise RuntimeError('Native mapped range size mismatch')
                target=folder/('readback-'+str(request['request'])+'.bin');target.write_bytes(raw)
                entry={**request,'file':str(target.relative_to(source.parent)),'sha256':hashlib.sha256(raw).hexdigest()}
                readbacks.append(entry);report['feedback']['readbacks'].append(entry)
            report['resourceCount']=len(objects)
            control({'kind':'batch','readbacks':readbacks,'frames':len(report['frames'])})
        else:
            raise RuntimeError('Native stream ended without a final production-host result')
    else:
        for operation_index, operation in enumerate(data['operations']):
            execute_operation(operation_index,operation)
        report['pass']=True
except Exception as error:
    report['error']={'location':location,'type':type(error).__name__,'message':str(error)[:12000]}
    (folder/'error.log').write_text(traceback.format_exc(),encoding='utf-8')
    if args.stream: print(json.dumps({'kind':'error','error':report['error'],'path':str(folder/'report.json')}),flush=True)
finally:
    (folder/'report.json').write_text(json.dumps(report,indent=2));dev.destroy()
if not args.stream:
    print(json.dumps({'path':str(folder/'report.json'),'pass':report['pass'],'frames':len(report['frames']),
        'error':report.get('error'),'imageCount':sum('image' in f for f in report['frames'])}))
if not report['pass']: sys.exit(1)
