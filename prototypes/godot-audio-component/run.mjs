import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import {once} from "node:events";
import {spawn} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";
import assert from "node:assert/strict";
import {createCasingProducer,coreSHA256} from "./producer.mjs";

const out=path.resolve(process.argv[2]);
fs.mkdirSync(out);
const contract=process.argv[3]??"absolute";
assert.ok(["absolute","untimed"].includes(contract));
const driver=process.argv[4];
assert.ok(["WASAPI","Dummy"].includes(driver));
const factory=createCasingProducer({random:()=>.4});
const graph=path.resolve(process.argv[6]);
const exe=path.resolve(process.argv[5]);
const project=path.resolve(process.argv[7]);
const server=net.createServer();
server.listen(0,"127.0.0.1");await once(server,"listening");
const connection=once(server,"connection");
const log=fs.openSync(path.join(out,"godot.log"),"wx");
const proc=spawn(exe,["--display-driver","headless","--audio-driver",driver,"--max-fps","1000","--path",project,
    "--script","res://ipc.gd","--",String(server.address().port),graph,driver,"0","0"],{stdio:["ignore",log,log],windowsHide:true,env:{...process.env,GH_AUDIO_CLOCK_WAKE:"event",GH_CASING_DEVICE_TRACE:path.join(out,"device-trace.json"),GH_CASING_TIMING_AUDIT:path.join(out,"cue-callback.csv"),GH_CASING_CAPTURE:path.join(out,"live-stereo.f32"),GH_AUDIO_ADMISSION_AUDIT:path.join(out,"admission.csv")}});
fs.writeFileSync(path.join(out,"owned-processes.json"),JSON.stringify({nodePid:process.pid,godotPid:proc.pid,driver,contract,port:server.address().port}));
const exited=once(proc,"exit");
function encode(cells){
    const b=Buffer.alloc(384);cells.forEach((v,i)=>b.writeDoubleLE(v,i*8));return b;
}
const audit={driver,contract,sourceSHA256:coreSHA256,batches:[],records:[],reads:[],pings:[]};
let sock,latest,finished,error;
async function wait(check){
    const start=performance.now();
    while(!check()){
        if(error || proc.exitCode!==null || performance.now()-start>5000)throw Error(error||"timeout or child exit");
        await sleep(1);
    }
}
try{
    [sock]=await Promise.race([connection,exited.then(()=>{throw Error("child exited")})]);
    sock.setNoDelay(true);
    let tail=Buffer.alloc(0);
    sock.on("error",e=>{error=String(e);});
    sock.on("data",chunk=>{
        const bytes=Buffer.concat([tail,chunk]);let i=0;
        for(;i+64<=bytes.length;i+=64){
            const [kind,a,b,c,d,e,f,g]=Array.from({length:8},(_,n)=>bytes.readDoubleLE(i+n*8));
            const nodeMs=performance.now();
            if(kind===1||kind===3){
                const read={frame:kind===1?a:b,workerUs:kind===1?b:c,nodeMs};
                latest=read;audit.reads.push(read);
                if(kind===3)audit.pings[a].reply=read;
            }else if(kind===2){
                const row=audit.records[a-1];assert.ok(row&&!row.ack);
                row.ack={voice:b,consumed:c,status:d,ingress:e,ingressUs:f,emitUs:g,nodeMs};
            }else if(kind===4)finished={frame:a,enqueued:d,acked:e,retries:f};
            else if(kind===5)error="native decode error";
        }
        tail=bytes.subarray(i);
    });
    await wait(()=>latest);
    for(let i=0;i<8;i++){
        audit.pings.push({sendMs:performance.now()});sock.write(encode([i,9]));
        await wait(()=>audit.pings[i].reply);
    }
    const epoch=performance.now();
    const counts=new Map();
    let draws=0,stolen=0;
    for(const [ms,action,count] of [[0,"marble",5],[20,"carpet",1],[100,"sweep",1],[160,"marble",1],[1000,"sweep",1]]){
        while(performance.now()<epoch+ms)await sleep(Math.max(0,epoch+ms-performance.now()-1));
        const payload=[];
        for(let j=0;j<count;j++){
            const invokeMs=performance.now(),read=latest;
            const isCue=action!=="sweep";
            const cue=factory.invoke({op:isCue?"casing":"sweep",time:read.frame/48000,surface:action,kind:"brass"});
            const expandedMs=performance.now(),batch=audit.batches.length;
            draws+=cue.uniform.length;stolen=cue.stolen;
            function add(kind,voice,target,cells){
                const seq=audit.records.length+1;
                audit.records.push({seq,op:kind,voice,batch,target});payload.push(encode([seq,...cells]));
            }
            if(isCue){
                assert.equal(cue.releaseIds.length,0);
                counts.set(cue.voice,cue.sourceIds.length);
                const cells=[contract==="untimed"?12:11,cue.voice,contract==="untimed"?0:cue.anchorSeconds,cue.material,+cue.shell,cue.ts,cue.gain,
                    cue.victim??0,counts.get(cue.victim)??0,cue.uniform.length,...cue.uniform];
                while(cells.length<42)cells.push(0);
                cells.push(contract==="untimed"?0:read.frame);
                add("cue",cue.voice,cue.victim?read.frame:(cue.anchorSeconds+.003)*48000,cells);
            }
            for(const voice of cue.releaseIds)add("release",voice,null,[8,voice]);
            audit.batches.push({action,ms,invokeMs,read,expandedMs,sendMs:null,cue});
        }
        const sendMs=performance.now();
        for(const b of audit.batches)if(b.sendMs===null)b.sendMs=sendMs;
        if(payload.length)sock.write(Buffer.concat(payload));
    }
    await wait(()=>audit.records.every(r=>r.ack));
    sock.write(encode([0,10]));await wait(()=>finished);
    assert.equal((await exited)[0],0);
    audit.finish=finished;
    audit.results=[0,1,2,3].map(s=>audit.records.filter(r=>r.ack.status===s).length);
    audit.draws=draws;audit.stolen=stolen;
    assert.equal(audit.draws,124);assert.equal(audit.stolen,1);
    assert.equal(finished.acked,audit.records.length);
    assert.equal(audit.records.filter(r=>r.op==="cue").length,7);
    assert.equal(audit.records.filter(r=>r.op==="release").length,7);
    fs.writeFileSync(path.join(out,"source.json"),JSON.stringify(audit,null,2));
    console.log(audit.results,audit.draws,audit.stolen);
}catch(e){audit.error=String(e);fs.writeFileSync(path.join(out,"partial.json"),JSON.stringify(audit,null,2));throw e;}finally{sock?.destroy();server.close();if(proc.exitCode===null)proc.kill();fs.closeSync(log);}
