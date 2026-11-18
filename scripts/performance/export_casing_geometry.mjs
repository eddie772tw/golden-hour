// Offline actual-source geometry and dirty-upload inventory; no frame-time claims.
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const bytes=readFileSync(new URL('../../game/core/game.js',import.meta.url));
const source=bytes.toString('utf8'),cut=source.lastIndexOf('\n  As0().catch(');assert.ok(cut>0);
const forbidden=()=>{throw Error('This inventory must not access DOM/audio/GPU');};
const c={console,URLSearchParams,URL,AbortController,DOMException,TextEncoder,TextDecoder,
 performance:{now:()=>0},location:{search:'?solo'},navigator:{userAgent:'offline-pool-audit'},addEventListener(){},
 localStorage:{getItem(){return null;},setItem(){}},document:{addEventListener(){},createElement:forbidden},
 setTimeout:forbidden,clearTimeout(){},requestAnimationFrame:forbidden,AudioContext:forbidden};c.window=c;c.self=c;
vm.runInNewContext(source.slice(0,cut)+'\nglobalThis.audit={make:ghCasingGeometry,Lathe:zo,Vector:It,THREE:Ct,Physics:_w,style:$M.prototype._styleCasings};\n})();',c,{timeout:10000});
export const casing = c.audit;
export const setCasingDetail = value => { c.__GH_CASING_DETAIL = value; };
export const sourceSHA256 = createHash('sha256').update(bytes).digest('hex');
const geometries = ['original','medium','low'].map(detail=>{
 const g=casing.make(detail);g.computeBoundingBox();
 return {detail,triangles:g.index.count/3,vertices:g.attributes.position.count,
  position:Array.from(g.attributes.position.array),normal:Array.from(g.attributes.normal.array),index:Array.from(g.index.array),
  geometryBytes:g.index.array.byteLength+Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0)};
});
if(process.argv[1]?.endsWith('export_casing_geometry.mjs'))console.log(JSON.stringify({sourceSHA256,geometries}));
