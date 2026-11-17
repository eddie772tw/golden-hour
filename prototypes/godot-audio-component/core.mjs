import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";

const file=process.env.GH_GAME_CORE || new URL("../../game/core/game.js",import.meta.url);
const bytes=readFileSync(file);
export const coreSHA256=createHash("sha256").update(bytes).digest("hex");
assert.equal(coreSHA256,"b3b3084ac3e4dedc54e160a702cc85022e59daf806007fa2237264d972e5be7b");
const source=bytes.toString("utf8");
const start=source.indexOf("  var qc = Math.PI"), end=source.indexOf("  var fo = eZ();",start);
assert.ok(start>=0 && end>start);
export const raw=source.slice(start,end);
