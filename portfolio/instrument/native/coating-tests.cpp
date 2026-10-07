#include "cybr/thin_film.hpp"
#include <iostream>
using namespace cybr;
int main(){
 int failures=0;
 auto check=[&](bool condition,const char*label){std::cout<<(condition?"PASS ":"FAIL ")<<label<<'\n';if(!condition)++failures;};
 check(std::abs(thin_film_reflectance(1,1,2,1.5,0,550)-.04)<1e-12,"zero thickness reduces to bare glass");
 check(std::abs(thin_film_reflectance(1,1,1.5,1.5,400,550)-.04)<1e-12,"index-matched layer reduces to bare glass");
 check(thin_film_reflectance(1,1,std::sqrt(1.5),1.5,550/(4*std::sqrt(1.5)),550)<1e-12,"quarter-wave antireflection coating");
 bool bounded=true;
 for(double n0:{1.,1.5})for(double c:{.0001,.1,.3,.7,1.})for(double nm=360;nm<=830;nm+=5){double r=thin_film_reflectance(c,n0,2.3,n0==1?1.5:1,420,nm);bounded&=std::isfinite(r)&&r>=0&&r<=1;}
 check(bounded,"visible spectrum grazing/backface/TIR is finite and energy bounded");
 check(std::abs(thin_film_reflectance(.8,1,2.3,1.5,420,450)-thin_film_reflectance(.8,1,2.3,1.5,420,650))>.01,"coating has wavelength-selective reflectance");
 return failures?1:0;
}
