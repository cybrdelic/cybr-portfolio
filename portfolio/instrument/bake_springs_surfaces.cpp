// Evaluate recovered native materials and fixed-world illumination on vertices.
// No beauty-image sampling, camera projection, generated textures or sprites.
#define main cybr_original_render_main
#include "spectral_desert.cpp"
#undef main

int main(int argc,char**argv){try{
    if(argc!=7)throw std::runtime_error("mesh probes output grain relief sky-output");
    SUN=unit(V(-.80f,.40f,.28f));useClouds=false;useSteam=false;
    cybr_detail::load_from_environment();photographicGrain.load(argv[4]);granularRelief.load(argv[5]);
    omp_set_num_threads(4);initSpectra();initRipples();
    std::ifstream file(argv[1],std::ios::binary);uint32_t count;file.read((char*)&count,4);
    if(!file||count>30000000)throw std::runtime_error("Invalid source geometry");
    tris.reserve(count);
    for(uint32_t i=0;i<count;i++){float a[20];file.read((char*)a,80);if(!file)throw std::runtime_error("Truncated source");Tri t;t.p=V(a[0],a[1],a[2]);t.e1=V(a[3],a[4],a[5])-t.p;t.e2=V(a[6],a[7],a[8])-t.p;t.n0=V(a[9],a[10],a[11]);t.n1=V(a[12],a[13],a[14]);t.n2=V(a[15],a[16],a[17]);t.mat=int(a[18]);t.group=int(a[19]);if(dot(cross(t.e1,t.e2),cross(t.e1,t.e2))>1e-20f)tris.push_back(t);}
    order.resize(tris.size());std::iota(order.begin(),order.end(),0);nodes.reserve(tris.size()/2);build(0,int(order.size()));
    std::cerr<<"Native source BVH ready: "<<tris.size()<<" triangles\n";
    std::ifstream input(argv[2],std::ios::binary);uint32_t n;input.read((char*)&n,4);
    std::vector<std::array<float,7>> queries(n);input.read((char*)queries.data(),n*28);if(!input)throw std::runtime_error("Truncated queries");
    std::vector<V> colors(n);std::atomic<uint32_t> done{0};
    #pragma omp parallel for schedule(dynamic,128)
    for(int i=0;i<int(n);i++){
        auto a=queries[i];V p(a[0],a[1],a[2]),normal=unit(V(a[3],a[4],a[5])),gn=normal;
        int mat=int(a[6]);auto m=shade(p,normal,mat,mat==5?8.f:.008f);
        const float bias=mat==5?8.f:.012f;
        RNG rng(uint64_t(i)*0x9e3779b97f4a7c15ULL+20260914);Spec irradiance(0.f);
        // 24 stratified cosine hemisphere visibility samples; source-material
        // sun/sky diffuse bake, not a claim of full transport or water caustics.
        Frame frame(normal);
        for(int k=0;k<24;k++){
            float u=(k+.5f)/24.f,phi=2*PI*std::fmod((k+.5f)*.61803398875f,.999999f);
            V l=frame.world(V(std::sqrt(u)*std::cos(phi),std::sqrt(u)*std::sin(phi),std::sqrt(1-u)));
            if(l.z>0&&!opaqueShadow(Ray(p+gn*bias,l),INF))irradiance+=physicalSky(l)*(PI/24);
        }
        float cosine=std::max(0.f,dot(normal,SUN));
        if(!opaqueShadow(Ray(p+gn*bias,SUN),INF))irradiance+=solar*(SUN_SOLID*cosine);
        // Residual diffuse bounce floor is explicit and deliberately modest.
        irradiance+=blackbody(5750.f)*.04f;
        V color=toRGB(rgbAnchors(m.color)*irradiance*(1/PI));
        if(!std::isfinite(color.x)||!std::isfinite(color.y)||!std::isfinite(color.z))color=V(0);
        colors[i]=vmax(color,V(0));
        uint32_t c=++done;if(c%50000==0){
            #pragma omp critical
            std::cerr<<c<<" / "<<n<<" baked surface samples\n";
        }
    }
    std::ofstream output(argv[3],std::ios::binary);output.write((char*)colors.data(),colors.size()*sizeof(V));output.close();
    // Native sky in browser Y-up coordinates, linear HDR (no solar disc).
    std::ofstream sky(argv[6],std::ios::binary);const int w=512,h=256;
    for(int y=0;y<h;y++)for(int x=0;x<w;x++){
        float a=(x+.5f)/w*2*PI,b=(y+.5f)/h*PI;
        V direction(std::sin(b)*std::cos(a),-std::sin(b)*std::sin(a),std::cos(b));
        V c=direction.z>0?toRGB(physicalSky(direction)):V(.09f,.08f,.06f);
        float pixel[]={std::max(0.f,c.x),std::max(0.f,c.y),std::max(0.f,c.z),1};sky.write((char*)pixel,16);
    }
    std::cout<<"Native surface bake complete: "<<n<<" vertices\n";return 0;
}catch(const std::exception&e){std::cerr<<e.what()<<"\n";return 1;}}
