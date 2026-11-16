// Small package integrity + actual exporter unit, no source graph/AI/Godot/GPU.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const proof=JSON.parse(readFileSync(new URL('./PROVENANCE.json',import.meta.url)));
for(const item of proof.origins)assert.equal(hash(new URL(item.packagePath,import.meta.url)),item.packageSHA256,item.packagePath);
const runner=readFileSync(new URL('./export-runner.mjs',import.meta.url),'utf8');
assert.ok(runner.includes("from '../godot-live-bridge/session.mjs'"));
assert.ok(!runner.includes('work/godot-native'));
const main=readFileSync(new URL('./receiver/main.gd',import.meta.url),'utf8');
assert.ok(main.includes('../../godot-skin-component/evidence/operators.skin.json'));
assert.ok(main.includes('"rootsAtFinish"')&&!main.includes('"rootReadback"'));
assert.equal(proof.coreSHA256,'b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b');
await import('./export-prop-assets.test.mjs');
const client=process.env.GH_NODE_CLIENT_ROOT?resolve(process.env.GH_NODE_CLIENT_ROOT):fileURLToPath(new URL('../../',import.meta.url));
let checked=0;
if(existsSync(resolve(client,'game/core/game.js'))){
 for(const [path,sha256]of Object.entries(proof.dependencySHA256)){assert.equal(hash(resolve(client,path)),sha256,path);checked++;}
 const intended=new URL('prototypes/godot-live-world/export-runner.mjs','file:///'+client.replaceAll('\\','/')+'/');
 assert.ok(existsSync(new URL('../godot-live-bridge/session.mjs',intended)),'Installed sibling import must resolve');
}
console.log(JSON.stringify({ok:true,scope:'Source package integrity + owning read-only exporter tiny unit; no AI/GPU',siblingDependencyHashesChecked:checked}));
