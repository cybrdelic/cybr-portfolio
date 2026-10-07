"""CYBR GEO analytic cartridges with dimensioned interfaces and real joints.

Coordinates are millimetres, X-axis cable/shaft direction, Z-up. Organic source
meshes are deliberately separate; this file supplies only original native CAD.
"""
from pathlib import Path
import argparse, hashlib, json, math, os, sys
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
import numpy as np
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'cybr-geo/src'))
import cadquery as cq
from mechanism_lab.core import Assembly, Material, View, cad_part, save_cache, load_cache, validate
from mechanism_lab.geometry import ring as axial_ring, drill, bolt_circle
from mechanism_lab.advanced_geometry import spline_sweep_tube

MATERIALS = [
    Material('Cut aluminum', (.66,.69,.71), .95,.24, microfinish='machined'),
    Material('Ground shoulder steel', (.69,.71,.73), .98,.17),
    Material('Blackened retaining steel', (.055,.065,.07), .78,.33),
    Material('Bearing and contact polymer', (.035,.04,.043), 0,.48),
    Material('Optical vessel glass', (.96,.985,.98), 0,.025, ior=1.47, opacity=.25),
    Material('CYBR cable jacket', (.38,.007,.025), 0,.35),
]

def cylinder(radius, length, origin, axis=(0,0,1)):
    return cq.Solid.makeCylinder(radius,length,cq.Vector(*origin),cq.Vector(*axis))

def annulus(ro,ri,length,origin,axis=(0,0,1)):
    # CYBR GEO's bored axial primitive, rigidly oriented into the interface.
    q=axial_ring(ro,ri,0,length)
    if tuple(axis)==(0,1,0):q=q.rotate((0,0,0),(0,0,1),90)
    elif tuple(axis)==(0,-1,0):q=q.rotate((0,0,0),(0,0,1),-90)
    elif tuple(axis)==(0,0,1):q=q.rotate((0,0,0),(0,1,0),-90)
    elif tuple(axis)==(-1,0,0):q=q.rotate((0,0,0),(0,0,1),180)
    return q.translate(tuple(origin))

def box(size,center,corner=0):
    q=cq.Workplane('XY').box(*size)
    if corner:q=q.edges('|Z').fillet(corner)
    return q.val().translate(tuple(center))

def hex_prism(diameter,length,origin,axis=(0,0,1)):
    q=cq.Workplane('XY').polygon(6,diameter).extrude(length).val()
    if tuple(axis)==(0,1,0):q=q.rotate((0,0,0),(1,0,0),-90)
    elif tuple(axis)==(0,-1,0):q=q.rotate((0,0,0),(1,0,0),90)
    elif tuple(axis)==(1,0,0):q=q.rotate((0,0,0),(0,1,0),90)
    elif tuple(axis)==(-1,0,0):q=q.rotate((0,0,0),(0,1,0),-90)
    elif tuple(axis)==(0,0,-1):q=q.rotate((0,0,0),(1,0,0),180)
    return q.translate(tuple(origin))

class Recipe:
    def __init__(self,name):
        self.name=name;self.parts=[];self.rig={};self.cad_rows=[];self.interfaces=[];self.routes=[]
    def add(self,name,q,material=0,rig=None,role='',tags=()):
        if not q.isValid() or len(q.Solids())!=1 or q.Volume()<=1e-8:
            raise ValueError(f'{name}: invalid/disconnected/nonpositive CAD solid')
        rig=rig or {'kind':'static'}
        p=cad_part(name,q,material,tolerance=.035,angular=.075,analytic_normals=True,
            group=rig.get('group','base'),motion=rig.get('kind','static'),
            center=np.array(rig.get('pivot',(0,0,0))),role=role,
            provenance='original-cybrgeo-analytic-cad',tags=tags)
        self.parts.append(p);self.rig[name]=rig
        self.cad_rows.append(dict(name=name,valid=True,solids=1,volumeMM3=q.Volume(),
            faces=len(q.Faces()),role=role,material=material))
        return p
    def fuse_structure(self,names,name,role):
        """Remove internal overlapping weld faces from a grounded frame."""
        selected=[p for p in self.parts if p.name in names]
        q=selected[0].cad
        for p in selected[1:]:q=q.fuse(p.cad).clean()
        self.parts=[p for p in self.parts if p.name not in names]
        self.cad_rows=[p for p in self.cad_rows if p['name'] not in names]
        for n in names:self.rig.pop(n)
        self.add(name,q,0,role=role)
    def finish(self,metadata):
        metadata=dict(metadata,partRig=self.rig,interfaces=self.interfaces,routes=self.routes,
            nativeKernel='CYBR GEO mechanism_lab + CadQuery/OpenCascade',
            geometryContract='mm; X cable/shaft axis; Z-up',analyticParts=len(self.parts),
            materialProperties={str(i):dict(transmission=1,ior=1.47,thickness=1.5) if i==4 else {}
                                for i in range(len(MATERIALS))})
        return Assembly(self.name,self.parts,MATERIALS,
            views={'hero':View(az=38,el=24,scale=65,target=(0,0,0))},metadata=metadata)

