#include "tcp_worker.hpp"
#include <map>
#include <memory>
#include <godot_cpp/classes/audio_frame.hpp>
#include <godot_cpp/classes/audio_stream.hpp>
#include <godot_cpp/classes/audio_stream_playback.hpp>
#include <godot_cpp/classes/audio_server.hpp>
#include <godot_cpp/godot.hpp>
using namespace godot;
struct SampleAsset {PackedFloat32Array left,right;int rate;};
using AssetBank=std::map<int64_t,SampleAsset>;

class GHProofPlayback : public AudioStreamPlayback {
    GDCLASS(GHProofPlayback,AudioStreamPlayback)
    std::array<float,4> pcm{0.5f,0.25f,-0.5f,-0.25f};
    int sr=int(AudioServer::get_singleton()->get_mix_rate());
    DeviceTrace trace;
    MixerBridge bridge{sr,pcm};
    std::array<float,256> dry{},right{},tap{};
    std::atomic<bool> playing{};
    bool submitted=false;
    std::atomic<int> callbacks{}, last_frames{}, peak_frames{};
    std::atomic<int64_t> first_signal{-1},last_signal{-1},nonzero{};
    PackedFloat32Array assets[2];
    std::shared_ptr<const AssetBank> bank;
    std::vector<float> captured;
    std::atomic<bool> capture_enabled{};
    std::atomic<int> capture_count{};
    gh_ipc::Worker ipc{bridge};
protected:
    static void _bind_methods(){
        ClassDB::bind_method(D_METHOD("submit_record","record"),&GHProofPlayback::submit_record);
        ClassDB::bind_method(D_METHOD("start_ipc","port"),&GHProofPlayback::start_ipc);
        ClassDB::bind_method(D_METHOD("device_trace"),&GHProofPlayback::device_trace);
        ClassDB::bind_method(D_METHOD("device_calibration"),&GHProofPlayback::device_calibration);
        ClassDB::bind_method(D_METHOD("capture_pcm"),&GHProofPlayback::capture_pcm);
        ClassDB::bind_method(D_METHOD("ipc_stats"),&GHProofPlayback::ipc_stats);
        ClassDB::bind_method(D_METHOD("receipt"),&GHProofPlayback::receipt);
        ClassDB::bind_method(D_METHOD("callback_stats"),&GHProofPlayback::callback_stats);
        ClassDB::bind_method(D_METHOD("queue_probe"),&GHProofPlayback::queue_probe);
        ClassDB::bind_method(D_METHOD("sample_clock"),&GHProofPlayback::sample_clock);
        ClassDB::bind_method(D_METHOD("take_receipt"),&GHProofPlayback::take_receipt);
    }
public:
    GHProofPlayback(){bridge.set_trace(&trace);}
    Dictionary device_calibration() const {
        Dictionary d;
        const auto before=device_qpc();
        const auto worker=gh_ipc::now_us();
        const auto tick=GetTickCount64();
        const auto after=device_qpc();
        d["qpc_before"]=before;d["qpc_after"]=after;d["worker_us"]=worker;d["tick_ms"]=int64_t(tick);
        return d;
    }
    Dictionary device_trace() const {
        Dictionary d;
        LARGE_INTEGER frequency{};
        QueryPerformanceFrequency(&frequency);
        d["qpc_frequency"]=int64_t(frequency.QuadPart);
        d["clock"]="QueryPerformanceCounter";
        Array callbacks,voices,cues;
        const size_t count=trace.callbacks.count.load(std::memory_order_acquire);
        for(size_t i=0;i<count;++i){
            const auto& r=trace.callbacks.entries[i];
            callbacks.push_back(Array::make(r.frame,r.frames,r.begin,r.end));
        }
        const size_t onset_count=trace.onsets.count.load(std::memory_order_acquire);
        for(size_t i=0;i<onset_count;++i){
            const auto& r=trace.onsets.entries[i];
            voices.push_back(Array::make(r.voice,r.frame,r.left,r.right,r.begin,r.end));
        }
        const size_t cue_count=trace.cues.count.load(std::memory_order_acquire);
        for(size_t i=0;i<cue_count;++i){
            const auto& r=trace.cues.entries[i];
            cues.push_back(Array::make(int64_t(r.seq),r.voice,r.frame,r.result));
        }
        d["callbacks"]=callbacks;d["voices"]=voices;d["cue_receipts"]=cues;
        d["callback_overflow"]=trace.callbacks.overflow.load();d["onset_overflow"]=trace.onsets.overflow.load();
        d["cue_overflow"]=trace.cues.overflow.load();
        return d;
    }
    void set_assets(const PackedFloat32Array &a,const PackedFloat32Array &b){assets[0]=a;assets[1]=b;}
    void set_origin_before_playback(int64_t frame){bridge.set_origin_before_playback(frame);}
    void use_bank(std::shared_ptr<const AssetBank> immutable){bank=std::move(immutable);}
    Array callback_stats() const{return Array::make(callbacks.load(),last_frames.load(),peak_frames.load(),int64_t(bridge.producer_peak_bound()),first_signal.load(),last_signal.load(),nonzero.load());}
    bool start_ipc(int port){
        if(!bank || !playing || submitted || bridge.producer_peak_bound()!=0 || ipc.state!=0)return false;
        std::array<std::span<const float>,2> noise;
        for(int i=0;i<2;++i)noise[i]={assets[i].ptr(),size_t(assets[i].size())};
        std::map<int,gh_ipc::AssetView> views;
        for(const auto &[id,a]:*bank){
            if(id<0 || id>INT_MAX)return false;
            views.emplace(int(id),gh_ipc::AssetView{{a.left.ptr(),size_t(a.left.size())},{a.right.ptr(),size_t(a.right.size())},a.rate});
        }
        captured.resize(2*sr*5);
        capture_enabled.store(true,std::memory_order_release);
        return ipc.start(port,sr,noise,std::move(views));
    }
    PackedByteArray capture_pcm() const {
        // Only read the published prefix; the audio thread appends to different elements.
        const int n=capture_count.load(std::memory_order_acquire);
        PackedByteArray bytes;
        bytes.resize(n*2*sizeof(float));
        if(n)std::memcpy(bytes.ptrw(),captured.data(),n*2*sizeof(float));
        return bytes;
    }
    Array ipc_stats()const{
        return Array::make(ipc.state.load(),int64_t(ipc.enqueued.load()),int64_t(ipc.acked.load()),int64_t(ipc.queue_full.load()),int64_t(ipc.clock_packets.load()),ipc.error.load(),gh_ipc::now_us());
    }
    Array receipt(){
        if(ipc.state!=0)return {};
        MixerBridge::Receipt r;
        if(!bridge.receive(r))return {};
        return Array::make(int64_t(r.sequence),r.voice,r.consumedFrame,int(r.result));
    }
    bool submit_record(const Array &r){
        if(ipc.state!=0 || r.size()<3)return false;
        MixerBridge::Cmd c{};c.sequence=int64_t(r[0]);String op=r[1];c.voice=int64_t(r[2]);
        if(op=="voice" && r.size()==4){c.op=MixerBridge::Op::voice;c.value=r[3];}
        else if(op=="layer" && r.size()==16){
            int shape=int64_t(r[4]),asset=int64_t(r[15]);
            if(shape<0 || shape>3 || asset<0 || asset>1 || assets[asset].is_empty())return false;
            c.op=MixerBridge::Op::layer;
            c.layer={c.voice,int(int64_t(r[3])),Mixer::Shape(shape),r[5],r[6],r[7],r[8],r[9],r[10],r[11],r[12],r[13],r[14],
                {assets[asset].ptr(),size_t(assets[asset].size())}};
        }else if(op=="sineExp" && r.size()==13){
            c.op=MixerBridge::Op::layer;
            c.layer={c.voice,int(int64_t(r[3])),Mixer::Shape::sine_exp,r[4],0,1,r[5],1,r[8],r[9],r[10],r[11],r[12]};
            c.layer.ramp_end=r[7];c.layer.end_hz=r[6];
        }else if(op=="oneshot" && r.size()==10 && bank){
            auto it=bank->find(int64_t(r[5]));
            if(it==bank->end())return false;
            const auto &a=it->second;
            c.op=MixerBridge::Op::layer;
            c.layer={c.voice,int(int64_t(r[3])),Mixer::Shape::oneshot,r[4],r[6],r[7],0,0,0,0,0,r[8],r[9]};
            c.layer.asset={a.left.ptr(),size_t(a.left.size())};
            c.layer.right_asset={a.right.ptr(),size_t(a.right.size())};
            c.layer.source_rate=a.rate;
        }else if(op=="fade" && r.size()==5){c.op=MixerBridge::Op::fade;c.frame=r[3];c.value=r[4];}
        else if(op=="voiceTarget" && r.size()==6){c.op=MixerBridge::Op::voice_target;c.frame=r[3];c.value=r[4];c.target_value=r[5];}
        else if(op=="stop" && r.size()==5){c.op=MixerBridge::Op::stop;c.source=int64_t(r[3]);c.frame=r[4];}
        else if(op=="release" && r.size()==3)c.op=MixerBridge::Op::release;
        else return false;
        return bridge.submit(c);
    }
    bool queue_probe(){
        if(ipc.state!=0 || submitted)return false;
        submitted=true;
        const auto start=bridge.published()+256;
        MixerBridge::Cmd c{2,MixerBridge::Op::layer,1};
        c.layer={1,1,Mixer::Shape::bandpass,double(start)+.25,0,.97,1700,1.4,48,96,2400,.65,double(start)+4000};
        return bridge.submit({1,MixerBridge::Op::voice,1,0,{},0,1}) && bridge.submit(c);
    }
    int64_t sample_clock() const {return bridge.published();}
    int64_t take_receipt(){
        if(ipc.state!=0)return 0;
        MixerBridge::Receipt r;
        if(!bridge.receive(r))return 0;
        return r.result==MixerBridge::Result::applied?int64_t(r.sequence):-int64_t(r.sequence);
    }
    void _start(double) override {playing.store(true);}
    void _stop() override {playing.store(false);}
    bool _is_playing() const override{return playing.load();}
    double _get_playback_position() const override{return double(sample_clock())/sr;}
    int32_t _mix(AudioFrame *out,float rate_scale,int32_t frames) override {
        if(!playing.load() || rate_scale!=1.f)return 0;
        const auto qpc_begin=device_qpc();
        callbacks.fetch_add(1);last_frames.store(frames);
        if(frames>peak_frames.load())peak_frames.store(frames);
        const auto block_start=bridge.published();
        int offset=0,first=-1,last=-1,count=0;
        while(offset<frames){
            size_t n=std::min<int>(dry.size(),frames-offset);
            bridge.mix({dry.data(),n},{tap.data(),n},1,{right.data(),n});
            ipc.notify_clock();
            if(capture_enabled.load(std::memory_order_acquire)){
                const auto start=block_start+offset;
                const auto end=std::min<int64_t>(start+n,captured.size()/2);
                for(int64_t j=start;j<end;++j){
                    captured[2*j]=dry[j-start];captured[2*j+1]=right[j-start];
                }
                if(start<end)capture_count.store(int(end),std::memory_order_release);
            }
            for(size_t i=0;i<n;++i){
                out[offset+i]={dry[i],right[i]};
                if(std::max(std::abs(dry[i]),std::abs(right[i]))>1e-7){
                    if(first<0)first=offset+int(i);
                    last=offset+int(i);++count;
                }
            }
            offset+=int(n);
        }
        if(count){
            if(first_signal.load()<0)first_signal.store(block_start+first);
            last_signal.store(block_start+last);nonzero.fetch_add(count);
        }
        trace.callbacks.append({block_start,frames,qpc_begin,device_qpc()});
        return frames;
    }
};

