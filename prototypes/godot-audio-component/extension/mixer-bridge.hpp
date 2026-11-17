#pragma once
#include "mixer.hpp"
#include "../native/casing.hpp"
#include <atomic>
#include <chrono>

// One bridge producer, one audio consumer. ID reuse requires an applied release ACK.
template<class T,size_t Capacity> class Pipe {
    std::array<T,Capacity+1> data{};
    std::atomic<size_t> read{0},write{0};
public:
    size_t queued() const{return (write.load()+data.size()-read.load())%data.size();}
    bool full() const { return (write.load()+1)%data.size()==read.load(); }
    bool push(const T &v) {
        auto pos=write.load(std::memory_order_relaxed), next=(pos+1)%data.size();
        if(next==read.load(std::memory_order_acquire))return false;
        data[pos]=v; write.store(next,std::memory_order_release); return true;
    }
    bool pop(T &v) {
        auto pos=read.load(std::memory_order_relaxed);
        if(pos==write.load(std::memory_order_acquire))return false;
        v=data[pos];read.store((pos+1)%data.size(),std::memory_order_release);return true;
    }
};

class MixerBridge {
public:
    enum class Op {voice,layer,fade,stop,release,voice_target,casing};
    struct Cmd {
        uint64_t sequence{}; Op op{}; int voice{},source{};
        Mixer::Layer layer{};
        double frame{},value{},target_value{};
        int material{}, draw_count{}, victim{}, victim_layers{};
        bool shell{},native_invocation{};
        double anchor{}, scale{}, gain{};
        std::array<double,32> draws{};
    };
    enum class Result {applied,late,invalid,sequenceGap};
    struct Receipt {uint64_t sequence{};int voice{};int64_t consumedFrame{};Result result{};int64_t callback_us{};};
    MixerBridge(int sr,std::span<const float> pcm):mixer(sr,pcm),rate(sr){}
    void set_trace(DeviceTrace* t){trace=t;mixer.set_trace(t);}
    void set_origin_before_playback(int64_t frame){mixer.set_origin_before_playback(frame);}
    bool submit(const Cmd &cmd){
        // The single producer can commit this record if the sampled queue has room.
        auto count=commands.queued();
        if(!commands.push(cmd))return false;
        if(count+1>peak_submitted.load(std::memory_order_relaxed))peak_submitted.store(std::min(capacity,count+1),std::memory_order_relaxed);
        return true;
    }
    size_t producer_peak_bound() const{return peak_submitted;}
    bool receive(Receipt &r){return replies.pop(r);}
    int64_t published() const{return clock.load(std::memory_order_acquire);}
    void mix(std::span<float> dry,std::span<float> witness,int victim,std::span<float> right={}) {
        // Bound work per callback. Leave unacknowledgeable commands in the input FIFO.
        for(size_t n=0;n<capacity && !replies.full();++n){
            Cmd c;
            if(!commands.pop(c))break;
            const auto callback_us=c.op==Op::casing?std::chrono::duration_cast<std::chrono::microseconds>(
                std::chrono::steady_clock::now().time_since_epoch()).count():0;
            Result result=Result::invalid;
            if(c.sequence!=expected)result=Result::sequenceGap;
            else{
                ++expected;
                const double target=c.op==Op::layer?c.layer.start:c.frame;
                if((c.op==Op::layer||c.op==Op::fade||c.op==Op::voice_target||c.op==Op::stop) && target<mixer.clock())result=Result::late;
                else {
                    bool ok=false;
                    switch(c.op){
                        case Op::casing:{
                            if(recipe_fault)break;
                            gh_casing::Cue cue{};
                            cue.voice=c.voice;cue.material=c.material;cue.shell=c.shell;cue.gain=c.gain;
                            const double anchor=c.native_invocation?double(mixer.clock())/rate:c.anchor;
                            cue.anchor_seconds=anchor;cue.time_scale=c.scale;
                            cue.draws={c.draws.data(),size_t(c.draw_count)};
                            gh_casing::Expansion plan{};
                            if(!gh_casing::expand(cue,rate,c.layer.asset,0,plan))break;
                            const double fade=c.native_invocation?double(mixer.clock()):c.frame;
                            const double stop=std::ceil((anchor+.008*7)*rate);
                            std::array<int,16> victim_ids{};
                            if(c.victim){
                                if(fade<mixer.clock()){result=Result::late;break;}
                                if(!mixer.has_voice(c.victim))break;
                                bool owns=true;
                                for(int i=0;i<c.victim_layers;++i){
                                    victim_ids[i]=c.victim*16+i+1;
                                    owns &= mixer.owns_layer(c.victim,victim_ids[i]);
                                }
                                if(!owns)break;
                            }
                            const auto state=gh_casing::apply(mixer,cue,plan);
                            if(state==gh_casing::Result::late){result=Result::late;break;}
                            if(state!=gh_casing::Result::applied)break;
                            if(c.victim && !apply_victim(c.victim,victim_ids,c.victim_layers,fade,stop)){
                                recipe_fault=true;break;
                            }
                            ok=true;break;
                        }
                        case Op::voice:ok=mixer.voice(c.voice,c.value);break;
                        case Op::layer:ok=c.voice==c.layer.voice && mixer.add(c.layer);break;
                        case Op::fade:ok=mixer.fade(c.voice,c.frame,c.value);break;
                        case Op::stop:ok=mixer.stop(c.voice,c.source,c.frame);break;
                        case Op::voice_target:ok=mixer.set_target(c.voice,c.frame,c.value,c.target_value);break;
                        case Op::release:{Mixer::Ack ack;ok=mixer.release(c.voice,ack);break;}
                    }
                    if(ok)result=Result::applied;
                }
            }
            if(trace && c.op==Op::casing)trace->cues.append({c.sequence,c.voice,mixer.clock(),int(result)});
            replies.push({c.sequence,c.voice,mixer.clock(),result,callback_us});
        }
        mixer.mix(dry,witness,victim,right);
        clock.store(mixer.clock(),std::memory_order_release);
    }
private:
    static constexpr size_t capacity=512; // Largest same-frame batch in the fixture has 423 records.
    DeviceTrace* trace=nullptr;
    Mixer mixer;
    const int rate;
    bool recipe_fault=false;
    bool apply_victim(int victim,const std::array<int,16>& ids,int count,double fade,double stop){
        if(!mixer.fade(victim,fade,.008*rate))return false;
        for(int i=0;i<count;++i)if(!mixer.stop(victim,ids[i],stop))return false;
        return true;
    }
    Pipe<Cmd,capacity> commands;
    Pipe<Receipt,capacity> replies;
    std::atomic<int64_t> clock{};
    uint64_t expected=1;
    std::atomic<size_t> peak_submitted{};
};