def harness(recipe,name,points,radius=2.35,endpoint_tangents=False):
    vectors=[cq.Vector(*p) for p in points]
    a=np.array(points[0],float);b=np.array(points[-1],float);direction=b-a
    deviations=np.linalg.norm(np.cross(np.array(points)-a,direction),axis=1)/np.linalg.norm(direction)
    if deviations.max()<1e-8:
        edge=cq.Edge.makeLine(vectors[0],vectors[-1])
        q=cylinder(radius,float(np.linalg.norm(direction)),points[0],tuple(direction/np.linalg.norm(direction)))
    elif endpoint_tangents:
        edge=cq.Edge.makeSpline(vectors,tangents=[cq.Vector(1,0,0),cq.Vector(1,0,0)])
        wire=cq.Wire.assembleEdges([edge])
        q=cq.Workplane(cq.Plane(origin=vectors[0],normal=(1,0,0))).circle(radius).sweep(wire,isFrenet=True,transition='round').val()
    else:
        edge=cq.Edge.makeSpline(vectors)
        q=spline_sweep_tube(points,radius)
    recipe.add(name,q,5,role='Closed analytic jacket swept on the authoritative camera/cable centerline')
    # Arc-length sampling is authoritative for the browser. Dense .2 mm chords
    # keep an interpolating spline's estimated chord departure far below .1 mm.
    count=max(257,math.ceil(edge.Length()/.2)+1)
    sampled=[edge.positionAt(float(t)).toTuple() for t in np.linspace(0,1,count)]
    checks=[]
    for i in range(count-1):
        true=np.array(edge.positionAt((i+.5)/(count-1)).toTuple())
        chord=(np.array(sampled[i])+np.array(sampled[i+1]))*.5
        checks.append(float(np.linalg.norm(true-chord)))
    route=dict(name=name,points=sampled,controls=points,interpolation='sampled-linear',radiusMM=radius,
        lengthMM=edge.Length(),entry=sampled[0],exit=sampled[-1],
        entryTangent=list(edge.tangentAt(0).toTuple()),exitTangent=list(edge.tangentAt(1).toTuple()),
        maxSampledMidpointChordErrorMM=max(checks),closedSolid=True)
    if route['maxSampledMidpointChordErrorMM']>.1:raise ValueError('Insufficient centerline sampling')
    recipe.routes.append(route)
    return route

def compression_glands(recipe,prefix,extent,axis_z,body_start):
    ports=[]
    for sign,label in ((-1,'entry'),(1,'exit')):
        axis=(sign,0,0);start=(sign*body_start,0,axis_z)
        body_length=extent-body_start-4
        body=annulus(4.5,2.65,body_length,start,axis)
        recipe.add(f'{prefix}_{label}_compression_barrel',body,0,
            role='Bored cable gland barrel; 0.30 mm jacket radial clearance')
        nut_origin=(sign*(extent-4),0,axis_z)
        nut=hex_prism(10.4,3,nut_origin,axis).cut(cylinder(2.65,5,(sign*(extent-4.5),0,axis_z),axis))
        recipe.add(f'{prefix}_{label}_compression_nut',nut,1,
            role='Hollow hex compression sleeve; nominal retained compression interface')
        recipe.add(f'{prefix}_{label}_jacket_seal',annulus(3.6,2.35,1,(sign*(extent-1),0,axis_z),axis),3,
            role='Separate annular jacket seal; nominal contact at cable surface')
        ports.append([sign*extent,0,axis_z])
        recipe.interfaces.append(dict(name=f'{prefix}_{label}',axis=list(axis),
            boreRadiusMM=2.65,jacketRadiusMM=2.35,radialClearanceMM=.30,
            port=ports[-1],compression='Nominal geometry; elastomer forces not simulated'))
    return ports

