#pragma once
// File-backed scratch storage for the unmodified triangle/BVH algorithm.
// Mapping files live only in the isolated render working directory and are
// deleted by Windows when the last handle closes, including on process exit.
#define NOMINMAX
#include <windows.h>
#include <unordered_map>
#include <limits>
#include <new>
#include <cstdio>

template<class T> struct SpringsDiskAllocator {
    using value_type=T;
    SpringsDiskAllocator() noexcept = default;
    template<class U> SpringsDiskAllocator(const SpringsDiskAllocator<U>&) noexcept {}
    struct Mapping { HANDLE file; HANDLE mapping; };
    // Registry must outlive global vector destructors. The tiny registry itself
    // is reclaimed by the OS; every mapping/file is closed by deallocate().
    static std::unordered_map<void*,Mapping>& allocations(){static auto* data=new std::unordered_map<void*,Mapping>();return *data;}
    T* allocate(size_t count){
        if(count>std::numeric_limits<size_t>::max()/sizeof(T))throw std::bad_alloc();
        const size_t bytes=count*sizeof(T);
        char name[MAX_PATH];
        if(!GetTempFileNameA(".","cym",0,name))throw std::bad_alloc();
        HANDLE file=CreateFileA(name,GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,CREATE_ALWAYS,FILE_ATTRIBUTE_TEMPORARY|FILE_FLAG_DELETE_ON_CLOSE,nullptr);
        if(file==INVALID_HANDLE_VALUE){DeleteFileA(name);throw std::bad_alloc();}
        LARGE_INTEGER length;length.QuadPart=bytes;
        if(!SetFilePointerEx(file,length,nullptr,FILE_BEGIN)||!SetEndOfFile(file)){CloseHandle(file);throw std::bad_alloc();}
        HANDLE mapping=CreateFileMappingA(file,nullptr,PAGE_READWRITE,0,0,nullptr);
        if(!mapping){CloseHandle(file);throw std::bad_alloc();}
        void* address=MapViewOfFile(mapping,FILE_MAP_ALL_ACCESS,0,0,bytes);
        if(!address){CloseHandle(mapping);CloseHandle(file);throw std::bad_alloc();}
        try{allocations().emplace(address,Mapping{file,mapping});}catch(...){UnmapViewOfFile(address);CloseHandle(mapping);CloseHandle(file);throw;}
        std::fprintf(stderr,"File-backed geometry allocation: %.1f MiB\n",bytes/1048576.);
        return static_cast<T*>(address);
    }
    void deallocate(T* address,size_t) noexcept{
        auto it=allocations().find(address);if(it==allocations().end())return;
        UnmapViewOfFile(address);CloseHandle(it->second.mapping);CloseHandle(it->second.file);allocations().erase(it);
    }
    template<class U> bool operator==(const SpringsDiskAllocator<U>&)const noexcept{return true;}
    template<class U> bool operator!=(const SpringsDiskAllocator<U>&)const noexcept{return false;}
};
