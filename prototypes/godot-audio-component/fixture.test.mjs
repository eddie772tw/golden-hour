import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {createCasingProducer} from "./producer.mjs";

const producer=createCasingProducer({random:()=>.4});
const events=[];
for(const [time,surface,count] of [[0,"marble",5],[.02,"carpet",1],[.1,null,1],[.16,"marble",1],[1,null,1]]){
    for(let i=0;i<count;i++){
        events.push(producer.invoke({time,op:surface?"casing":"sweep",surface,kind:"brass"}));
    }
}
const commands=events.map(event=>event.commands);
assert.equal(commands.flat().length,1088);
assert.equal(createHash("sha256").update(JSON.stringify(commands)).digest("hex"),
    "14b41f0527d37d2d9bd812912c84daff3ce8e844716042db7fa5a514412211be");
assert.equal(events.flatMap(e=>e.uniform).length,124);
assert.equal(events[7].victim,1);
assert.equal(events[8].releaseIds.length,7);
console.log("7 casing cues, 1,088 original commands, 124 draws, 1 steal, 7 releases");