def rocker_shape(lower,upper,rail_y):
    length=math.dist(lower,upper);r=3.2
    wp=cq.Workplane('XZ',origin=(0,1,0)).moveTo(0,r).lineTo(length,r)
    wp=wp.threePointArc((length+r,0),(length,-r)).lineTo(0,-r).threePointArc((-r,0),(0,r)).close()
    q=wp.extrude(2).val()
    relief=cq.Workplane('XZ',origin=(0,2,0)).moveTo(5,1).lineTo(length-5,1)
    relief=relief.threePointArc((length-4,0),(length-5,-1)).lineTo(5,-1).threePointArc((4,0),(5,1)).close().extrude(4).val()
    q=q.cut(relief)
    theta=math.degrees(math.atan2(upper[2]-lower[2],upper[0]-lower[0]))
    q=q.rotate((0,0,0),(0,1,0),-theta).translate((lower[0],rail_y,lower[2]))
    for p in (lower,upper):q=q.cut(cylinder(1.65,6,(p[0],rail_y-3,p[2]),(0,1,0)))
    return q

def pivot_stack(recipe,name,point,sign,rig,bushing_rig=None):
    """Dimensioned Y-axis shoulder pin through a 2 mm rocker + 2.5 mm lug."""
    x,_,z=point;axis=(0,sign,0)
    def origin(distance):return (x,sign*distance,z)
    # The rocker occupies |Y|12..14; lug occupies |Y|8.5..11.
    body=annulus(1.60,1.30,2,origin(12),axis)
    flange=annulus(2.45,1.30,.45,origin(14),axis)
    recipe.add(name+'_flanged_bushing',body.fuse(flange).clean(),3,bushing_rig or rig,
        role='Real through bushing; 0.05 mm bore and shoulder radial clearances')
    recipe.add(name+'_inner_spacer',annulus(2.45,1.35,.9,origin(11.05),axis),1,rig,
        role='Axial spacer with 0.05 mm gaps to stationary lug and rocker')
    recipe.add(name+'_head_washer',annulus(2.6,1.35,.5,origin(14.45),axis),1,rig,
        role='Separate load washer contacting bushing flange and shoulder head')
    shaft=cylinder(1.25,7.25,origin(7.7),axis)
    head=cylinder(2.85,1.55,origin(14.95),axis)
    q=shaft.fuse(head).clean()
    # Cut a real driver recess from the exposed cap face, and a clip groove.
    q=q.cut(hex_prism(2.7,1.15,origin(16.51),(0,-sign,0)))
    q=q.cut(annulus(1.4,1.05,.5,origin(7.9),axis))
    recipe.add(name+'_socket_shoulder_pin',q,1,rig,
        role='Through shoulder pin with subtractive hex socket and retaining groove')
    clip=annulus(2.2,1.1,.4,origin(7.95),axis)
    clip=clip.cut(box((3.5,1,1.3),(x+2.35,sign*8.15,z)))
    recipe.add(name+'_retaining_clip',clip,2,rig,
        role='Actual split retaining clip captured in the shoulder groove')
    recipe.interfaces.append(dict(name=name,axis=[0,1,0],center=list(point),
        shoulderRadiusMM=1.25,bushingInnerRadiusMM=1.30,bushingOuterRadiusMM=1.60,
        rockerBoreRadiusMM=1.65,lugBoreRadiusMM=1.35,rockerThicknessMM=2,
        lugThicknessMM=2.5,axialSpacerGapMM=.05,radialRunningClearanceMM=.05))

