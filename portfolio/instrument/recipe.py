"""Individually named CYBR GEO parts for the authored portfolio instrument.

Millimetres; X shaft, Z up. Concept geometry, not a functional machine.
"""
from pathlib import Path
import sys, math
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'cybr-geo/src'))
import cadquery as cq
from mechanism_lab import Assembly,Material
from mechanism_lab.core import cad_part,mesh_part,validate,save_cache
from mechanism_lab.geometry import ring,drill,bolt_circle,tube_mesh,mesh_label

MATERIALS=[Material('Machined aluminium',(.7,.72,.75),1,.19),
 Material('Polished steel',(.8,.81,.83),1,.075),Material('Graphite',(.035,.042,.052),.8,.24),
 Material('Optical glass',(.94,.98,1),0,.02,ior=1.52),Material('Red enamel',(.62,.018,.025),.3,.19),
 Material('Score ivory',(.8,.76,.65),.2,.28),Material('Ink',(.015,.02,.022),0,.45),
 Material('Water',(.8,.94,.97),0,.02,ior=1.333)]
MODULES=('geo','light','elements','song','combat','scenes')

def build_module(name):
    parts=[]
    def add(label,shape,mat=0):
        part=cad_part(name+'__'+label,shape,mat,tolerance=.035,angular=.075,group=name,
                      role='Authored portfolio sculpture / '+label)
        parts.append(part)
        return part
    def edge_ring(label,ro,ri,a,b,mat=0,bevel=.3):
        q=ring(ro,ri,a,b)
        if bevel:q=cq.Workplane(obj=q).edges().chamfer(bevel).val()
        return add(label,q,mat)
    def screw(label,x,y,z,length=9):
        # Recessed hex socket and discrete thread ridges are actual geometry.
        head=ring(2.7,0,x,x+3).translate((0,y,z))
        socket=cq.Workplane('YZ').polygon(6,3).extrude(2).translate((x+1.4,y,z)).val()
        add(label+'_socket_head',head.cut(socket),1)
        add(label+'_shank',ring(1.25,0,x-length,x).translate((0,y,z)),1)
        for j in range(4):add(label+f'_thread_{j}',ring(1.52,1.1,x-1.5-j*1.6,x-1.1-j*1.6).translate((0,y,z)),2)
    def flange(label,x,r=42,inner=28):
        centers=bolt_circle(r-6,8)
        if name=='geo' and label=='front_flange':centers=centers[::2]
        q=drill(ring(r,inner,x,x+5),centers,1.8,x-1,x+6)
        if name=='geo' and label=='front_flange':q=drill(q,bolt_circle(39,4,math.pi/4),1.6,x-1,x+6)
        add(label,q)
        for i,(y,z) in enumerate(centers):screw(label+f'_bolt_{i}',x+5,y,z)
    def tube(label,points,radius,mat=4,sides=10):
        if label.startswith('mineral_') and np.min(np.linalg.norm(np.asarray(points)[:,1:],axis=1))<4:return
        vertices,faces=tube_mesh(points,radius,sides)
        parts.append(mesh_part(name+'__'+label,vertices,faces,mat,group=name,role='Authored instrument '+label))
    def marking(label,text,x,theta,radius,size=1.7):
        p=mesh_label(text,x0=x,theta=theta,radius=radius,size=size,material=6)
        p.name=name+'__'+label;p.group=name;p.motion='fixed';parts.append(p)
    def grooves(label,ro,start,end,count,mat=2):
        for i,x in enumerate(np.linspace(start,end,count)):
            edge_ring(label+f'_{i}',ro,ro-.055,x,x+.045,mat,0)
    def cable_pair(start,end):
        # One jacket, with horizontal tangents at the compression glands.
        # Its centreline and bore coincide at both ends; no duplicate through-rail.
        xx=np.linspace(start,end,220);t=np.linspace(0,1,220)
        for cable in range(1):
            centers=np.column_stack((xx,-8-5*np.sin(np.pi*t)**2,-2.5-7*np.sin(np.pi*t)**2))
            tube(f'cable_{cable}_jacket',centers,2.35,4,20)
            # Two opposite braid families, each individually named geometry.
            for handedness in (-1,1):
                for strand in range(6):
                    a=xx*.95*handedness+strand*np.pi/3
                    points=centers+np.column_stack((np.zeros_like(a),2.4*np.cos(a),2.4*np.sin(a)))
                    tube(f'cable_{cable}_braid_{handedness}_{strand}',points,.14,4,5)

    if name=='geo':
        edge_ring('service_conduit_rear',3.5,2.8,-47,-35,1,.12)
        edge_ring('service_conduit_front',3.5,2.8,35,61,1,.12)
        # The open central bay accommodates the runtime service-loop take-up.
        for x in (-35,35):edge_ring(f'takeup_guard_{x}',17,4,x-.6,x+.6,1,.1)
        barrel=ring(43,34,-42,12)
        for i in range(12):
            cut=cq.Workplane('XY').box(25,12,13).edges('|Z').fillet(2).val().translate((-12,43,0)).rotate((0,0,0),(1,0,0),i*30)
            barrel=barrel.cut(cut)
        add('vented_monocoque',barrel,0)
        edge_ring('inner_black_barrel',35,29,-40,10,2)
        flange('rear_flange',-47,47,24);flange('front_flange',12,47,29)
        edge_ring('polished_shoulder_rear',45,39,-39,-28,1,.7)
        edge_ring('polished_shoulder_front',45,39,0,10,1,.7)
        grooves('rear_lathe_lines',45.03,-38,-29,36)
        grooves('front_lathe_lines',45.03,1,9,32)
        # Knurled service band and stepped, independently retained front race.
        edge_ring('knurled_service_band',44.4,42,-27,-17,0,.2)
        for j in range(120):
            a=j*2*math.pi/120
            pts=[(x,44.46*math.cos(a+.025*(x+27)),44.46*math.sin(a+.025*(x+27))) for x in np.linspace(-27,-17,8)]
            tube(f'knurl_{j}',pts,.09,2,4)
        edge_ring('inner_front_lip',37,31,18,22,1,.4)
        for j,(y,z) in enumerate(bolt_circle(40,6,.2)):
            add(f'flange_recess_{j}',ring(2.9,1.8,17.02,17.2).translate((0,y,z)),2)
        marking('shell_identification','CYBR GEO / 01',-33,-2.4,45.08,2.3)
        edge_ring('bearing_race',30,22,17,25,1)
        for i,(y,z) in enumerate(bolt_circle(26,18)):
            add(f'bearing_ball_{i}',cq.Solid.makeSphere(2.6,cq.Vector(26,y,z),angleDegrees1=-90),1)
        edge_ring('retainer',31,21,28,31,2)
        add('exploded_interface',drill(ring(42,29,47,50),bolt_circle(39,4,math.pi/4),1.6,46,51),1)
        for i,(y,z) in enumerate(bolt_circle(39,4,math.pi/4)):screw(f'floating_fastener_{i}',58,y,z,24)
        plate=cq.Workplane('XY').box(29,2,13).edges('|Y').chamfer(.5).val().translate((-16,-44,0))
        add('identity_plate',plate,0)
        label=cq.Workplane('XZ').text('CYBR',5,.1,font='Arial',combine=True).val().translate((-16,-45.05,0))
        add('identity_plate_engraving',label,6)
        for i,(y,z) in enumerate(bolt_circle(35,24)):
            tooth=cq.Workplane('XY').box(15,3.2,4).translate((-5,y,z)).val().rotate((-5,y,z),(0,y,z),math.degrees(math.atan2(z,y)))
            add(f'internal_key_{i}',tooth,1)
    elif name=='light':
        edge_ring('exploded_rear_mount',43,39,-28,-25,1,.5)
        edge_ring('lens_cartridge',44,39,-6,5,1,.7)
        edge_ring('rear_bezel',44.6,38,-8,-5,0,.4)
        edge_ring('black_seal',40,38,-4,-2,2,.15)
        a=cq.Solid.makeSphere(110,cq.Vector(-102.45,0,0),angleDegrees1=-90)
        b=cq.Solid.makeSphere(110,cq.Vector(102.45,0,0),angleDegrees1=-90)
        # Annular optical element: the central service passage is real geometry,
        # not a cable drawn through an uncut solid lens or opaque backing plate.
        add('biconvex_optical_lens',a.intersect(b).cut(ring(4.3,0,-15,15)),3)
        edge_ring('optical_service_sleeve',4.2,2.8,-31,31,1,.12)
        tube('optical_service_cable',np.column_stack((np.linspace(-31,31,80),np.zeros(80),np.zeros(80))),2.35,4,20)
        edge_ring('front_polished_lip',42.5,38.6,5,7,1,.45)
        edge_ring('exploded_locking_ring',43,40,28,30,1,.45)
        grooves('turned_outer_edge',44.035,-4.5,4,24)
        marking('barrel_engraving','CYBR LIGHT   /   SPECTRAL OPTICS   /   02',-.5,-2.6,44.09,1.8)
        for j in range(36):
            a=j*2*math.pi/36;r=43.3
            add(f'index_mark_{j}',cq.Workplane('YZ').box(.15,1.1,.09).val().translate((7.1,r*math.cos(a),r*math.sin(a))),6)
        for i,(y,z) in enumerate(bolt_circle(46,3,math.pi/2)):
            add(f'optic_mount_lug_{i}',ring(3.5,1.6,-11,9).translate((0,y,z)),0)
            add(f'optic_locknut_{i}',ring(3.8,1.5,-14,-11).translate((0,y,z)),2)
            screw(f'floating_optic_screw_{i}',12,y,z,24)
        for side in (-1,1):add(f'axial_cable_gland_{side}',ring(5.5,2.8,side*29-2,side*29+2),1)
    elif name=='elements':
        outer=cq.Workplane('XY').box(60,62,66).edges().fillet(13).val()
        inner=cq.Workplane('XY').box(53,55,59).edges().fillet(10).val()
        ports=ring(8,0,-35,35).translate((0,-8,-2.5))
        add('rounded_square_glass_vessel',outer.cut(inner).cut(ports),3)
        flange('inlet_collar',-37,33,25)
        edge_ring('outlet_collar',30,24,32,38,1,.6)
        # A real air headspace and a gently curved free surface. Previously a
        # full-volume glass-like solid had no waterline at all.
        water=cq.Workplane('XY').box(52.6,54.6,58.6).edges().fillet(9.8).val()
        surface=[(float(x),float(13+1.4*math.sin(x*.13)+.35*math.cos(x*.31))) for x in np.linspace(-32,32,41)]
        fill=cq.Workplane('XZ').moveTo(-32,-35).lineTo(32,-35).lineTo(*surface[-1]).spline(list(reversed(surface[:-1])),includeCurrent=True).close().extrude(35,both=True).val()
        # The bore in the glass is not an air tunnel through the water. Exclude
        # only the actual curved jacket envelope from the liquid volume.
        tt=np.linspace(0,1,61)
        route=[cq.Vector(float(-35+70*t),float(-8-5*math.sin(math.pi*t)**2),float(-2.5-7*math.sin(math.pi*t)**2)) for t in tt]
        route_wire=cq.Wire.assembleEdges([cq.Edge.makeSpline(route)])
        jacket_void=cq.Workplane('YZ',origin=(-35,-8,-2.5)).circle(2.58).sweep(cq.Workplane(obj=route_wire),isFrenet=False).val()
        water=water.intersect(fill).cut(jacket_void)
        for i in range(18):
            x=-20+(i%7)*6;y=math.sin(i*2.4)*18;z=-20+(i*7%29)
            water=water.cut(cq.Solid.makeSphere(.65+(i%5)*.48,cq.Vector(x,y,z),angleDegrees1=-90))
        add('water_with_free_surface_and_air_bubbles',water,7)
        # Sealed, bored compression fittings at the actual cable ports.
        gland_void=cq.Workplane('YZ',origin=(-35,-8,-2.5)).circle(3.0).sweep(cq.Workplane(obj=route_wire),isFrenet=False).val()
        for side in (-1,1):
            x=side*32
            add(f'port_gland_{side}',ring(7.8,0,x-3,x+3).translate((0,-8,-2.5)).cut(gland_void),1)
            add(f'port_seal_{side}',ring(3.2,2.45,x-3.2,x+3.2).translate((0,-8,-2.5)),2)
        cable_pair(-35,35)
    elif name=='song':
        for k,x in enumerate((-25,0,25)):
            radius=40-k*2
            depth=lambda r: 5.6*math.exp(-((r-7)/7.5)**2)+1.4*(r/radius)**2
            rr=np.linspace(7,radius,55)
            profile=[(x+depth(r),float(r)) for r in rr]
            profile += [(x+depth(r)-(.24+.45*(1-r/radius)),float(r)) for r in reversed(rr)]
            cymbal=cq.Workplane('XY').polyline(profile).close().revolve(360,(0,0),(1,0)).val()
            add(f'dished_cymbal_{k}',cymbal,5)
            for n,r in enumerate(np.linspace(16,radius-.6,35)):
                edge_ring(f'lathed_cymbal_{k}_{n}',r,r-.045,x+depth(r)+.015,x+depth(r)+.04,0,0)
            for staff in range(3):
                for line in range(5):
                    r=13+staff*8+line*.9
                    edge_ring(f'staff_{k}_{staff}_{line}',r,r-.15,x+depth(r)+.045,x+depth(r)+.07,6,0)
                for j in range(22):
                    angle=j*2*math.pi/22+k*.14;r=13+staff*8+(j*3%5)*.9
                    y,z=r*math.cos(angle),r*math.sin(angle)
                    face=x+depth(r)+.09
                    add(f'note_{k}_{staff}_{j}',ring(.6,0,face,face+.035).translate((0,y,z)),6)
                    stem=cq.Workplane('YZ').box(.19,2.1,.045).val().translate((face,y+.35,z+1))
                    add(f'stem_{k}_{staff}_{j}',stem,6)
            edge_ring(f'felt_washer_{k}',10,6,x+4.9,x+5.7,2,.1)
            edge_ring(f'hub_{k}',8.8,5,x+5.8,x+7,1,.2)
        edge_ring('score_spindle',4.2,3,-35,36,1,.2)
        tube('spindle_cable',np.column_stack((np.linspace(-35,36,60),np.zeros(60),np.zeros(60))),2.35,4,16)
    elif name=='combat':
        flange('wrist',-34,26,13);edge_ring('wrist_body',23,14,-27,2,2)
        for k in range(5):edge_ring(f'actuator_band_{k}',24.5,21,-24+k*5,-22+k*5,1,.4)
        for j in range(3):
            angle=j*120
            joints=[(-12,21),(9,46),(42,43),(68,26)]
            for k,((ax,ay),(bx,by)) in enumerate(zip(joints,joints[1:])):
                length=math.hypot(bx-ax,by-ay);width=11-k*1.5
                turn=math.degrees(math.atan2(by-ay,bx-ax))
                shape=cq.Workplane('XY').polyline([(-length/2-4,-width*.38),(-length/2-5,width*.22),(-length/2+2,width*.62),(length/2-2,width*.35),(length/2+4,0),(length/2-1,-width*.35)]).close().extrude(3).edges('|Z').chamfer(.6).val()
                hole=cq.Workplane('XY').pushPoints([(-length/2,0),(length/2,0)]).circle(2.8).extrude(4).val()
                slot=cq.Workplane('XY').polyline([(-length*.28,-width*.1),(-length*.2,width*.24),(length*.25,width*.12),(length*.3,-width*.1)]).close().extrude(4).val()
                shape=shape.cut(hole).cut(slot)
                for cheek in (-1,1):
                    cheek_shape=shape.translate((0,0,cheek*5)).rotate((0,0,0),(0,0,1),turn).translate(((ax+bx)/2,(ay+by)/2,0)).rotate((0,0,0),(1,0,0),angle)
                    add(f'finger_{j}_link_{k}_cheek_{cheek}',cheek_shape,2)
                pin=cq.Workplane('XY').circle(2.6).extrude(8,both=True).val().translate((ax,ay,0)).rotate((0,0,0),(1,0,0),angle)
                add(f'finger_{j}_pivot_{k}',pin,1)
                for side in (-1,1):
                    cap=cq.Workplane('XY').circle(4.5).circle(2).extrude(1.2).val().translate((ax,ay,side*8)).rotate((0,0,0),(1,0,0),angle)
                    add(f'finger_{j}_pivot_race_{k}_{side}',cap,1)
            rod=cq.Workplane('XY').box(25,3,3).edges('|X').chamfer(.4).val().translate((17,35,0)).rotate((0,0,0),(1,0,0),angle)
            add(f'finger_{j}_pushrod',rod,1)
            add(f'finger_{j}_pad',cq.Workplane('XY').box(14,3,8).val().translate((64,25,0)).rotate((0,0,0),(1,0,0),angle),6)
        edge_ring('central_actuator',10,5,-10,20,2)
        edge_ring('actuator_end_seal',10.7,4,18,21,1,.3)
        tube('actuator_cable',np.column_stack((np.linspace(-34,70,100),np.zeros(100),np.zeros(100))),2.35,4,20)
    elif name=='scenes':
        edge_ring('cage_rear',30,26,-26,-22,2,.6);edge_ring('cage_front',30,26,23,27,2,.6)
        for j in range(6):
            a=j*math.pi/3;y,z=28*math.cos(a),28*math.sin(a)
            # Bowed meridian straps follow the orb, rather than a barrel cage.
            xs=np.linspace(-25,25,35);rs=28+6*np.sin(np.linspace(0,np.pi,35))
            tube(f'cage_bowed_strut_{j}',np.column_stack((xs,rs*np.cos(a),rs*np.sin(a))),1.15,1,10)
            screw(f'cage_terminal_{j}',30,y,z,8)
        from scipy.spatial import ConvexHull
        rng=np.random.default_rng(61)
        n=170;i=np.arange(n);zz=1-2*(i+.5)/n;aa=i*2.39996323
        vv=np.column_stack((np.sqrt(1-zz*zz)*np.cos(aa),np.sqrt(1-zz*zz)*np.sin(aa),zz))*(24+rng.uniform(-.65,.65,n))[:,None]
        hull=ConvexHull(vv);ff=hull.simplices.copy()
        for f in ff:
            if np.dot(np.cross(vv[f[1]]-vv[f[0]],vv[f[2]]-vv[f[0]]),vv[f].mean(0))<0:f[1],f[2]=f[2],f[1]
        # Split vertices per face: retain the cut-stone facets, not a smooth ball.
        shell=cq.Shell.makeShell([cq.Face.makeFromWires(cq.Wire.makePolygon([cq.Vector(*p) for p in vv[f]],close=True)) for f in ff])
        stone=cq.Solid.makeSolid(shell).cut(ring(3.7,0,-40,40))
        add('faceted_obsidian_core',stone,2)
        def on_core(d):
            d=d/np.linalg.norm(d);dots=hull.equations[:,:3]@d
            radius=np.min(-hull.equations[dots>1e-6,3]/dots[dots>1e-6])
            return d*(radius+.055)
        # Branched mineral seams cross facet edges instead of tracing the
        # triangulation. Deterministic walks are projected onto the actual hull.
        for j in range(16):
            direction=rng.normal(size=3);direction/=np.linalg.norm(direction)
            tangent=rng.normal(size=3);points=[]
            for step in range(38):
                tangent-=direction*np.dot(tangent,direction)
                tangent=tangent/np.linalg.norm(tangent)+rng.normal(size=3)*.24
                direction+=tangent*.057;direction/=np.linalg.norm(direction)
                points.append(on_core(direction))
            tube(f'mineral_seam_{j}',points,rng.uniform(.055,.15),0,5)
            for branch in (10,23):
                d=points[branch]/np.linalg.norm(points[branch]);tt=rng.normal(size=3);twig=[]
                for step in range(12):
                    tt-=d*np.dot(tt,d);tt/=np.linalg.norm(tt)
                    d+=tt*.045;d/=np.linalg.norm(d);twig.append(on_core(d))
                tube(f'mineral_branch_{j}_{branch}',twig,.04,0,4)
        edge_ring('core_axis',3.5,2.8,-36,36,1,.15)
        tube('core_service_cable',np.column_stack((np.linspace(-36,36,80),np.zeros(80),np.zeros(80))),2.35,4,20)
        for j in (-1,1):edge_ring(f'core_mount_{j}',9,3.5,j*20,j*20+2,0,.2)
    else:raise ValueError(name)
    return Assembly('portfolio_'+name,parts,MATERIALS,metadata={'purpose':'Authored exploded-instrument portfolio sculpture','not_manufacturing_qualified':True})

if __name__=='__main__':
    import argparse,json
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,required=True);parser.add_argument('--module',choices=MODULES,default='light');args=parser.parse_args()
    a=build_module(args.module);folder=args.out/args.module;save_cache(a,folder)
    report=validate(a);(folder/'validation.json').write_text(json.dumps(report,indent=2))
    for p in a.parts:
        if p.cad is not None:cq.exporters.export(p.cad,str(folder/(p.name+'.step')))
    print(json.dumps({'module':args.module,'parts':len(a.parts),'triangles':report['triangles'],'output':str(folder)}))
