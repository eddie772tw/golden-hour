#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include "mixer-bridge.hpp"
#include <bit>
#include <chrono>
#include <cstring>
#include <deque>
#include <fstream>
#include <cstdlib>
#include <string_view>
#include <map>
#include <thread>
#include <vector>

namespace gh_ipc {

using Clock=std::chrono::steady_clock;
inline int64_t now_us(){return std::chrono::duration_cast<std::chrono::microseconds>(Clock::now().time_since_epoch()).count();}
using Request=std::array<double,48>;
using Response=std::array<double,8>;
static_assert(sizeof(Request)==384 && sizeof(Response)==64 && std::endian::native==std::endian::little);

struct AssetView { std::span<const float> left,right; int rate; };

class Worker {
    MixerBridge &bridge_;
    std::thread thread_;
    const bool wake_on_clock_=[] {
        const char* policy=std::getenv("GH_AUDIO_CLOCK_WAKE");
        return !policy || std::string_view(policy)!="timer";
    }();
    const HANDLE clock_event_=CreateEventW(nullptr,FALSE,FALSE,nullptr);
    std::atomic<bool> stop_{false};
    std::array<std::span<const float>,2> noise_{};
    std::map<int,AssetView> assets_;
    int sample_rate_{};

    static bool integer(double value,double max) {
        return std::isfinite(value) && value>=0 && value<=max && value==std::trunc(value);
    }

    bool decode(const Request& r, MixerBridge::Cmd& c) const {
        for(auto v:r)if(!std::isfinite(v))return false;
        if(!integer(r[0],9007199254740991.) || r[0]<1 ||
           !integer(r[1],12) || !integer(r[2],INT_MAX) || r[2]<1)return false;
        c.sequence=uint64_t(r[0]);c.voice=int(r[2]);
        switch(int(r[1])){
            case 11:case 12:{
                if(c.voice>(INT_MAX-16)/16 || !integer(r[4],5) || !integer(r[5],1) ||
                   !integer(r[8],(INT_MAX-16)/16) || !integer(r[9],16) ||
                   (r[8]==0)!=(r[9]==0) || !integer(r[10],32))return false;
                if(!integer(r[43],9007199254740991.) || r[3]!=r[43]/sample_rate_)return false;
                // Opcode 12 is exclusively an untimed external trigger. Its wire anchor
                // and observed frame slots must be empty (zero).
                c.native_invocation=int(r[1])==12;
                if(c.native_invocation && (r[43]!=0 || r[3]!=0))return false;
                c.frame=r[43];c.op=MixerBridge::Op::casing;c.anchor=r[3];c.material=int(r[4]);c.shell=r[5]!=0;
                c.scale=r[6];c.gain=r[7];c.victim=int(r[8]);c.victim_layers=int(r[9]);
                c.draw_count=int(r[10]);std::copy_n(r.begin()+11,c.draw_count,c.draws.begin());
                c.layer.asset=noise_[0];return true;
            }
            case 1:c.op=MixerBridge::Op::voice;c.value=r[3];break;
            case 2:{
                if(!integer(r[3],INT_MAX)||!integer(r[4],3)||!integer(r[15],1))return false;
                auto asset=noise_[size_t(r[15])];if(asset.empty())return false;
                c.op=MixerBridge::Op::layer;
                c.layer={c.voice,int(r[3]),Mixer::Shape(int(r[4])),r[5],r[6],r[7],r[8],r[9],r[10],r[11],r[12],r[13],r[14],asset};
                break;
            }
            case 3:{
                if(!integer(r[3],INT_MAX))return false;
                c.op=MixerBridge::Op::layer;
                c.layer={c.voice,int(r[3]),Mixer::Shape::sine_exp,r[4],0,1,r[5],1,r[8],r[9],r[10],r[11],r[12]};
                c.layer.ramp_end=r[7];c.layer.end_hz=r[6];break;
            }
            case 4:{
                if(!integer(r[3],INT_MAX)||!integer(r[5],INT_MAX))return false;
                const auto it=assets_.find(int(r[5]));if(it==assets_.end())return false;
                const auto& a=it->second;
                c.op=MixerBridge::Op::layer;
                c.layer={c.voice,int(r[3]),Mixer::Shape::oneshot,r[4],r[6],r[7],0,0,0,0,0,r[8],r[9]};
                c.layer.asset=a.left;c.layer.right_asset=a.right;c.layer.source_rate=a.rate;break;
            }
            case 5:c.op=MixerBridge::Op::fade;c.frame=r[3];c.value=r[4];break;
            case 6:c.op=MixerBridge::Op::voice_target;c.frame=r[3];c.value=r[4];c.target_value=r[5];break;
            case 7:
                if(!integer(r[3],INT_MAX))return false;
                c.op=MixerBridge::Op::stop;c.source=int(r[3]);c.frame=r[4];break;
            case 8:c.op=MixerBridge::Op::release;break;
            default:return false;
        }
        return true;
    }

