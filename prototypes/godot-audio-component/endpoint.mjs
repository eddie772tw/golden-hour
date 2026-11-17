const types = ["Gain","BiquadFilter","BufferSource","Oscillator","ChannelMerger","Delay"];
const attrs = ["buffer","loop","type"];
const params = ["gain","frequency","Q","playbackRate","delayTime"];
const automation = ["setValueAtTime","linearRampToValueAtTime","exponentialRampToValueAtTime","cancelScheduledValues","setTargetAtTime"];
const nodeOps = ["connect","start","stop","disconnect"];

export function endpoint() {
  const commands = [], nodes = new Map(), ids = new Map();
  const ctx = {currentTime:0}, white = {duration:3};
  ids.set(white,"white");
  function make(id) {
    const node = {};
    nodes.set(id,node);
    ids.set(node,id);
    function args(list) {return list.map(x => ids.has(x) ? {ref:ids.get(x)} : x);}
    for (const key of attrs) Object.defineProperty(node,key,{set(v){commands.push(["attr",id,key,...args([v])]);}});
    for (const key of params) {
      const p = node[key] = {};
      Object.defineProperty(p,"value",{set(v){commands.push(["value",id,key,v]);}});
      for (const op of automation) p[op]=(...a)=>{commands.push(["param",id,key,op,...a]);};
    }
    for (const op of nodeOps) node[op]=(...a)=>{commands.push(["node",id,op,...args(a)]);};
    return node;
  }
  let next=1;
  for(const type of types) ctx["create"+type]=()=>{
    const id=next++;
    commands.push(["create",id,type]);
    return make(id);
  };
  const bus=make("sfx"), rev=make("reverb");
  return {ctx,white,bus,rev,nodes,ids,commands};
}
