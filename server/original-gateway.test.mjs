import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import http2 from "node:http2";
import { once } from "node:events";
import { originalGateway } from "./original-gateway.mjs";
import { loadApiConfig, originalApiURL, rtcSignalingURL, ORIGINAL_ORIGIN } from "../game/client/api-config.js";
import { RoomDirectory } from "../game/client/lobby.js";

test("original config pins the remote signal origin before rewriting to the local WebRTC gateway", async () => {
  const page="http://127.0.0.1:48722/?server="+encodeURIComponent(ORIGINAL_ORIGIN);
  let requested;
  const request=async(url,options)=>{
    requested=String(url);assert.equal(options.credentials,"omit");
    return {ok:true,json:async()=>({url:ORIGINAL_ORIGIN+"/connect",rtc:{url:"/api/rtc/offer",iceServers:null}})};
  };
  const config=await loadApiConfig(ORIGINAL_ORIGIN,page,request,{gateway:true});
  assert.equal(requested,"http://127.0.0.1:48722/api/original/config");
  assert.equal(config.preferredTransport,"webrtc");
  assert.equal(rtcSignalingURL(config.rtc,page).href,"http://127.0.0.1:48722/api/original/rtc/offer");
  for(const url of ["https://elsewhere.invalid/api/rtc/offer", "https://user:pass@cod.apikeygame.top:8008/api/rtc/offer"]){
    await assert.rejects(loadApiConfig(ORIGINAL_ORIGIN,page,async()=>({ok:true,json:async()=>({rtc:{url}})}),{gateway:true}));
  }
  assert.throws(()=>originalApiURL("/api/config?target=elsewhere",page));
  assert.throws(()=>originalApiURL("https://elsewhere.invalid/api/config",page));
  let sourceURL;
  const dir=new RoomDirectory({origin:ORIGINAL_ORIGIN,pageURL:page,gateway:true,onChange(){},
    EventSource:class {constructor(url){sourceURL=url;}addEventListener(){}close(){}}});
  dir.setActive(true);dir.setActive(false);
  assert.equal(sourceURL,"http://127.0.0.1:48722/api/original/rooms/events");
  const direct=await loadApiConfig("https://community.invalid",page,request,{gateway:true});
  assert.equal(requested,"https://community.invalid/api/config");
  assert.equal(rtcSignalingURL(direct.rtc,page).origin,"https://community.invalid");
});

test("fixed gateway streams SSE/SDP, drops credentials, rejects proxy abuse and closes upstream on abort", async () => {
  const sessions=new Set(), received=[];
  let sseClosed=false;
  const upstream=http2.createServer();
  upstream.on("session",s=>{sessions.add(s);s.on("error",()=>{});s.on("close",()=>sessions.delete(s));});
  upstream.on("stream",(stream,headers)=>{
    received.push(headers);
    if(headers[":path"]==="/api/rooms/events"){
      stream.respond({":status":200,"content-type":"text/event-stream"});
      stream.write('event: rooms\ndata: {"type":"rooms","rooms":[]}\n\n');
      stream.on("close",()=>sseClosed=true);return;
    }
    let body="";stream.setEncoding("utf8");stream.on("data",chunk=>body+=chunk);
    stream.on("end",()=>{
      stream.respond({":status":200,"content-type":"application/json"});
      stream.end(JSON.stringify(headers[":method"]==="POST"?JSON.parse(body):{ready:true}));
    });
  });
  upstream.listen(0,"127.0.0.1");await once(upstream,"listening");
  const connect=()=>http2.connect("http://127.0.0.1:"+upstream.address().port);
  let origin;
  const proxy=http.createServer((req,res)=>{void originalGateway(req,res,new URL(req.url,origin),origin,connect);});
  proxy.listen(0,"127.0.0.1");await once(proxy,"listening");origin="http://127.0.0.1:"+proxy.address().port;
  try{
    const headers={origin,"content-type":"application/json",authorization:"Bearer local-secret",cookie:"local=secret"};
    assert.deepEqual(await (await fetch(origin+"/api/original/config",{headers})).json(),{ready:true});
    const offer={type:"offer",sdp:"v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"};
    assert.deepEqual(await (await fetch(origin+"/api/original/rtc/offer",{method:"POST",headers,body:JSON.stringify(offer)})).json(),offer);
    for(const h of received){
      assert.equal(h.origin,"https://www.bilibilitoy.com");
      assert.equal(h.authorization,undefined);assert.equal(h.cookie,undefined);
    }
    const before=received.length;
    for(const [path,options,status] of [
      ["/config?target=https://elsewhere.invalid",{},404],
      ["/auth/prove",{},404], ["/config",{headers:{origin:"https://elsewhere.invalid"}},403],
      ["/config",{method:"POST",headers},405],
      ["/rtc/offer",{method:"POST",headers:{"content-type":"application/json"},body:"{}"},403],
      ["/rtc/offer",{method:"POST",headers,body:'{"type":"answer","sdp":"bad"}'},400],
      ["/rtc/offer",{method:"POST",headers,body:"x".repeat(65537)},413],
    ]) assert.equal((await fetch(origin+"/api/original"+path,options)).status,status,path);
    assert.equal(received.length,before);
    const controller=new AbortController();
    const sse=await fetch(origin+"/api/original/rooms/events",{signal:controller.signal});
    assert.match(new TextDecoder().decode((await sse.body.getReader().read()).value),/event: rooms/);
    controller.abort();
    for(let n=0;n<100&&!sseClosed;n++)await new Promise(r=>setTimeout(r,10));
    assert.equal(sseClosed,true);
  }finally{
    proxy.closeAllConnections();await new Promise(r=>proxy.close(r));
    for(const s of sessions)s.destroy();await new Promise(r=>upstream.close(r));
  }
});
