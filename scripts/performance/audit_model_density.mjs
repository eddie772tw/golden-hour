// Offline model-density inventory using actual constructors and packaged geometry.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {decodeOperators} from '../../game/client/startup-geometry.js';
const bytes=readFileSync(new URL('../../game/core/game.js',import.meta.url));
const source=bytes.toString('utf8'),cut=source.lastIndexOf('\n  As0().catch(');assert.ok(cut>0);
const forbidden=()=>{throw Error('This inventory must not access DOM/audio/GPU');};
const c={console,URLSearchParams,URL,AbortController,DOMException,TextEncoder,TextDecoder,
 performance:{now:()=>0},location:{search:'?solo'},navigator:{userAgent:'offline-pool-audit'},addEventListener(){},
 localStorage:{getItem(){return null;},setItem(){}},document:{addEventListener(){},createElement:forbidden},
 setTimeout:forbidden,clearTimeout(){},requestAnimationFrame:forbidden,AudioContext:forbidden};c.window=c;c.self=c;
vm.runInNewContext(source.slice(0,cut)+'\nglobalThis.audit={THREE:Ct,WorldBatch:Mw,zo,ci,ps,Ti,It,Hl};\n})();',c,{timeout:10000});

const {THREE:T,WorldBatch}=c.audit;
const packed=readFileSync(new URL('../../game/assets/operators.bin',import.meta.url));
const header=JSON.parse(packed.subarray(8,8+packed.readUInt32LE(0)).toString('utf8'));
const operators=decodeOperators(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),header.source);
const operatorBodies=operators.map((o,slot)=>{
 assert.equal(o.triangles,o.drawRange.count/3);
 return {slot,drawRange:o.drawRange,activeTriangles:o.triangles,storedIndexTriangles:o.index.length/3,storedVertices:o.attributes.position.data.length/3};
});
// Execute the actual four-constructor call line, not independently copied dimensions.
const lines=source.split('\n').filter(l=>l.includes('Y(new zo([[0.148 + 0.05, 0]'));
assert.equal(lines.length,1); const captured=[];
Object.assign(c,c.audit,{Y:g=>captured.push(g),n:{},r:{},y0:0,X:0});
vm.runInNewContext(lines[0],c,{timeout:1000}); assert.equal(captured.length,4);
const batch=new WorldBatch(),scene=new T.Scene(),material=new T.MeshBasicMaterial();
const circularWindow=captured.map(g=>{
 batch.addGeometry(g,material);
 return {type:g.type,sourceVertices:g.attributes.position.count,triangles:g.index.count/3,expandedVertices:g.toNonIndexed().attributes.position.count};
});
batch.finalize(scene);
const total=(key)=>circularWindow.reduce((n,g)=>n+g[key],0);
assert.equal(total('triangles'),1188);
assert.equal(batch.meshes.length,1);assert.equal(batch.meshes[0].geometry.index,null);
assert.equal(batch.meshes[0].geometry.attributes.position.count,total('expandedVertices'));
console.log(JSON.stringify({sourceSHA256:createHash('sha256').update(bytes).digest('hex'),operatorsSHA256:createHash('sha256').update(packed).digest('hex'),interpretation:'Static geometry inventory only; no observed draw counts, timing, GPU cost or scene-wide totals.',operatorBodies,circularWindow,circularWindowTotals:{triangles:total('triangles'),sourceVertices:total('sourceVertices'),expandedVertices:total('expandedVertices'),batchedVertexAttributeBytes:Object.values(batch.meshes[0].geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)},exclusions:'Window group excludes its eight fasteners and surrounding door geometry; operator body excludes separately attached gear and weapons.'},null,2));