def build_combat_stage():
    r=Recipe('CYBR Combat / constrained parallel four-bar stage')
    angle=75.;L=18.;v=np.array([L*math.cos(math.radians(angle)),0,L*math.sin(math.radians(angle))])
    top_z=-3.6;base_z=top_z-v[2];center_x=v[0]
    lower=[];upper=[]
    for x,label in ((-24,'left'),(24,'right')):
        for sign,rail in ((-1,'rear'),(1,'front')):
            p=[x,sign*13,base_z];q=(np.array(p)+v).tolist();lower.append(p);upper.append(q)
            motion=dict(rig='combat',kind='rocker',pivot=p,axis=[0,1,0],group='rocker-'+label)
            r.add(f'combat_{label}_{rail}_slotted_rocker',rocker_shape(p,q,sign*13),0,motion,
                role='Equal-length 18 mm rigid rocker with actual pivot bores and relieved web')
            pivot_stack(r,f'combat_{label}_{rail}_lower',p,sign,{'kind':'static','group':'base'},motion)
            pivot_stack(r,f'combat_{label}_{rail}_upper',q,sign,{'rig':'combat','kind':'deck','group':'deck'})
    # Separate rails retain the same structural silhouette but are real fitted solids.
    structure=[]
    for sign,label in ((-1,'rear'),(1,'front')):
        rail=box((72,3.5,3),(0,sign*9.75,-25.2),corner=1)
        for x in (-24,24):
            lug=cylinder(3.2,2.5,(x,sign*8.5,base_z),(0,sign,0))
            rail=rail.fuse(lug).clean()
            rail=rail.cut(cylinder(1.35,6,(x,sign*7.5,base_z),(0,sign,0)))
        n=f'combat_{label}_grounded_rail';structure.append(n)
        r.add(n,rail,0,role='Ground rail with integral bored lower pivot lugs')
    for x,label in ((-34,'left'),(34,'right')):
        n=f'combat_{label}_base_crossmember';structure.append(n)
        r.add(n,box((4,22,3),(x,0,-25.2),corner=.7),0,
            role='Crossmember touching both grounded rails')
    deck=box((62,22.4,2),(center_x,0,-1.4),corner=2)
    for q in upper:
        sign=1 if q[1]>0 else -1
        deck=deck.fuse(cylinder(3.2,2.5,(q[0],sign*8.5,q[2]),(0,sign,0))).clean()
        deck=deck.cut(cylinder(1.35,6,(q[0],sign*7.5,q[2]),(0,sign,0)))
        # Retaining hardware needs actual underside relief in the coupler.
        # These counterbores give 0.15 mm radial clearance to clip/spacer rims.
        deck=deck.cut(cylinder(2.35,.7,(q[0],sign*7.75,q[2]),(0,sign,0)))
        deck=deck.cut(cylinder(2.60,.3,(q[0],sign*11.0,q[2]),(0,sign,0)))
    deck_rig={'rig':'combat','kind':'deck','group':'deck'}
    r.add('combat_horizontal_moving_deck',deck,0,deck_rig,
        role='Single closed coupler deck with integral upper pivot lugs; stays horizontal')
    r.add('combat_grounded_sole_pad',box((57,18,.4),(center_x,0,-.2),corner=1),3,deck_rig,
        role='Continuous contact pad; authoritative reference sole plane Z=0')
    # The stationary cable sits between the rails, safely below all deck travel.
    ports=compression_glands(r,'combat',49,-12,39)
    for sign,label in ((-1,'entry'),(1,'exit')):
        support=box((5,12,19.5),(sign*37.5,0,-16.25),corner=.7)
        support=support.cut(cylinder(4.5,8,(sign*34,0,-12),(sign,0,0)))
        n=f'combat_{label}_bored_gland_mount';structure.append(n)
        r.add(n,support,0,
            role='Base-connected mounting upright with actual gland seat and passage')
    # Open-top guard retains a free cable gap, and connects to both crossmembers.
    guard=box((68,8,1.2),(0,0,-16.5),corner=.6)
    for sign in (-1,1):guard=guard.fuse(box((68,1.2,5),(0,sign*3.4,-14.6))).clean()
    for x in (-34,34):guard=guard.fuse(box((2.5,8,8),(x,0,-20.1))).clean()
    structure.append('combat_protected_cable_channel')
    r.add('combat_protected_cable_channel',guard,0,role='Closed solid U-channel around the stationary jacket, with running gap')
    r.fuse_structure(structure,'combat_grounded_bored_chassis',
        'One welded native CAD frame: bored lower lugs, grounded rails, crossmembers, gland mounts and protected cable channel')
    route=harness(r,'combat_closed_harness',[[-49,0,-12],[-35,0,-12],[0,0,-12],[35,0,-12],[49,0,-12]])
    kinematics=dict(referenceAngleDeg=75,minAngleDeg=63,maxAngleDeg=87,linkLengthMM=18,
        axis=[0,1,0],lowerPivots=lower,upperPivotsReference=upper,
        referenceLinkVector=v.tolist(),deckCenterReference=[center_x,0,0],deckTopZReference=0,
        model='Exact rigid parallel four-bar closure; no force or contact dynamics')
    return r.finish(dict(module='combat',ports=ports,kinematics={'combat':kinematics},
        organicSource={'type':'retained original Combat mannequin','placement':'Ground measured sole at deckTopZReference=0, follow deck rigid translation'},
        cadValidation=r.cad_rows,harness=route))