    void fail(int code){error=code;state=-1;}

    void run(int port) {
        WSADATA data{};
        if(int e=WSAStartup(MAKEWORD(2,2),&data)){fail(e);return;}
        struct Resources {
            SOCKET sock=INVALID_SOCKET;
            WSAEVENT event=WSA_INVALID_EVENT;
            HANDLE timer=nullptr;
            ~Resources(){
                if(sock!=INVALID_SOCKET)closesocket(sock);
                if(event!=WSA_INVALID_EVENT)WSACloseEvent(event);
                if(timer)CloseHandle(timer);
                WSACleanup();
            }
        } io;
        io.sock=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);io.event=WSACreateEvent();
        if(io.sock==INVALID_SOCKET || io.event==WSA_INVALID_EVENT ||
            WSAEventSelect(io.sock,io.event,FD_CONNECT|FD_READ|FD_WRITE|FD_CLOSE)==SOCKET_ERROR){fail(WSAGetLastError());return;}
        BOOL yes=TRUE;
        if(setsockopt(io.sock,IPPROTO_TCP,TCP_NODELAY,reinterpret_cast<char*>(&yes),sizeof(yes))==SOCKET_ERROR){fail(WSAGetLastError());return;}
        sockaddr_in addr{};addr.sin_family=AF_INET;addr.sin_addr.s_addr=htonl(INADDR_LOOPBACK);addr.sin_port=htons(port);
        bool connected=connect(io.sock,reinterpret_cast<sockaddr*>(&addr),sizeof(addr))==0;
        if(!connected && WSAGetLastError()!=WSAEWOULDBLOCK){fail(WSAGetLastError());return;}
        io.timer=CreateWaitableTimerExW(nullptr,nullptr,CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,TIMER_ALL_ACCESS);
        if(!io.timer){fail(GetLastError());return;}
        LARGE_INTEGER due{};due.QuadPart=-10000; // 1 ms clock/receipt polling; incoming socket events wake immediately.
        if(!SetWaitableTimer(io.timer,&due,1,nullptr,nullptr,FALSE)){fail(GetLastError());return;}
        HANDLE handles[]={io.event,io.timer,clock_event_};
        bool ready=false,finish=false,blocked=false;
        int64_t last_clock=-1;
        std::array<char,32768> input{};size_t start=0,end=0;
        std::deque<Response> output;size_t sent=0;
        struct Ingress{uint64_t seq;int64_t frame,us;};
        std::deque<Ingress> inflight;
        Ingress pending{};
        struct Admission { uint64_t seq; int64_t before,after; };
        const char* audit_path=std::getenv("GH_AUDIO_ADMISSION_AUDIT");
        const char* timing_path=std::getenv("GH_CASING_TIMING_AUDIT");
        std::vector<std::pair<uint64_t,int64_t>> timestamps;
        if(timing_path)timestamps.reserve(128);
        std::vector<Admission> admissions;
        if(audit_path)admissions.reserve(45328); // Measurement only, reserved before readiness.

