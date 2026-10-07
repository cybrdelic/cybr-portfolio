// Evaluate the original source shader into physical material data, NOT radiance.
// Inherits GPL-2.0-only source implementation from CYBR GEO / CYBR SCENES.
#define main cybr_original_render_main
#include "spectral_desert.cpp"
#undef main

int main(int argc,char**argv){try{
 if(argc!=5&&argc!=6)throw std::runtime_error("usage: probes output grain relief [sky-with-sun.pfm]");
 cybr_detail::load_from_environment();photographicGrain.load(argv[3]);granularRelief.load(argv[4]);
 std::ifstream input(argv[1],std::ios::binary);uint32_t count=0;input.read((char*)&count,4);
 if(!input||count==0||count>10000000)throw std::runtime_error("Invalid material probe count");
 std::ofstream output(argv[2],std::ios::binary);output.write((char*)&count,4);
 for(uint32_t i=0;i<count;i++){
  float a[7];input.read((char*)a,sizeof(a));if(!input)throw std::runtime_error("Truncated material probes");
  for(float x:a)if(!std::isfinite(x))throw std::runtime_error("Nonfinite material probe");
  V p(a[0],a[1],a[2]),n=unit(V(a[3],a[4],a[5]));int mat=int(a[6]);
  if(mat<0||mat>9||mat==6||mat==7)throw std::runtime_error("Probe requires an opaque source material");
  auto m=shade(p,n,mat,mat==5?8.f:.008f);
  float result[]={m.color.x,m.color.y,m.color.z,n.x,n.y,n.z,m.rough,m.ior};
  for(float x:result)if(!std::isfinite(x))throw std::runtime_error("Nonfinite source material output");
  output.write((char*)result,sizeof(result));if(!output)throw std::runtime_error("Material output write failed");
 }
 if(input.peek()!=EOF)throw std::runtime_error("Trailing material probe data");
 if(argc==6){
  // The old workshop sky omitted the separate solar light. Preserve its
  // integrated solid-angle energy when representing it in the GPU envmap.
  SUN=unit(V(-.80f,.40f,.28f));useClouds=false;useSteam=false;initSpectra();
  const int w=2048,h=1024;std::vector<V> sky(size_t(w)*h);std::vector<int> disc;double solid=0;
  for(int y=0;y<h;y++)for(int x=0;x<w;x++){
   float a=(x+.5f)/w*2*PI,b=(y+.5f)/h*PI;
   V d(std::sin(b)*std::cos(a),-std::sin(b)*std::sin(a),std::cos(b));
   sky[size_t(y)*w+x]=vmax(d.z>0?toRGB(physicalSky(d)):V(.09f,.08f,.06f),V(0));
   if(dot(d,SUN)>SUN_COS){disc.push_back(y*w+x);solid+=2*PI/w*(std::cos(PI*y/h)-std::cos(PI*(y+1)/h));}
  }
  if(disc.empty())throw std::runtime_error("Solar disc below environment resolution");
  V energy=vmax(toRGB(solar),V(0))*float(SUN_SOLID/solid);
  for(int i:disc)sky[i]+=energy;
  std::ofstream env(argv[5],std::ios::binary);env<<"PF\n"<<w<<" "<<h<<"\n-1.0\n";
  for(int y=h-1;y>=0;y--)env.write((char*)(sky.data()+size_t(y)*w),w*sizeof(V));
  if(!env)throw std::runtime_error("Environment write failed");
 }
 std::cout<<"Exported "<<count<<" physical source samples (albedo, shading normal, roughness, IOR); no illumination\n";
 return 0;
}catch(const std::exception&e){std::cerr<<e.what()<<"\n";return 1;}}