class GHProofStream : public AudioStream {
    GDCLASS(GHProofStream,AudioStream)
    std::shared_ptr<AssetBank> bank=std::make_shared<AssetBank>();
    mutable bool sealed=false;
    PackedFloat32Array assets[2];
protected:
    static void _bind_methods(){
        ClassDB::bind_method(D_METHOD("instantiate_at_origin","frame"),&GHProofStream::instantiate_at_origin);
        ClassDB::bind_method(D_METHOD("register_asset","id","hz","left","right"),&GHProofStream::register_asset);
        ClassDB::bind_method(D_METHOD("set_assets","casing","noise"),&GHProofStream::set_assets);}
public:
    void set_assets(const PackedFloat32Array &a,const PackedFloat32Array &b){assets[0]=a;assets[1]=b;}
    bool register_asset(int64_t id,int hz,const PackedFloat32Array &left,const PackedFloat32Array &right){
        if(sealed || id<0 || hz<=0 || left.is_empty() || (!right.is_empty() && left.size()!=right.size()))return false;
        return bank->emplace(id,SampleAsset{left,right,hz}).second;
    }
    Ref<AudioStreamPlayback> instantiate_at_origin(int64_t frame) const {
        if(frame<0 || frame>9007199254740991LL)return {};
        Ref<GHProofPlayback> playback; playback.instantiate();sealed=true;
        playback->set_origin_before_playback(frame);playback->set_assets(assets[0],assets[1]);playback->use_bank(bank);
        return playback;
    }
    Ref<AudioStreamPlayback> _instantiate_playback() const override {return instantiate_at_origin(0);}
    String _get_stream_name() const override {return "GH dry audio proof";}
};

static void init(ModuleInitializationLevel level){
    if(level==MODULE_INITIALIZATION_LEVEL_SCENE){
        GDREGISTER_CLASS(GHProofPlayback);
        GDREGISTER_CLASS(GHProofStream);
    }
}
static void finish(ModuleInitializationLevel){}
extern "C" GDExtensionBool GDE_EXPORT gh_audio_init(GDExtensionInterfaceGetProcAddress get,GDExtensionClassLibraryPtr lib,GDExtensionInitialization *config){
    GDExtensionBinding::InitObject binding(get,lib,config);
    binding.register_initializer(init);binding.register_terminator(finish);
    binding.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
    return binding.init();
}