        const auto connect_begin=Clock::now();
        while(!stop_.load(std::memory_order_relaxed)){
            auto wake=WaitForMultipleObjects(3,handles,FALSE,100);
            if(wake==WAIT_FAILED){fail(GetLastError());return;}
            if(wake==WAIT_OBJECT_0){
                WSANETWORKEVENTS ev{};
                if(WSAEnumNetworkEvents(io.sock,io.event,&ev)==SOCKET_ERROR){fail(WSAGetLastError());return;}
                if(ev.lNetworkEvents&FD_CONNECT){
                    if(int e=ev.iErrorCode[FD_CONNECT_BIT]){fail(e);return;}
                    connected=true;
                }
            }
            if(!connected){
                if(Clock::now()-connect_begin>std::chrono::seconds(5)){fail(WSAETIMEDOUT);return;}
                continue;
            }
            if(!ready){
                if(bridge_.published()<=0)continue;
                output.push_back({0,double(sample_rate_),double(bridge_.published()),double(now_us())});
                ready=true;state=2;
            }
            const int64_t frame=bridge_.published();
            if(!finish && frame!=last_clock){
                last_clock=frame;clock_packets++;
                output.push_back({1,double(frame),double(now_us())});
            }
            // Read bounded chunks and keep any partial record or unadmitted head intact.
            while(!finish){
                if(end-start<sizeof(Request)){
                    if(start && end>start)std::memmove(input.data(),input.data()+start,end-start);
                    end-=start;start=0;
                    int n=recv(io.sock,input.data()+end,int(input.size()-end),0);
                    if(n==0){fail(WSAECONNRESET);return;}
                    if(n<0){
                        int e=WSAGetLastError();if(e!=WSAEWOULDBLOCK){fail(e);return;}
                        break;
                    }
                    end+=n;
                    if(end<sizeof(Request))continue;
                }
                Request r{};std::memcpy(r.data(),input.data()+start,sizeof(r));
                if(r[1]==9 && integer(r[0],9007199254740991.)){
                    output.push_back({3,r[0],double(bridge_.published()),double(now_us())});
                }else if(r[1]==10){
                    if(!inflight.empty() || blocked){fail(ERROR_INVALID_DATA);return;}
                    finish=true;
                    output.push_back({4,double(bridge_.published()),double(now_us()),double(bridge_.producer_peak_bound()),
                                      double(enqueued.load()),double(acked.load()),double(queue_full.load())});
                }else{
                    MixerBridge::Cmd c{};
                    if(!decode(r,c) || c.sequence!=enqueued.load()+1){
                        // Notify the peer through the ordinary partial-send path before shutdown.
                        output.push_back({5,r[0],double(ERROR_INVALID_DATA)});error=ERROR_INVALID_DATA;finish=true;
                    }else{
                        if(!blocked)pending={c.sequence,bridge_.published(),now_us()};
                        const auto before=audit_path?bridge_.published():0;
                        if(!bridge_.submit(c)){
                            if(!blocked)queue_full++;
                            blocked=true;break;
                        }
                        if(audit_path)admissions.push_back({c.sequence,before,bridge_.published()});
                        inflight.push_back(pending);enqueued++;blocked=false;
                    }
                }
                start+=sizeof(r);
                if(output.size()>=1024)break;
            }
            MixerBridge::Receipt receipt;
            while(output.size()<4096 && bridge_.receive(receipt)){
                if(inflight.empty() || inflight.front().seq!=receipt.sequence){fail(ERROR_INVALID_DATA);return;}
                const auto x=inflight.front();inflight.pop_front();acked++;
                if(timing_path && receipt.callback_us)timestamps.emplace_back(receipt.sequence,receipt.callback_us);
                output.push_back({2,double(receipt.sequence),double(receipt.voice),double(receipt.consumedFrame),double(int(receipt.result)),
                                  double(x.frame),double(x.us),double(now_us())});
            }
            if(output.size()>4096){fail(WSAENOBUFS);return;}
            while(!output.empty()){
                const char* bytes=reinterpret_cast<const char*>(output.front().data());
                int n=send(io.sock,bytes+sent,int(sizeof(Response)-sent),0);
                if(n<=0){
                    int e=WSAGetLastError();if(e!=WSAEWOULDBLOCK){fail(e);return;}
                    break;
                }
                sent+=size_t(n);
                if(sent==sizeof(Response)){output.pop_front();sent=0;}
            }
            if(finish && output.empty()){
                if(timing_path){
                    std::ofstream log(timing_path);
                    for(const auto &[seq,us]:timestamps)log<<seq<<','<<us<<'\n';
                    log.close();if(!log){fail(ERROR_WRITE_FAULT);return;}
                }
                if(audit_path){
                    std::ofstream log(audit_path);
                    for(const auto &a:admissions)log<<a.seq<<','<<a.before<<','<<a.after<<'\n';
                    log.close();
                    if(!log){fail(ERROR_WRITE_FAULT);return;}
                }
                state=error.load()?-1:3;return;
            }
        }
    }

public:
    std::atomic<int> state{},error{};
    std::atomic<uint64_t> enqueued{},acked{},queue_full{},clock_packets{};
    explicit Worker(MixerBridge &bridge):bridge_(bridge){}
    ~Worker(){
        stop_=true;
        if(clock_event_)SetEvent(clock_event_);
        if(thread_.joinable())thread_.join();
        if(clock_event_)CloseHandle(clock_event_);
    }
    // Auto-reset events coalesce. The worker reads the latest atomic sample clock.
    void notify_clock() const {
        if(wake_on_clock_ && state.load(std::memory_order_relaxed)==2)SetEvent(clock_event_);
    }
    bool start(int port,int sr,std::array<std::span<const float>,2> noise,std::map<int,AssetView> assets){
        if(!clock_event_||state.load()!=0||port<1||port>65535)return false;
        noise_=noise;assets_=std::move(assets);sample_rate_=sr;state=1;
        thread_=std::thread([this,port]{run(port);});return true;
    }
};
}
