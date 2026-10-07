#pragma once
#include "spectrum.hpp"
#include <complex>
namespace cybr {
// Lossless single dielectric coating. Lengths are in nanometres. Both
// polarizations are evaluated separately, then averaged for scalar transport.
inline double thin_film_reflectance(double cosine,double ni,double nf,double nt,double thickness,double nm){
 if(thickness<=0)return fresnel_dielectric(cosine,ni,nt);
 double c0=clamp(std::abs(cosine)),s0=std::max(0.,1-c0*c0);
 using C=std::complex<double>;
 C c1=std::sqrt(C(1-s0*sqr(ni/nf))),c2=std::sqrt(C(1-s0*sqr(ni/nt)));
 C phase=std::exp(C(0,4*pi*nf*thickness/nm)*c1);
 auto power=[&](C a,C b){C d=1.+a*b*phase;return std::norm((a+b*phase)/d);};
 C rs01=(ni*c0-nf*c1)/(ni*c0+nf*c1),rs12=(nf*c1-nt*c2)/(nf*c1+nt*c2);
 C rp01=(nf*c0-ni*c1)/(nf*c0+ni*c1),rp12=(nt*c1-nf*c2)/(nt*c1+nf*c2);
 return clamp(.5*(power(rs01,rs12)+power(rp01,rp12)));
}
}
