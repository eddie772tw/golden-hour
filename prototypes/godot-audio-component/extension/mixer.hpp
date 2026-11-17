#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <span>
#include "oneshot.hpp"
#include "sine.hpp"
#include "device_trace.hpp"

// The audio callback owns this state. Source PCM must outlive the mixer.
class Mixer {
public:
    enum class Shape { lowpass, highpass, bandpass, sine, sine_exp, oneshot };
    struct Layer {
        int voice, id;
        Shape shape;
        double start, offset, rate, hz, q, attack, hold, decay, gain, stop;
        std::span<const float> asset{};
        std::span<const float> right_asset{};
        double source_rate{},ramp_end{},end_hz{};
    };
    struct Ack { int voice; int64_t frame; };
    explicit Mixer(int sample_rate, std::span<const float> noise)
        : sr(sample_rate), pcm(noise) {}
    void set_trace(DeviceTrace* t){trace=t;}
    void set_origin_before_playback(int64_t frame){ origin=frame; }
    int64_t clock() const { return cursor; }

    bool has_voice(int id){return find(id)!=nullptr;}
    bool owns_layer(int voice_id,int layer_id) const{
        for(const auto &s:layers)if(s.v && s.v->id==voice_id && s.p.id==layer_id)return true;
        return false;
    }
    bool voice(int id, double gain) {
        if (id <= 0 || find(id) || !std::isfinite(gain)) return false;
        for (auto &v : voices) if (!v.id) { v = {id,gain}; v.base_gain=gain; return true; }
        return false;
    }
    bool add(const Layer &p) {
        const auto samples=p.asset.empty()?pcm:p.asset;
        auto *v = find(p.voice);
        for(double value:{p.start,p.offset,p.rate,p.hz,p.q,p.attack,p.hold,p.decay,p.gain,p.stop})
            if(!std::isfinite(value)) return false;
        const bool one_shot=p.shape==Shape::oneshot;
        if (!v || p.id<=0 || p.start<cursor ||
            p.stop<p.start || (!one_shot && !(p.attack>0 && p.hold>=0 && p.decay>0 && p.gain>0)) ||
            (!one_shot && !(p.hz>0 && p.hz<sr*.5 && p.q>0)) || !(p.rate>0) || samples.empty() ||
            !(p.offset>=0 && (one_shot || p.offset<samples.size()))) return false;
        for (auto &s : layers) if (s.v && s.p.id==p.id) return false;
        for (auto &s : layers) if (!s.v) {
            s={}; s.v=v; s.p=p; s.p.asset=samples;
            if(one_shot){
                if(!s.shot.init(samples,p.right_asset,p.source_rate,sr,p.start,p.offset/p.source_rate,p.rate)){
                    s.v=nullptr;return false;
                }
                // JS naturalEnd is producer bookkeeping. PCM exhaustion ends native playback.
                s.p.stop=std::numeric_limits<double>::infinity();
                return true;
            }
            if(p.shape==Shape::sine_exp){
                if(!s.sweep.reset(sr,origin+p.start,origin+p.ramp_end,p.hz,p.end_hz)){
                    s.v=nullptr;return false;
                }
                s.p.stop=gh_audio::exclusive_stop_frame(origin+p.stop)-origin;
            }
            const double angle=2*pi*p.hz/sr, c=std::cos(angle);
            const double alpha=std::sin(angle)/(2*(p.shape==Shape::bandpass?p.q:std::pow(10.,p.q/20)));
            const double b=p.shape==Shape::bandpass?alpha:(p.shape==Shape::lowpass?1-c:1+c)/2;
            s.b0=b/(1+alpha); s.b1=(p.shape==Shape::bandpass?0:p.shape==Shape::lowpass?2:-2)*s.b0;
            s.b2=p.shape==Shape::bandpass?-s.b0:s.b0;
            s.a1=-2*c/(1+alpha); s.a2=(1-alpha)/(1+alpha);
            s.p.rate=float(p.rate);
            const double offset=s.p.rate==1?std::round(p.offset):p.offset;
            s.phase=std::fmod(offset+(std::ceil(p.start)-p.start)*s.p.rate,samples.size());
            s.floor=std::max(p.gain*.001,1e-6); s.slope=std::log(s.floor/p.gain)/p.decay;
            return true;
        }
        return false;
    }
    bool fade(int id,double frame,double tau){return set_target(id,frame,tau,0);}
    bool set_target(int id,double frame,double tau,double target) {
        auto *v=find(id);
        if (!v || !std::isfinite(frame) || !std::isfinite(tau) || frame<cursor || !(tau>0)) return false;
        if(!std::isfinite(target) || target<0 || (v->tau && frame>cursor))return false;
        v->gain=v->level_at(frame);
        v->fade=frame;v->tau=tau;v->target=v->base_gain*target;return true;
    }
    // The producer owns IDs until release. Stops on already-ended sources are no-ops.
    bool stop(int voice_id, int id, double frame) {
        if (!std::isfinite(frame) || frame<cursor) return false;
        for (auto &s : layers) if (s.v && s.v->id==voice_id && s.p.id==id) {
            if (!s.done && cursor<s.p.stop) {
                s.p.stop=s.p.shape==Shape::sine_exp ? gh_audio::exclusive_stop_frame(origin+frame)-origin : frame;
                if(s.p.shape==Shape::oneshot)s.shot.stop(frame);
            }
            return true;
        }
        return false;
    }
    bool release(int id,Ack &ack) {
        auto *v=find(id); if (!v) return false;
        for(auto &s:layers) if(s.v==v) s.v=nullptr;
        v->id=0; ack={id,cursor}; return true;
    }
    void mix(std::span<float> dry,std::span<float> victim,int witness,std::span<float> right={}) {
        for(size_t i=0;i<dry.size();++i,++cursor) {
            for(auto &v:voices) v.sample=v.right=0;
            for(auto &s:layers) {
                if (!s.v || s.done || cursor<s.p.start) continue;
                const auto &p=s.p;
                const double age=cursor-p.start;
                double signal=0;
                if(p.shape==Shape::oneshot){
                    float left=0,r=0;
                    if(!s.shot.sample(cursor,left,r)){s.done=true;continue;}
                    s.v->sample+=left*float(p.gain);s.v->right+=r*float(p.gain);
                    continue;
                }
                if(p.shape==Shape::sine || p.shape==Shape::sine_exp) {
                    if(cursor>=p.stop) {s.done=true;continue;}
                    signal=p.shape==Shape::sine_exp?s.sweep.next():std::sin(2*pi*float(p.hz)*(cursor-std::ceil(p.start))/sr);
                } else {
                    float input=0;
                    if(cursor<p.stop) {
                        const auto j=size_t(s.phase);
                        const double left=p.asset[j],right=p.asset[(j+1)%p.asset.size()];
                        input=float(left+(right-left)*(s.phase-j));
                        s.phase=std::fmod(s.phase+p.rate,p.asset.size());
                    } else if(std::abs(s.z1)+std::abs(s.z2)<1e-20) {s.done=true;continue;}
                    signal=s.b0*input+s.z1;
                    s.z1=s.b1*input-s.a1*signal+s.z2; s.z2=s.b2*input-s.a2*signal;
                }
                double env=p.gain;
                if(age<p.attack) env*=age/p.attack;
                else if(age>=p.attack+p.hold+p.decay) env=s.floor;
                else if(age>p.attack+p.hold) env*=std::exp((age-p.attack-p.hold)*s.slope);
                const float value=float(signal)*float(env);
                s.v->sample+=value;s.v->right+=value;
            }
            float sum=0,sum_right=0,tap=0;
            for(auto &v:voices) if(v.id) {
                const bool probe=trace && !v.onset_seen && (v.sample!=0 || v.right!=0);
                const auto before=probe?device_qpc():0;
                const double level=v.level_at(cursor);
                const float value=v.sample*float(level),right_value=v.right*float(level);
                if(probe && (value!=0 || right_value!=0)){
                    const auto after=device_qpc();
                    trace->onsets.append({v.id,cursor,value,right_value,before,after});
                    v.onset_seen=true;
                }
                sum+=value;sum_right+=right_value;
                if(v.id==witness) tap=value;
            }
            dry[i]=sum; victim[i]=tap; if(!right.empty())right[i]=sum_right;
        }
    }
private:
    struct Voice {
        int id{}; double gain{},fade{},tau{},target{},base_gain{}; float sample{},right{}; bool onset_seen{};
        double level_at(double frame) const {
            if(!tau || frame<fade)return gain;
            return target+(gain-target)*std::exp(-(frame-fade)/tau);
        }
    };
    struct State {
        Voice *v{}; Layer p{}; bool done{};
        gh_audio::OneShot shot{};gh_audio::ExpSine sweep{};
        double phase{},b0{},b1{},b2{},a1{},a2{},z1{},z2{},floor{},slope{};
    };
    Voice *find(int id) { for(auto &v:voices) if(v.id==id && id>0) return &v; return nullptr; }
    static constexpr double pi=3.14159265358979323846;
    DeviceTrace* trace=nullptr;
    int sr; std::span<const float> pcm; int64_t cursor=0,origin=0;
    // 72 voice owners and 465 retained layer IDs overlap in the measured full-AI fixture.
    std::array<Voice,128> voices{};
    std::array<State,512> layers{};
};

