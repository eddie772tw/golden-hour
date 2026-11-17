import {raw} from "./core.mjs";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";

const noise=new Function(raw+"\nreturn tI;")();
const dir=resolve(process.argv[2]);
mkdirSync(dir);
for(const [name,duration,digest] of [
    ["white",3,"44b682016f8c01235d1d4a988a73575d08ec23796b9a8d455c4c76b45f32ba10"],
    ["brown",4,"97983e9f9b797f53a4460c9356b58dbdd70146565352ed388a2642f3388b1f17"]
]){
    const samples=noise(48000,duration,name);
    const bytes=Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"),digest);
    writeFileSync(resolve(dir,name+".f32"),bytes,{flag:"wx"});
}
// The seven casing calls use the noise bank and no decoded one-shot samples.
writeFileSync(resolve(dir,"buffers.json"),"{}\n",{flag:"wx"});
