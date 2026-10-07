#include "springs_disk_allocator.h"
#include <vector>
#include <algorithm>
#include <numeric>
// Deliberately global: reproduces static shutdown order of the native renderer.
std::vector<double,SpringsDiskAllocator<double>> values;
std::vector<int,SpringsDiskAllocator<int>> indices;
int main(){
    values.reserve(1000000);for(int i=0;i<1500000;i++)values.push_back(i*.25);
    indices.resize(1500000);std::iota(indices.begin(),indices.end(),0);
    std::reverse(indices.begin(),indices.end());
    if(values[indices[0]]!=1499999*.25)return 2;
    values.shrink_to_fit();
    std::puts("allocator growth, access, independent mappings and global lifetime test reached shutdown");
    return 0;
}