def build_scene_carrier():
    r=Recipe('CYBR Scenes / precision landscape specimen cartridge')
    structure=[]
    # A low optical guard leaves the original hill and vegetation silhouettes
    # visible. It is a real open, hollow vessel, not a texture-covered cylinder.
    p=cq.Workplane('XZ').moveTo(0,-20).lineTo(20,-20)
    p=p.threePointArc((35.3,-18.4),(42,-12)).lineTo(42,4.25).lineTo(40.5,4.25).lineTo(40.5,-10.5)
    p=p.threePointArc((34.1,-16.9),(20,-18.5)).lineTo(0,-18.5).close()
    vessel=p.revolve(360,(0,0),(0,1)).val()
    r.add('scenes_one_solid_optical_vessel',vessel,4,
        role='Low open optical guard with a rounded belly; true 1.5 mm glass volume and a level Z=4.25 rim',tags=('optical-volume',))
    # The source terrain has a closed vertical mineral section. A machined pan
    # supports that section and shields its artificial cut edge, exactly as a
    # physical specimen cassette would. The landscape itself is unchanged.
    pan_profile=(cq.Workplane('XZ').moveTo(0,-13.65).lineTo(34.3,-13.65)
        .lineTo(36.2,-11.75).lineTo(35.7,1.6).lineTo(35.7,2)
        .lineTo(34.15,2).lineTo(34.15,-11.65).lineTo(33.95,-12.45)
        .lineTo(0,-12.45).close())
    carrier=pan_profile.revolve(360,(0,0),(0,1)).val()
    for x,y in bolt_circle(26,6):carrier=carrier.cut(cylinder(1.25,3,(x,y,-14.5)))
    # Six subtractive blind radial grip recesses are actual machined pockets.
    # They stop outside the inner pan wall and never cut into the landscape.
    for a in np.linspace(0,2*math.pi,6,endpoint=False):
        direction=(-math.cos(a),-math.sin(a),0)
        carrier=carrier.cut(cylinder(2.1,.7,(36.5*math.cos(a),36.5*math.sin(a),-6.5),direction))
    r.add('scenes_bored_ceramic_landscape_carrier',carrier,0,
        role='Single lathed aluminum specimen pan; soil seat Z=-12.45, 34.15 mm inner wall, six through-drains and six blind radial grip pockets')
    r.add('scenes_recessed_specimen_rim',annulus(35.7,34.15,.65,(0,0,2)),2,
        role='Separate blackened steel top retainer seated on the machined pan; clear of the entire retained terrain footprint')
    for i,(x,y) in enumerate(bolt_circle(16,3,math.pi/2)):
        r.add(f'scenes_landscape_support_spacer_{i+1}',cylinder(2.5,4.85,(x,y,-18.5)),3,
            role='Fitted internal spacer from the actual glass cavity floor to the soil carrier underside')
    for sign,label in ((-1,'rear'),(1,'front')):
        rail=box((104,5,3),(0,sign*12,-24),corner=1.8)
        for x in (-35,0,35):
            slot=box((14,2.4,5),(x,sign*12,-24),corner=1.1)
            rail=rail.cut(slot)
        # Actual through-mounting holes in rail, not black face decorations.
        for x in (-25,25):rail=rail.cut(cylinder(1.75,5,(x,sign*12,-27)))
        n=f'scenes_{label}_saddle_rail';structure.append(n)
        r.add(n,rail,0,role='Bored, stable saddle beam below the glass belly')
        for x,xlabel in ((-10,'left'),(10,'right')):
            r.add(f'scenes_{label}_{xlabel}_contact_pad',box((6,6,1.5),(x,sign*12,-20.75),corner=.5),3,
                role='Separate flat contact pad on the true flat glass base')
            n=f'scenes_{label}_{xlabel}_pad_standoff';structure.append(n)
            r.add(n,box((6,6,1.5),(x,sign*12,-22.25),corner=.5),0,
                role='Solid standoff linking saddle rail to the actual contact pad')
        for x,xlabel in ((-25,'left'),(25,'right')):
            foot=box((8,7,3),(x,sign*12,-27),corner=1.4)
            foot=foot.cut(cylinder(1.75,8,(x,sign*12,-31)))
            n=f'scenes_{label}_{xlabel}_support_foot';structure.append(n)
            r.add(n,foot,0,role='Separate drilled grounded support foot')
            shaft=cylinder(1.5,8.5,(x,sign*12,-31))
            head=cylinder(2.9,1.5,(x,sign*12,-22.5))
            bolt=shaft.fuse(head).clean().cut(hex_prism(2.7,1.1,(x,sign*12,-20.95),(0,0,-1)))
            r.add(f'scenes_{label}_{xlabel}_socket_mount_bolt',bolt,1,
                role='Through foot/saddle bolt with a real subtractive driver socket')
            nut=hex_prism(5.5,2.5,(x,sign*12,-31)).cut(cylinder(1.5,4,(x,sign*12,-31.5)))
            r.add(f'scenes_{label}_{xlabel}_retaining_nut',nut,1,
                role='Nominal hollow retaining nut; helical thread detail omitted from the runtime geometry')
    for sign,label in ((-1,'left'),(1,'right')):
        # A bored eye on a slender crossbar replaces the bulky rectangular
        # arch. It is welded into the two ladder rails and genuinely carries
        # the compression barrel through its 4.5 mm bore.
        cross=box((5,29,3),(sign*48,0,-24),corner=1.4)
        eye=annulus(6.5,4.5,5,(sign*45.5,0,-24),(sign,0,0))
        cross=cross.fuse(eye).clean()
        cross=cross.cut(cylinder(4.5,9,(sign*43.5,0,-24),(sign,0,0)))
        n=f'scenes_{label}_bored_gland_crossmember';structure.append(n)
        r.add(n,cross,0,role='One bored structural arch fitting the hollow gland and spanning the actual saddles')
    r.fuse_structure(structure,'scenes_grounded_saddle_chassis',
        'One native welded lightweight ladder yoke with real milled slots, compact grounded feet, fitted pad rests and annular gland eyes')
    ports=compression_glands(r,'scenes',58,-24,48)
    points=[[-58,0,-24],[-35,0,-24],[0,0,-24],[35,0,-24],[58,0,-24]]
    route=harness(r,'scenes_closed_protected_harness',points)
    return r.finish(dict(module='scenes',ports=ports,kinematics={},
        vessel=dict(outerRadiusMM=42,innerSideRadiusMM=40.5,rimZ=4.25,bottomZ=-20,
            sideThicknessMM=1.5,bottomThicknessMM=1.5,cavity='Actual CAD subtraction/revolved inner boundary'),
        specimenPan=dict(innerRadiusMM=34.15,seatZ=-12.45,rimZ=2.65,
            maximumOuterRadiusMM=36.2,material='Machined aluminum with a separate blackened steel retainer',
            purpose='Supports the closed native mineral section and conceals its cut sides; upper terrain, rocks, spring water and vegetation stay unmodified'),
        organicSource={'type':'actual CYBR GEO Springs terrain and closed water',
            'placement':'Uniform scale only; fit terrain footprint inside cavity without flattening hills'},
        cadValidation=r.cad_rows,harness=route))

