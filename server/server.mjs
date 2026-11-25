import { X509Certificate } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { admission } from "./admission.mjs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Career, profileID } from "./career.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import rtc from "node-datachannel";
import { Room, readInput } from "./room.mjs";
import { builtinMap, loadMapCatalog } from "./maps.mjs";
import { acceptsMap, findTdmRoom, selectTdmMap } from "./room-content.mjs";
import { COOP_MODE, CoopRoom } from "./coop-room.mjs";
import { originalGateway } from "./original-gateway.mjs";

const port=Number(process.env.GH_DEV_PORT || 48722), host=process.env.GH_BIND_IP || "127.0.0.1";
const tls=process.env.GH_TLS_KEY ? {key:await readFile(process.env.GH_TLS_KEY),cert:await readFile(process.env.GH_TLS_CERT)} : null;
if (!tls && host!=="127.0.0.1") throw Error("A LAN server requires TLS");
const origin=(tls?"https://":"http://")+host+":"+port, game=fileURLToPath(new URL("../game",import.meta.url));
const duration=Number(process.env.GH_ROUND_SECONDS || 480)*1000;
if (!Number.isInteger(duration) || duration<1000 || duration>3600000) throw Error("GH_ROUND_SECONDS must be 1..3600");
const database = process.env.GH_CAREER_DB || fileURLToPath(new URL("./.local/career.sqlite",import.meta.url));
mkdirSync(dirname(database), {recursive:true});
const career = new Career(database);
const pin=tls ? new X509Certificate(tls.cert).fingerprint256.replaceAll(":","").toLowerCase() : "loopback";
const auth=await admission(career,pin);
const rooms=new Map(), feeds=new Set(), peers=new Set();
const maps=loadMapCatalog(resolve(game,"assets/maps"));
const communityMaps={ protocol:1, maps:[...maps.values()].map(map=>map.ref) };
const listing=()=>"event: rooms\ndata: "+JSON.stringify({type:"rooms",rooms:[...rooms.values()].map(r=>r.summary())})+"\n\n";
function publish() { for (const res of feeds) res.write(listing()); }
function remove(room,p) {
  room.remove(p);
  if (room.players.every(q=>q.bot)) rooms.delete(room.id);
  publish();
}
function signal(offer,ticket,signed) {
  if (offer?.type!=="offer" || typeof offer.sdp!=="string" || !offer.sdp.includes("m=application")) throw Error("expected data-channel offer");
  const pc=new rtc.PeerConnection("Golden Hour local",{iceServers:[],bindAddress:host,maxMessageSize:16384,...(tls?{portRangeBegin:49100,portRangeEnd:49200}:{})});
  const peer={pc,send(event) {
    const dc=peer.reliable;
    if (dc?.isOpen()) dc.sendMessage(JSON.stringify(event)+"\n");
  }};
  peers.add(peer);
  function detach(leave) {
    const {room,p}=peer;
    if (!p || p.peer!==peer) return;
    peer.room=peer.p=null; p.peer=null; p.input.forward=p.input.right=p.input.buttons=0;
    if (leave) remove(room,p);
    else {
      p.expiry=setTimeout(()=>remove(room,p),10000); room.roster();
    }
  }
  function close() {
    if (!peers.delete(peer)) return;
    clearTimeout(idle); detach(false); pc.close();
  }
  const idle=setTimeout(close,15000);
  pc.onStateChange(s=>{ if (["closed","failed","disconnected"].includes(s)) close(); });
  pc.onDataChannel(dc=>{
    const lane=dc.getLabel();
    if (!["reliable","state"].includes(lane) || peer[lane] || dc.getProtocol()!=="gh-pvp-v1") { dc.close(); return; }
    peer[lane]=dc; dc.onClosed(close);
    dc.onMessage(data=>{
      if (lane==="state") {
        const input=readInput(data), p=peer.p;
        if (p && input && input.seq>p.input.seq) { p.input=input; p.inputAge=0; }
        return;
      }
      try {
        if (typeof data!=="string" || data.length>16384) throw Error("error.command");
        const e=JSON.parse(data);
        if (e?.type==="hello" && !peer.p) {
          if (!ticket || e.ticket!==ticket) throw Error("error.profile");
          ticket=null;
          for(const r of rooms.values()) if(r.players.some(p=>p.profile===signed.id && (p.peer || !e.resume || e.room!==r.id))) throw Error("error.profile");
          e.name=signed.name;
          let room;
          if (e.room) room=rooms.get(e.room);
          else if (!e.resume && (e.create===true || e.quick===true)) {
            const coop = e.modeId === COOP_MODE;
            if (coop && (e.coopProtocol !== 1 || !acceptsMap(e,builtinMap,COOP_MODE)))
              throw Error("error.coop_unsupported");
            const map = coop ? builtinMap : selectTdmMap(maps,e);
            if (e.quick) room = coop
              ? [...rooms.values()].find(r=>r.modeId===COOP_MODE && r.summary().joinable)
              : findTdmRoom(rooms.values(),map);
            if (!room) {
              const difficulty=["recruit","regular","hardened","veteran"].includes(e.difficulty)?e.difficulty:"regular";
              room=coop ? new CoopRoom(difficulty,duration,career) : new Room(difficulty,duration,career,{map});
              rooms.set(room.id,room);
            }
          }
          if (!room) throw Error("error.room_missing");
          if (room.modeId===COOP_MODE && e.coopProtocol!==1) throw Error("error.coop_unsupported");
          if (!acceptsMap(e,room.map,room.modeId)) throw Error("error.map_version");
          peer.p=room.join(peer,e,signed.id); peer.room=room; clearTimeout(idle); publish();
        } else if (e?.type==="leave") { detach(true); peer.send({type:"left"}); }
        else if (peer.p) {
          const old=peer.room.phase;
          peer.room.command(peer.p,e);
          if (old!==peer.room.phase) publish();
        } else throw Error("error.join_first");
      } catch (err) { peer.send({type:"error",code:err.message.startsWith("error.") ? err.message : "error.command",params:[]}); }
    });
  });
  return new Promise((ok,fail)=>{
    const timeout=setTimeout(()=>{close();fail(Error("ICE gathering timed out"));},6000);
    pc.onGatheringStateChange(s=>{
      if (s==="complete") {clearTimeout(timeout);ok(pc.localDescription());}
    });
    try { pc.setRemoteDescription(offer.sdp,"offer"); }
    catch(err) { clearTimeout(timeout); close(); fail(err); }
  });
}
// 60 Hz simulation, 30 Hz snapshots. Bound catch-up after debugger pauses.
let last=performance.now(), debt=0;
setInterval(()=>{
  const now=performance.now(); debt=Math.min(100,debt+now-last); last=now;
  while (debt>=1000/60) {
    debt-=1000/60;
    for (const room of rooms.values()) {
      const old=room.phase; room.step(); if (room.phase!==old) publish();
      if (room.tick%2) continue;
      for (const p of room.players) {
        const dc=p.peer?.state;
        if (dc?.isOpen() && dc.bufferedAmount()<8192) dc.sendMessageBinary(room.packet(p));
      }
    }
  }
},10);
const types={".js":"text/javascript",".css":"text/css",".html":"text/html",".json":"application/json",".png":"image/png",".glb":"model/gltf-binary"};
const listener=async(req,res)=>{
  function reply(status,type,body) { res.writeHead(status,{"Content-Type":type,"Cache-Control":"no-store"});res.end(body); }
  try {
    if (req.headers.host!==host+":"+port || (req.headers.origin && req.headers.origin!==origin)) return reply(403,"text/plain","local origin only");
    const url=new URL(req.url,origin), path=decodeURIComponent(url.pathname);
    if (path.startsWith("/api/original/")) return await originalGateway(req,res,url,origin);
    if(req.method==="POST" && ["/api/auth/challenge","/api/auth/prove","/api/auth/migrate"].includes(path)) {
      if(req.headers.origin!==origin || req.headers["content-type"]!=="application/json") return reply(403,"text/plain","origin");
      const chunks=[];let size=0;
      for await(const chunk of req) {size+=chunk.length;if(size>786432)return reply(413,"text/plain","too large");chunks.push(chunk);}
      try {
        const payload=JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if(path.endsWith("migrate")) {
          // Historical bearer credentials were issued only on the original loopback origin.
          if(tls) return reply(403,"text/plain","local migration only");
          const player=auth.session(req.headers.authorization?.replace(/^Bearer /,""));
          career.migrate(profileID(payload.legacy),player.id);
          return reply(200,types[".json"],"{}");
        }
        if(path.endsWith("challenge")) {
          if(!tls) res.setHeader("X-GH-Host-Pin","loopback");
          return reply(200,types[".json"],JSON.stringify(auth.challenge()));
        }
        return reply(200,types[".json"],JSON.stringify(await auth.authenticate(payload)));
      } catch {return reply(401,"text/plain","Account verification failed");}
    }
    if (req.method==="POST" && path==="/api/rtc") {
      if (req.headers.origin!==origin || req.headers["content-type"]!=="application/json") return reply(403,"text/plain","same-origin JSON only");
      let body="";
      for await(const chunk of req) { body+=chunk; if(body.length>65536) return reply(413,"text/plain","offer too long"); }
      if (peers.size>=32) return reply(503,"text/plain","local peer limit");
      const ticket=req.headers.authorization?.replace(/^Bearer /,"");
      let signed;
      try {signed=auth.take(ticket);} catch {return reply(401,"text/plain","Invalid admission ticket");}
      return reply(200,types[".json"],JSON.stringify(await signal(JSON.parse(body),ticket,signed)));
    }
    if (req.method!=="GET") return reply(405,"text/plain","GET only");
    if (["/api/career","/api/ranks","/api/receipt"].includes(path)) {
      let id;
      try {id=auth.session(req.headers.authorization?.replace(/^Bearer /,"")).id;} catch {return reply(401,"text/plain","Sign in first");}
      if(path==="/api/receipt") return reply(200,types[".json"],JSON.stringify(await auth.receipt(id)));
      const result = path==="/api/ranks" ? career.board(id) : career.progress(id);
      return reply(200,types[".json"],JSON.stringify(result));
    }
    if (path==="/api/config") return reply(200,types[".json"],JSON.stringify({legacyMigration:!tls,communityMaps,preferredTransport:"webrtc",rtc:{url:"/api/rtc",iceServers:[]},
      communityModes:{protocol:1,modes:["tdm",COOP_MODE]}}));
    if (path==="/api/invite") return reply(200,types[".json"],"{}");
    if (path==="/api/health") return reply(200,types[".json"],'{"mode":"local-development"}');
    if (path==="/api/rooms/events") {
      res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-store"});
      res.write(listing()); feeds.add(res); res.on("close",()=>feeds.delete(res)); return;
    }
    const file=resolve(game,path === "/" ? "index.html" : "."+path);
    if (!file.startsWith(game+sep)) return reply(404,"text/plain","not found");
    const body=await readFile(file);
    reply(200,types[extname(file)]||"application/octet-stream",body);
  } catch(err) {
    const missing=["ENOENT","EISDIR","EPERM","ENOTDIR"].includes(err.code);
    reply(missing?404:400,"text/plain",missing?"not found":err.message);
  }
};
const server=tls?https.createServer(tls,listener):http.createServer(listener);
await new Promise((ready,fail)=>server.once("error",fail).listen(port,host,ready));
console.log("Golden Hour: "+origin);
