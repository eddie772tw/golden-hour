#pragma once
#include "../extension/mixer.hpp"
#include <climits>

namespace gh_casing {

struct Cue {
    int voice{}, material{};
    bool shell{};
    double gain{}, anchor_seconds{}, time_scale{};
    std::span<const double> draws{};
};
struct Expansion {
    std::array<Mixer::Layer,16> layers{};
    size_t count{};
    double end_frame{};
};
enum class Result { applied, late, invalid, internal };

// anchor_seconds is the original currentTime; origin_frames maps its sample domain
// to the mixer's local clock. A later delivery never moves the original target.
inline bool expand(const Cue& cue, int sr, std::span<const float> white,
                   double origin_frames, Expansion& out) {
    out={};
    if(cue.voice<1 || cue.voice>(INT_MAX-16)/16 || cue.material<0 || cue.material>5 ||
       sr<=0 || white.empty() || !(cue.time_scale>0) || !std::isfinite(cue.time_scale) ||
       !std::isfinite(cue.gain) || !std::isfinite(cue.anchor_seconds) || cue.anchor_seconds<0 ||
       !std::isfinite(origin_frames) || cue.draws.size()>32)return false;
    for(double u:cue.draws)if(!(u>=0 && u<1))return false;
    size_t n=0;
    bool valid=true;
    auto uniform=[&](){
        if(n==cue.draws.size()){valid=false;return 0.;}
        return cue.draws[n++];
    };
    auto range=[&](double lo,double hi){return lo+(hi-lo)*uniform();};
    const double rate=cue.time_scale*range(.9,1.12), stretch=1/std::sqrt(cue.time_scale);
    const double base=cue.anchor_seconds+.003;
    auto frames=[&](double seconds){return seconds*sr+origin_frames;};
    auto frequency=[&](double hz){return std::clamp(hz*rate,20.,sr*.45);};
    out.end_frame=frames(base+.1);
    double delay=0, strength=1;
    auto layer=[&](Mixer::Shape shape,double hz,double q,double attack,double decay,double gain,
                   double end_hz=0,double ramp_time=0){
        const double start=base+delay*stretch, peak=start+attack, end=peak+decay*stretch;
        const bool noise=shape<=Mixer::Shape::bandpass;
        if(out.count==out.layers.size()){valid=false;return;}
        const int id=cue.voice*16+int(out.count)+1;
        auto& p=out.layers[out.count++];
        p={cue.voice,id,shape,frames(start),0,1,frequency(hz),q,
           (peak-start)*sr,0,(end-peak)*sr,gain,frames(end+.03)};
        if(noise){
            const double raw=start*sr, snapped=std::round(raw);
            if(std::abs(raw-snapped)<1e-8)p.start=snapped+origin_frames;
            p.rate=std::clamp(rate,.05,8.);
            p.offset=uniform()*std::max(0.,double(white.size())/sr-.1)*sr;
            p.asset=white;
        } else if(end_hz>0){
            p.end_hz=frequency(end_hz);
            p.ramp_end=frames(start+ramp_time*stretch);
        }
        out.end_frame=std::max(out.end_frame,frames(end+.08));
    };
    using S=Mixer::Shape;
    auto partials=[&](double base_hz,std::initializer_list<double> ratios,double gain,double decay){
        int index=0;
        for(double ratio:ratios){
            layer(S::sine,base_hz*ratio*range(.995,1.005),1,.0006,
                  decay/(1+index*.55),gain/(1+index*.7));
            ++index;
        }
    };
    if(cue.material==5){
        layer(S::sine_exp,600,1,.001,.06,.6,240,.05);
        layer(S::bandpass,2200,1,.003,.05,.5);
    }else{
        const bool wood=cue.material==1, soft=cue.material==4;
        const int bounces=soft?1:(uniform()<.65?2:1);
        for(int b=0;b<bounces;++b){
            if(cue.shell){
                layer(S::bandpass,wood?620:900,3,.0005,wood?.035:.028,2.2*strength);
                layer(S::sine_exp,wood?420:700,1,.001,.035,.5*strength,wood?300:520,.035);
                if(!soft && !wood)layer(S::sine,2900*range(.95,1.05),1,.0005,.03,.15*strength);
                if(wood)layer(S::bandpass,240,4,.0006,.05,2.5*strength);
            }else if(soft){
                layer(S::lowpass,1500,.7,.0005,.02,1.4*strength);
            }else{
                const double decay=wood?range(.018,.03):(cue.material==2?range(.13,.2):range(.07,.11));
                const double hz=range(3900,4700)*(b?1.06:1);
                partials(hz,{1,1.46,1.98,2.71},.5*strength*(wood?.6:1),decay);
                layer(S::highpass,6000,.7,.0004,.006,.4*strength);
                if(wood){
                    layer(S::bandpass,380,4,.0006,.04,3*strength);
                    layer(S::bandpass,900,3,.0006,.02,strength);
                }
                if(cue.material==3)partials(range(900,1500),{1,2.32,3.9},.25*strength,.12);
            }
            delay+=range(.045,.1);
            strength*=range(.35,.55);
        }
    }
    return valid && n==cue.draws.size() && std::isfinite(out.end_frame);
}

inline Result apply(Mixer& mixer,const Cue& cue,const Expansion& out) {
    if(!out.count || out.count>out.layers.size())return Result::invalid;
    for(size_t i=0;i<out.count;++i)if(out.layers[i].start<mixer.clock())return Result::late;
    if(!mixer.voice(cue.voice,cue.gain))return Result::invalid;
    for(size_t i=0;i<out.count;++i)if(!mixer.add(out.layers[i])){
        Mixer::Ack ack{};
        mixer.release(cue.voice,ack); // discard every layer allocated by this call
        return Result::invalid;
    }
    return Result::applied;
}

inline Result steal(Mixer& mixer,int victim,std::span<const int> source_ids,
                    double fade_frame,double stop_frame,double tau_frames) {
    if(fade_frame<mixer.clock() || stop_frame<mixer.clock())return Result::late;
    if(!mixer.fade(victim,fade_frame,tau_frames))return Result::invalid;
    for(int id:source_ids)if(!mixer.stop(victim,id,stop_frame))return Result::internal;
    return Result::applied;
}
}
