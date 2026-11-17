#pragma once
#include <array>
#include <atomic>
#include <cstdint>
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

inline int64_t device_qpc() {
    LARGE_INTEGER value{};
    QueryPerformanceCounter(&value);
    return value.QuadPart;
}

// Single audio-thread writer. Entries never recycle during one experiment.
template<class T,size_t N> struct PublishedTrace {
    std::array<T,N> entries{};
    std::atomic<size_t> count{};
    std::atomic<bool> overflow{};
    void append(T row) {
        const size_t next=count.load(std::memory_order_relaxed);
        if(next>=N){overflow.store(true);return;}
        entries[next]=row;
        count.store(next+1,std::memory_order_release);
    }
};
struct DeviceTrace {
    struct Callback {int64_t frame,frames,begin,end;};
    struct Onset {int voice;int64_t frame;float left,right;int64_t begin,end;};
    struct CueReceipt {uint64_t seq;int voice;int64_t frame;int result;};
    PublishedTrace<Callback,32768> callbacks;
    PublishedTrace<Onset,4096> onsets;
    PublishedTrace<CueReceipt,4096> cues;
};