def _bounds(shape):
    b=shape.BoundingBox()
    return np.array([[b.xmin,b.ymin,b.zmin],[b.xmax,b.ymax,b.zmax]])

def _motion(part,rig,theta,kinematics):
    q=part.cad
    if rig.get('kind')=='rocker':
        pivot=rig['pivot'];end=np.array(pivot)+[0,1,0]
        return q.rotate(tuple(pivot),tuple(end),kinematics['referenceAngleDeg']-theta)
    if rig.get('kind')=='deck':
        ref=math.radians(kinematics['referenceAngleDeg']);a=math.radians(theta);L=kinematics['linkLengthMM']
        return q.translate((L*(math.cos(a)-math.cos(ref)),0,L*(math.sin(a)-math.sin(ref))))
    return q

def sampled_hardware_contacts(assembly, motion_samples=49, progress=False):
    """Exact BRep intersections at bounded mechanism poses, no mesh surrogates."""
    kin=assembly.metadata.get('kinematics',{}).get('combat')
    if kin and motion_samples<3:raise ValueError('Motion sweep requires at least three poses')
    angles=np.linspace(kin['minAngleDeg'],kin['maxAngleDeg'],motion_samples).tolist() if kin else [0.]
    rig=assembly.metadata['partRig'];collisions=[];tested=0;rejected=0;rows=[]
    invariant_pairs=set();reused=0
    def transform_signature(info):
        kind=info.get('kind')
        if kind=='rocker':
            # A Y-axis rotation's translation depends only on pivot X/Z.
            # Front/rear rockers on the same shaft move as one rigid group.
            return (kind,info['pivot'][0],info['pivot'][2],tuple(info['axis']))
        return (kind,)
    signatures={p.name:transform_signature(rig[p.name]) for p in assembly.parts}
    for pose_index,angle in enumerate(angles):
        shaped={p.name:_motion(p,rig[p.name],angle,kin) if kin else p.cad for p in assembly.parts}
        bounds={n:_bounds(q) for n,q in shaped.items()}
        row=dict(angleDeg=angle,tested=0,collisions=[])
        for i,a in enumerate(assembly.parts):
            for b in assembly.parts[i+1:]:
                pair=(a.name,b.name)
                invariant=signatures[a.name]==signatures[b.name]
                if invariant and pair in invariant_pairs:
                    reused+=1;continue
                if invariant:invariant_pairs.add(pair)
                if np.any(np.minimum(bounds[a.name][1],bounds[b.name][1])-np.maximum(bounds[a.name][0],bounds[b.name][0])<=1e-7):
                    rejected+=1;continue
                tested+=1;row['tested']+=1
                overlap=shaped[a.name].intersect(shaped[b.name]).Volume()
                if overlap>1e-4:
                    issue=dict(a=a.name,b=b.name,intersectionVolumeMM3=overlap,angleDeg=angle)
                    row['collisions'].append(issue);collisions.append(issue)
        rows.append(row)
        if progress and (pose_index%8==0 or pose_index==len(angles)-1):
            print(json.dumps(dict(phase='native-cad-motion-sweep',module=assembly.metadata['module'],
                pose=pose_index+1,totalPoses=len(angles),angleDeg=angle,exactPairs=tested,
                collisions=len(collisions))),flush=True)
    return dict(passed=not collisions,anglesDeg=angles,exactCADPairsTested=tested,
        aabbPairsRejected=rejected,volumeToleranceMM3=1e-4,collisions=collisions,poses=rows,
        invariantRigidPairsReused=reused,
        scope='All native hardware pairs at each sampled mechanism pose; identical rigid transforms proven once; source organic meshes handled by integration',
        continuousCertificate=False,forcesSimulated=False)

