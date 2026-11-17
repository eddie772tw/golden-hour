import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { connectionTarget, targetURL } from "../game/client/server-target.js";
import { Connection, decodeSnapshot } from "../game/client/net.js";
import { Room } from "./room.mjs";

test("server selection is explicit, validates origins and returns to the existing local mode", () => {
  const page="http://127.0.0.1:48722/?solo=1&toy=alice";
  assert.deepEqual(connectionTarget(page),{original:false,origin:undefined});
  const url=targetURL(page,true," https://example.org:8008 ");
  assert.deepEqual(connectionTarget(url),{original:true,origin:"https://example.org:8008"});
  assert.equal(new URL(url).searchParams.has("solo"),false);
  assert.equal(connectionTarget(targetURL(url,false,"" )).original,false);
  for (const bad of ["", "http://example.org", "https://name:secret@example.org", "https://example.org/path", "https://example.org/?token=secret"]) {
    assert.throws(()=>targetURL(page,true,bad));
  }
});

test("original mode overrides saved Shop choices before startup without changing preferences or loading Shop art", () => {
  for (const original of [true,false]) {
    const result=spawnSync(process.execPath,["--input-type=module","-e",`
      import assert from 'node:assert/strict';
      globalThis.location=new URL('http://localhost/${original ? "?server=https://example.org" : ""}');
      const saved=JSON.stringify({pistol:'gbull',smg:'chingi',shotgun:'linbei'});
      let writes=0;
      globalThis.localStorage={getItem:()=>saved,setItem:()=>writes++};
      const m=await import('./game/client/weapon-models.js');
      assert.equal(m.shopWeaponsEnabled,${!original});
      for (const [family,id] of Object.entries(JSON.parse(saved))) {
        const expected=${original} ? family : id;
        assert.equal(m.selectedModel(family),expected);
        const def=m.weaponDefinition({id:family,mag:999,recoil:{v:1,h:1}});
        assert.equal(def.profileId,expected);
        assert.equal(def.mag,${original} ? 999 : m.models[id].mag);
      }
      if (${original}) {
        m.selectModel('pistol','gbull');m.selectModel('smg','smg');
        assert.equal(writes,0);
        globalThis.fetch=()=>{throw Error('Shop assets requested');};
        const art=await import('./game/client/shop-weapon-art.js');
        await art.loadShopWeaponArt();
        assert.equal(art.mountShopWeapon(null,null,'gbull','view'),undefined);
      }
    `],{cwd:new URL("../",import.meta.url),encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
  }
});

test("every original-mode equip command falls back and its handshake cannot contain local credentials", async () => {
  const n=new Connection({original:true}), sent=[];
  n.writer={write:async bytes=>sent.push(JSON.parse(new TextDecoder().decode(bytes)))};
  await n.send({type:"hello",name:"Guest",create:true,public:true,ticket:"secret",profile:"secret",resume:"seat-token"});
  assert.deepEqual(sent[0],{type:"hello",name:"Guest",create:true,public:true,resume:"seat-token"});
  for (const [id,family] of [["gbull","pistol"],["chingi","smg"],["linbei","shotgun"],["ar","ar"]]) {
    await n.send({type:"equip",weapon:id});
    assert.equal(sent.at(-1).weapon,family);
  }
  const local=new Connection(), localSent=[];
  local.writer={write:async bytes=>localSent.push(JSON.parse(new TextDecoder().decode(bytes)))};
  await local.send({type:"equip",weapon:"gbull"});
  assert.equal(localSent[0].weapon,"gbull");
});

test("original snapshot decoding accepts original weapon indices and rejects Shop extensions", () => {
  const room=new Room(), p=room.players[0];
  for (const weapon of ["ar","smg","shotgun","pistol"]) {
    p.weapon=weapon;
    assert.equal(decodeSnapshot(room.packet(p),true).players[0].weapon,weapon);
  }
  p.weapon="gbull";
  assert.equal(decodeSnapshot(room.packet(p),true),null);
  assert.equal(decodeSnapshot(room.packet(p)).players[0].weapon,"gbull");
});
