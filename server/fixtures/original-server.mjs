// Loopback-only protocol fixture, NOT recovered upstream server code. Anonymous
// hello/SDP and weapon indices follow the archived client; simulation is local.
import http from "node:http";
import rtc from "node-datachannel";
import { Room, readInput } from "../room.mjs";

const baseWeapons=["ar","smg","shotgun","pistol"];
const room=new Room("recruit",480000,{progress:()=>({unlocked:baseWeapons})});
const peers=new Set(), feeds=new Set(), evidence={offers:[],hellos:[],equips:[],inputs:0,unexpected:[]};
const listing=()=>"event: rooms\ndata: "+JSON.stringify({type:"rooms",rooms:room.players.some(p=>!p.bot)?[room.summary()]:[]})+"\n\n";
const publish=()=>{for(const res of feeds)res.write(listing());};

function offer(sdp) {
  const pc=new rtc.PeerConnection("original-protocol-fixture",{iceServers:[],bindAddress:"127.0.0.1"});
  const peer={pc,send(e){
    if(e.type==="welcome") e={...e,career:undefined,weapons:e.weapons.filter(w=>baseWeapons.includes(w.id))};
    if(peer.reliable?.isOpen())peer.reliable.sendMessage(JSON.stringify(e)+"\n");
  }};
  peers.add(peer);
  const close=()=>{
    if(!peers.delete(peer))return;
    if(peer.p)peer.p.peer=null;
    pc.close();publish();
  };
  pc.onStateChange(state=>{if(["closed","failed","disconnected"].includes(state))close();});
  pc.onDataChannel(dc=>{
    const lane=dc.getLabel();
    if(!["reliable","state"].includes(lane)||peer[lane]||dc.getProtocol()!=="gh-pvp-v1")return dc.close();
    peer[lane]=dc;dc.onClosed(close);
    dc.onMessage(data=>{
      if(lane==="state"){
        const input=readInput(data);
        if(peer.p&&input&&input.seq>peer.p.input.seq){peer.p.input=input;peer.p.inputAge=0;evidence.inputs++;}
        return;
      }
      const e=JSON.parse(data);
      if(e.type==="hello"){
        evidence.hellos.push(e);
        if(e.ticket||e.profile||e.auth)throw Error("Local credentials sent to original server");
        peer.p=room.join(peer,e);publish();
      }else if(e.type==="leave"){
        if(peer.p)room.remove(peer.p);
        peer.p=null;peer.send({type:"left"});publish();
      }else if(peer.p){
        if(e.type==="equip"){
          evidence.equips.push(e.weapon);
          if(!baseWeapons.includes(e.weapon))throw Error("Shop equip sent to original server");
        }
        room.command(peer.p,e);
      }
    });
  });
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{close();reject(Error("ICE timeout"));},6000);
    pc.onGatheringStateChange(state=>{
      if(state==="complete"){clearTimeout(timeout);resolve(pc.localDescription());}
    });
    try{pc.setRemoteDescription(sdp.sdp,"offer");}
    catch(e){clearTimeout(timeout);close();reject(e);}
  });
}

let last=performance.now(),debt=0;
setInterval(()=>{
  const now=performance.now();debt=Math.min(100,debt+now-last);last=now;
  while(debt>=1000/60){
    debt-=1000/60;room.step();
    if(room.tick%2)continue;
    for(const peer of peers)if(peer.p&&peer.state?.isOpen())peer.state.sendMessageBinary(room.packet(peer.p));
  }
},10);
const server=http.createServer(async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin",process.env.GH_TEST_CLIENT_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
  const json=(status,value)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(value));};
  if(req.method==="OPTIONS")return res.end();
  const path=new URL(req.url,"http://localhost").pathname;
  if(req.headers.authorization){evidence.unexpected.push("Authorization: "+path);return json(403,{});}
  if(path==="/api/config")return json(200,{preferredTransport:"webrtc",rtc:{url:"/api/rtc",iceServers:[]}});
  if(path==="/api/rooms/events"){
    res.writeHead(200,{"Content-Type":"text/event-stream"});res.write(listing());feeds.add(res);
    res.on("close",()=>feeds.delete(res));return;
  }
  if(path==="/api/rtc"&&req.method==="POST"){
    evidence.offers.push({authorization:req.headers.authorization??null});
    let body="";for await(const chunk of req){body+=chunk;if(body.length>65536)return json(413,{});}
    try{return json(200,await offer(JSON.parse(body)));}catch(e){return json(400,{error:e.message});}
  }
  if(path==="/test/evidence")return json(200,evidence);
  evidence.unexpected.push(path);json(404,{});
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
console.log("http://127.0.0.1:"+server.address().port);