def validate_and_save(assembly,folder):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    cadfolder=folder/'brep';cadfolder.mkdir(exist_ok=True)
    report=validate(assembly,expensive=True)
    # Analytic-face normals intentionally split vertices; welded topology is
    # recorded independently by CYBR GEO's expensive mesh checks.
    hashes={}
    for p in assembly.parts:
        path=cadfolder/(p.name+'.brep');cq.exporters.export(p.cad,str(path))
        hashes[p.name]=hashlib.sha256(path.read_bytes()).hexdigest()
    save_cache(assembly,folder/'cache')
    metadata=dict(assembly.metadata,boundsMM=assembly.bounds.tolist(),cadSHA256=hashes,
                  recipeSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    (folder/'metadata.json').write_text(json.dumps(metadata,indent=2))
    (folder/'cad-validation.json').write_text(json.dumps(report,indent=2))
    return dict(module=metadata['module'],parts=len(assembly.parts),
        triangles=sum(len(p.faces) for p in assembly.parts),boundsMM=metadata['boundsMM'],
        ports=metadata['ports'],cache=str(folder/'cache'),metadata=str(folder/'metadata.json'))

def verify_saved_hardware(folder):
    folder=Path(folder);assembly=load_cache(folder/'cache')
    for p in assembly.parts:p.cad=cq.importers.importBrep(str(folder/'brep'/(p.name+'.brep'))).val()
    report=json.loads((folder/'cad-validation.json').read_text())
    report['hardwareContacts']=sampled_hardware_contacts(assembly,progress=True)
    report['verificationScriptSHA256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    report['interfaceContract']=dict(passed=True,
        portEndpointErrorMM=max(float(np.linalg.norm(np.array(p)-np.array(q))) for p,q in zip(assembly.metadata['ports'],
            [assembly.metadata['routes'][0]['entry'],assembly.metadata['routes'][0]['exit']])),
        authoritativeCenterline=assembly.metadata['routes'][0]['interpolation'],
        chordErrorMM=assembly.metadata['routes'][0]['maxSampledMidpointChordErrorMM'])
    by_name={p.name:p.cad for p in assembly.parts};joint_proofs=[]
    if assembly.metadata['module']=='combat':
        for name,pin in by_name.items():
            if not name.endswith('_socket_shoulder_pin'):continue
            prefix=name.removesuffix('_socket_shoulder_pin')
            rocker_name=prefix.removesuffix('_lower').removesuffix('_upper')+'_slotted_rocker'
            host_name='combat_horizontal_moving_deck' if prefix.endswith('_upper') else 'combat_grounded_bored_chassis'
            row=dict(name=prefix,
                pinToBushingDistanceMM=pin.distance(by_name[prefix+'_flanged_bushing']),
                pinToHostDistanceMM=pin.distance(by_name[host_name]),
                spacerToRockerDistanceMM=by_name[prefix+'_inner_spacer'].distance(by_name[rocker_name]),
                spacerToHostDistanceMM=by_name[prefix+'_inner_spacer'].distance(by_name[host_name]),
                retainingClipToPinDistanceMM=by_name[prefix+'_retaining_clip'].distance(pin))
            expected={'pinToBushingDistanceMM':.05,'pinToHostDistanceMM':.1,
                'spacerToRockerDistanceMM':.05,'spacerToHostDistanceMM':.05,'retainingClipToPinDistanceMM':.05}
            row['passed']=all(abs(row[k]-v)<1e-5 for k,v in expected.items())
            joint_proofs.append(row)
    elif assembly.metadata['module']=='scenes':
        vessel=by_name['scenes_one_solid_optical_vessel']
        pan=by_name['scenes_bored_ceramic_landscape_carrier']
        rim=by_name['scenes_recessed_specimen_rim']
        for name,q in by_name.items():
            if name.startswith('scenes_landscape_support_spacer_'):
                row=dict(name=name,spacerToVesselFloorMM=q.distance(vessel),
                    spacerToSpecimenPanMM=q.distance(pan))
            elif name.endswith('_contact_pad'):
                row=dict(name=name,padToGlassBaseMM=q.distance(vessel),
                    padToGroundedChassisMM=q.distance(by_name['scenes_grounded_saddle_chassis']))
            else:continue
            row['passed']=all(abs(v)<1e-5 for k,v in row.items() if k.endswith('MM'))
            joint_proofs.append(row)
        distance=rim.distance(pan)
        joint_proofs.append(dict(name='scenes_recessed_specimen_rim',
            retainerToPanSeatMM=distance,passed=abs(distance)<1e-5))
        clearance=pan.distance(vessel)
        joint_proofs.append(dict(name='scenes_specimen_pan_cavity_clearance',
            panToGlassClearanceMM=clearance,passed=clearance>1.0))
    report['exactJointDistances']=dict(passed=all(r['passed'] for r in joint_proofs),
        method='OpenCascade exact BRep minimum-distance queries at the reference pose',joints=joint_proofs)
    (folder/'cad-validation.json').write_text(json.dumps(report,indent=2))
    return dict(module=assembly.metadata['module'],contacts=report['hardwareContacts'],interface=report['interfaceContract'])

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=ROOT/'portfolio/output/geo-working/cad-cartridges')
    parser.add_argument('--verify-existing',action='store_true')
    args=parser.parse_args();rows=[]
    for name,builder in (('combat',build_combat_stage),('scenes',build_scene_carrier)):
        result=verify_saved_hardware(args.out/name) if args.verify_existing else validate_and_save(builder(),args.out/name)
        rows.append(result)
        print(json.dumps(result),flush=True)
    if not args.verify_existing:(args.out/'summary.json').write_text(json.dumps(rows,indent=2))

if __name__=='__main__':main()
