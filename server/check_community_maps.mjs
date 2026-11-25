// Run after importing maps and installing Playwright and Edge.
// GH_PLAYWRIGHT can point to an existing Playwright Node package.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const map=process.argv[2] || "shipment/3";
const {chromium}=createRequire(import.meta.url)(process.env.GH_PLAYWRIGHT || "playwright");
const root=fileURLToPath(new URL("..",import.meta.url));
const data=await mkdtemp(join(tmpdir(),"gh-community-rtc-"));
const portProbe=createServer();
await new Promise((resolve,reject)=>portProbe.on("error",reject).listen(0,"127.0.0.1",resolve));
const port=portProbe.address().port, origin="http://127.0.0.1:"+port;
await new Promise(resolve=>portProbe.close(resolve));
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith("GH_")));
Object.assign(env,{GH_DEV_PORT:String(port),GH_CAREER_DB:join(data,"career.sqlite"),GH_ROUND_SECONDS:"32"});
const server=spawn(process.execPath,["server/server.mjs"],{cwd:root,env,windowsHide:true});
const finished=once(server,"exit");
let log="", browser;
server.stdout.on("data",part=>log+=part);
server.stderr.on("data",part=>log+=part);

try {
  const readyAt=Date.now()+10000;
  while (!log.includes("Golden Hour: ") && Date.now()<readyAt && server.exitCode===null) await delay(50);
  assert.ok(log.includes("Golden Hour: "),log);
  const {communityMaps}=await (await fetch(origin+"/api/config")).json();
  const selected=communityMaps.maps.find(entry=>entry.id+"/"+entry.version===map);
  assert.ok(selected,"Requested map missing from the local server catalog");
  const needsScene=selected.clientScene==="gltf";
  const browserOption=process.env.GH_BROWSER ? {executablePath:process.env.GH_BROWSER} : {channel:"msedge"};
  browser=await chromium.launch({...browserOption,args:["--enable-unsafe-swiftshader","--disable-background-networking"]});
  const errors=[];
  async function client(name) {
    const context=await browser.newContext({locale:"en-US",serviceWorkers:"block",viewport:{width:1000,height:660}});
    await context.route("**/*",route=>{
      const url=route.request().url();
      if (url.startsWith(origin+"/") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      errors.push("External request: "+url);
      return route.abort();
    });
    const page=await context.newPage();
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(origin+"/?fixture=community-map", {waitUntil:"domcontentloaded"});
    await page.locator('[data-act="online"]:visible').first().click({timeout:180000});
    await page.locator("#account-open").click();
    await page.locator("#account-name").fill(name);
    await page.locator("#account-pass").fill("test portable passphrase");
    await page.locator("#account-create").click();
    await page.locator("#account-dialog").waitFor({state:"hidden",timeout:30000});
    await page.evaluate(async()=>{
      const {Connection}=await import("/client/net.js"), connect=Connection.prototype.connect;
      Connection.prototype.connect=function(...args) {
        if (window.mapProbe?.net!==this) {
          const state=window.mapProbe={net:this,welcome:null,welcomes:0,room:null,snapshot:null};
          this.addEventListener("event",({detail})=>{
            if (detail.type==="welcome") { state.welcome=detail; state.welcomes++; }
            if (detail.type==="room") state.room=detail;
          });
          this.addEventListener("snapshot",({detail})=>state.snapshot=detail);
        }
        return connect.apply(this,args);
      };
    });
    if (communityMaps.maps.length>1) await page.locator("#community-map").selectOption(map);
    return page;
  }
  const first=await client("Map Host"), second=await client("Map Guest");
  async function mounted(page) {
    try {
      await page.waitForFunction(({map,needsScene})=>window.mapProbe?.snapshot &&
        mapProbe.room?.mapId+"/"+mapProbe.room?.mapVersion===map &&
        document.body.classList.contains("online-session") &&
        (!needsScene || GH.debug.mapRuntime?.active?.ref?.id+"/"+GH.debug.mapRuntime?.active?.ref?.version===map),
      {map,needsScene},{timeout:30000});
    } catch (error) {
      console.error(await page.locator("#online-error").textContent(),errors);
      throw error;
    }
  }
  await first.locator("#online-create").click();
  await mounted(first);
  await second.locator("#online-quick").click();
  await mounted(second);
  const state=page=>page.evaluate(()=>({
    id:mapProbe.net.id, room:mapProbe.room.room, revision:mapProbe.welcome.mapRevision,
    scores:mapProbe.room.scores, phase:mapProbe.room.phase,
  }));
  const a=await state(first), b=await state(second);
  assert.equal(a.room,b.room);
  assert.notEqual(a.id,b.id);
  assert.equal(a.revision,selected.revision);
  assert.equal(b.revision,selected.revision);
  await second.evaluate(()=>mapProbe.net.transport.close());
  await second.waitForFunction(({id,revision})=>mapProbe.welcomes>=2 && mapProbe.net.writer &&
    mapProbe.net.id===id && mapProbe.welcome.mapRevision===revision,b,{timeout:12000});
  for (const page of [first,second]) {
    await page.waitForFunction(()=>mapProbe.room?.phase==="over" && GH.G.state==="over",null,{timeout:45000});
    assert.equal((await state(page)).room,a.room);
  }
  assert.deepEqual((await state(first)).scores,(await state(second)).scores);
  await second.evaluate(()=>mapProbe.net.send({type:"ready",ready:true}));
  for (const page of [first,second]) {
    await page.waitForFunction(()=>mapProbe.room?.round===2 && mapProbe.room.phase==="live");
    await page.evaluate(()=>GH.debug.ctx.hud.menus._act("online-leave"));
    await page.waitForFunction(()=>!document.body.classList.contains("online-session") && !GH.debug.mapRuntime?.active);
  }
  assert.deepEqual(errors,[]);
  console.log("Two Edge clients completed",map,"over local WebRTC, with resume, settlement, rematch and scene cleanup.");
} finally {
  await browser?.close();
  if (server.exitCode===null) server.kill();
  await finished;
  await rm(data,{recursive:true,force:true});
}
