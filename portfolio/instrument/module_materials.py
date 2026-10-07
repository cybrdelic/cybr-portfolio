"""Shared native cartridge finishes, with preserved optical-data provenance."""
from pathlib import Path
import hashlib,json,shutil
import numpy as np

def measured_metals(out):
    source=Path('D:/CYBR-build/exploded-instrument/studio/optical-constants')
    dest=out/'optical-constants';dest.mkdir(exist_ok=True)
    spectra={};provenance=[]
    for element,author in [('Al','Rakic'),('Cr','Johnson')]:
        original=source/(element+'.yml');rows=[]
        for line in original.read_text().splitlines():
            try:values=[float(x) for x in line.split()]
            except ValueError:continue
            if len(values)==3:rows.append(values)
        data=np.asarray(rows);assert len(data)>20 and np.isfinite(data).all()
        assert data[:,0].min()<=.36 and data[:,0].max()>=.83
        shutil.copyfile(original,dest/original.name);spectra[element]={}
        for col,key in [(1,'eta'),(2,'k')]:
            path=dest/f'{element}-{key}.spd';np.savetxt(path,np.c_[data[:,0]*1000,data[:,col]],fmt='%.9g');spectra[element][key]=str(path.resolve())
        provenance.append(dict(element=element,dataset=author,license='CC0',sourceSHA256=hashlib.sha256(original.read_bytes()).hexdigest(),source=f'https://raw.githubusercontent.com/polyanskiy/refractiveindex.info-database/master/database/data/main/{element}/nk/{author}.yml'))
    (dest/'provenance.json').write_text(json.dumps(provenance,indent=2))
    return spectra

def hardware_material(material,spectra,red):
    c=np.asarray(material['color']);rough=material['roughness']
    if material.get('nativeType')=='glass':
        return dict(type='glass',ior_a=material.get('ior',1.47),ior_b=0,roughness=rough,absorption=(.002,.0005,.0008))
    if c[0]>.10 and c[0]>c[1]*2 and c[0]>c[2]*2:
        return dict(type='plastic',color=c,roughness=.38,ior_a=1.48,spectra={'color':str(red.resolve())})
    if material['metalness']>.6 and c.max()>.16:
        if c[0]>c[2]*1.3:
            # Authored bronze-like port, NOT measured bronze optical data.
            return dict(type='metal',eta=(.3,.65,1.1),k=(3.5,2.7,2.2),roughness=rough,alpha_u=.09,alpha_v=.17)
        polished=c.max()>.7
        return dict(type='metal',spectra=spectra['Cr' if polished else 'Al'],roughness=rough,alpha_u=.018 if polished else .035,alpha_v=.035 if polished else .095)
    return dict(type='plastic',color=c,roughness=max(.35,rough),ior_a=1.48)
