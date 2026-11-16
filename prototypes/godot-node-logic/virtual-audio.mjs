// Hardware boundary only. Original eZ/Nb/Dw/cue/voice code remains authoritative.
// Records graph commands; does not synthesize PCM or claim browser audio fidelity.
export class VirtualAudioContext {
  constructor({sampleRate=48000,capacity=20000}={}) {
    this.sampleRate=sampleRate;this.currentTime=0;this.state='running';this.tick=0;
    this.commands=[];this.counts={};this.dropped=0;this.capacity=capacity;
    this.nextID=1;this.sources=new Set();this.buffers=[];
    this.destination=this.node('Destination');this.listener={};
    for(const name of ['positionX','positionY','positionZ','forwardX','forwardY','forwardZ','upX','upY','upZ'])
      this.listener[name]=this.param('listener.'+name,name==='forwardZ'?-1:name==='upY'?1:0);
  }
  record(op,data={}) {this.counts[op]=(this.counts[op]||0)+1;
    if(this.commands.length<this.capacity)this.commands.push({op,tick:this.tick,time:this.currentTime,...data});else this.dropped++;}
  param(id,initial=0) {
    const ctx=this,events=[];let baseline=initial,seq=0;
    const valueAt=time=>{
      let value=baseline,previousTime=0,previousValue=value,active=null;
      const at=t=>active?active.target+(active.initial-active.target)*Math.exp(-(t-active.time)/active.constant):value;
      for(const event of events) {
        if(event.time>time) {
          if(event.kind==='linear'||event.kind==='exponential') {
            const alpha=Math.max(0,Math.min(1,(time-previousTime)/(event.time-previousTime)));
            return event.kind==='linear'?previousValue+(event.value-previousValue)*alpha:
              previousValue*Math.pow(event.value/previousValue,alpha);
          }
          break;
        }
        value=at(event.time);active=null;
        if(event.kind==='target')active={target:event.value,initial:value,time:event.time,constant:event.constant};
        else value=event.value;
        previousTime=event.time;previousValue=value;
      }
      return at(time);
    };
    const add=(kind,value,time,constant)=>{
      if(!Number.isFinite(value)||!Number.isFinite(time)||time<0)throw Error('Invalid audio automation '+id);
      events.push({kind,value,time,constant,seq:seq++});events.sort((a,b)=>a.time-b.time||a.seq-b.seq);
      ctx.record('param.'+kind,{id,value,at:time,...(constant===undefined?{}:{constant})});return api;
    };
    const api={id,get value(){return valueAt(ctx.currentTime);},set value(value){baseline=value;ctx.record('param.value',{id,value});},
      setValueAtTime:(v,t)=>add('set',v,t),linearRampToValueAtTime:(v,t)=>add('linear',v,t),
      exponentialRampToValueAtTime:(v,t)=>{if(v<=0)throw Error('Nonpositive exponential ramp');return add('exponential',v,t);},
      setTargetAtTime:(v,t,c)=>{if(!(c>0))throw Error('Invalid target constant');return add('target',v,t,c);},
      cancelScheduledValues(t){for(let i=events.length-1;i>=0;i--)if(events[i].time>=t)events.splice(i,1);ctx.record('param.cancel',{id,at:t});return api;}
    };
    return api;
  }
  node(kind,params={},properties={}) {
    const ctx=this,id=this.nextID++,data={id,kind,context:this,numberOfInputs:1,numberOfOutputs:1};
    this.record('node.create',{id,kind});
    for(const [key,value]of Object.entries(params))data[key]=this.param(id+'.'+key,value);
    for(const [key,initial]of Object.entries(properties)) {
      let value=initial;Object.defineProperty(data,key,{enumerable:true,get:()=>value,set:v=>{value=v;ctx.record('node.set',{id,key,value:v?.id??(ArrayBuffer.isView(v)?{length:v.length}:v)});}});
    }
    data.connect=(destination,output=0,input=0)=>{ctx.record('connect',{id,to:destination.id??'param',output,input});return destination;};
    data.disconnect=(...args)=>ctx.record('disconnect',{id,all:!args.length});
    data.channelCount=2;data.channelCountMode='max';data.channelInterpretation='speakers';
    return data;
  }
  source(kind,params,properties) {
    const source=this.node(kind,params,{...properties,onended:null});source.started=false;source.ended=false;
    source.start=(when=0,offset=0,duration)=>{
      if(source.started)throw Error('Audio source started twice');source.started=true;source.startAt=Math.max(this.currentTime,when);
      source.naturalEnd=Infinity;
      if(kind==='BufferSource'&&!source.loop&&source.buffer)source.naturalEnd=source.startAt+(duration??Math.max(0,source.buffer.duration-offset))/source.playbackRate.value;
      source.stopAt=source.naturalEnd;
      this.sources.add(source);this.record('start',{id:source.id,at:when,offset,duration});
    };
    source.stop=(when=0)=>{if(!source.started)throw Error('Audio stop before start');source.stopAt=Math.min(source.naturalEnd,Math.max(this.currentTime,when));this.record('stop',{id:source.id,at:when});};
    return source;
  }
  advance(time,tick=this.tick) {
    if(time<this.currentTime)throw Error('Audio time moved backwards');this.tick=tick;
    for(;;) {
      let next=null;for(const s of this.sources)if(s.stopAt<=time&&(!next||s.stopAt<next.stopAt||s.stopAt===next.stopAt&&s.id<next.id))next=s;
      if(!next)break;this.currentTime=Math.max(this.currentTime,next.stopAt);this.sources.delete(next);next.ended=true;
      this.record('ended',{id:next.id});next.onended?.();
    }
    this.currentTime=time;
  }
  createBuffer(channels,length,sampleRate) {
    const id=this.nextID++,arrays=Array.from({length:channels},()=>new Float32Array(length));
    const buffer={id,numberOfChannels:channels,length,sampleRate,duration:length/sampleRate,
      getChannelData(index){if(!arrays[index])throw RangeError('Audio channel');return arrays[index];}};
    this.buffers.push(buffer);this.record('buffer.create',{id,channels,length,sampleRate});return buffer;
  }
  createGain(){return this.node('Gain',{gain:1});}
  createBiquadFilter(){return this.node('BiquadFilter',{frequency:350,detune:0,Q:1,gain:0},{type:'lowpass'});}
  createOscillator(){return this.source('Oscillator',{frequency:440,detune:0},{type:'sine'});}
  createBufferSource(){return this.source('BufferSource',{playbackRate:1,detune:0},{buffer:null,loop:false,loopStart:0,loopEnd:0});}
  createPanner(){return this.node('Panner',{positionX:0,positionY:0,positionZ:0,orientationX:1,orientationY:0,orientationZ:0},
    {panningModel:'equalpower',distanceModel:'inverse',refDistance:1,maxDistance:10000,rolloffFactor:1,coneInnerAngle:360,coneOuterAngle:360,coneOuterGain:0});}
  createStereoPanner(){return this.node('StereoPanner',{pan:0});}
  createChannelMerger(){return this.node('ChannelMerger');}
  createDelay(){return this.node('Delay',{delayTime:0});}
  createWaveShaper(){return this.node('WaveShaper',{}, {curve:null,oversample:'none'});}
  createDynamicsCompressor(){return this.node('DynamicsCompressor',{threshold:-24,knee:30,ratio:12,attack:.003,release:.25});}
  createConvolver(){return this.node('Convolver',{}, {buffer:null,normalize:true});}
  async resume(){this.state='running';}
  snapshot(){return {kind:'recording-hardware-boundary-no-DSP',sampleRate:this.sampleRate,time:this.currentTime,
    commands:this.commands.length,commandDropped:this.dropped,counts:this.counts,pendingSources:this.sources.size,buffers:this.buffers.length};}
}
