"""Read-only reductions of actual native wood/flux bytes; no simulation code."""
import numpy as np


def material_peaks(stock, metadata, scale=1., origin=None):
    shape=stock.shape[:-1]
    occupied=metadata[...,3]>0
    result={}
    for label,valid in [('global',np.ones(shape,dtype=bool)),('occupied',occupied)]:
        finite=valid & np.isfinite(stock[...,1])
        if not finite.any():
            result[label]=None;continue
        index=tuple(map(int,np.unravel_index(int(np.argmax(np.where(finite,stock[...,1],-np.inf))),shape)))
        rest=metadata[index][:3].astype(float)
        sample=stock[index].astype(float)
        result[label]={'voxelZYX':list(index),'occupied':bool(occupied[index]),'restPosition':rest.tolist(),
            'stockVirginHeatReleaseChar':sample.tolist(),'dryMassKg':float(metadata[index][3])*scale**3,
            'heatK':293.15+500*float(sample[1])}
        if origin is not None:
            # For detached nodes use the separately captured actual pose.
            result[label]['worldAtRest']=(np.asarray(origin)+rest*scale).tolist()
    return result


def flux_summary(raw, layout=None):
    layout=layout or {}
    n=int(layout.get('N',128));stride=int(layout.get('stride',6))
    mass_units=float(layout.get('massUnitsPerKg',1e8));energy_units=float(layout.get('energyUnitsPerJ',256))
    heat_capacity=float(layout.get('gasHeatCapacityJkgK',1200));heat_scale=float(layout.get('gasHeatScaleK',1200))
    words=np.frombuffer(raw,np.uint32)
    if stride!=6 or words.size!=n**3*stride: raise ValueError('Unexpected production wood-flux layout')
    words=words.reshape(-1,stride)
    mass=(words[:,0].astype(np.float64)+words[:,1].astype(np.float64)*2**32)/mass_units
    energy=(words[:,2].astype(np.float64)+words[:,3].astype(np.float64)*2**32)/energy_units
    normalization=words[:,4].copy().view(np.float32)
    blocked=words[:,5]!=0
    active=(mass>0)|(energy>0)
    result={'cellCount':n**3,'activeCells':int(active.sum()),'blockedCells':int((active&blocked).sum()),
        'totalMassKg':float(mass.sum()),'totalEnergyJ':float(energy.sum()),
        'blockedMassKg':float(mass[blocked].sum()),'blockedEnergyJ':float(energy[blocked].sum()),
        'nonFiniteNormalization':int((~np.isfinite(normalization)&active).sum())}
    volume=(6/n)**3
    for label,quantity in [('mass',mass),('energy',energy),('normalization',np.where(active,normalization,0))]:
        index=int(np.argmax(quantity));zyx=list(map(int,np.unravel_index(index,(n,n,n))))
        result[label+'Peak']={'voxelZYX':zyx,'massKg':float(mass[index]),'energyJ':float(energy[index]),
            'normalization':float(normalization[index]),'blocked':bool(blocked[index]),
            'normalizedFuelKgM3':float(mass[index]/volume*normalization[index]) if not blocked[index] else 0.,
            # This is the producer's sensible enthalpy-density term. Actual
            # temperature after mixing also depends on gas/fuel heat capacity.
            'normalizedSensibleEnthalpy':float(energy[index]/(volume*heat_capacity*heat_scale)*normalization[index]) if not blocked[index] else 0.}
    return result
