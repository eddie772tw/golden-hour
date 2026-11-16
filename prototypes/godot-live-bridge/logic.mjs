// Installed as a sibling of the independently frozen Node logic prototype.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const client=process.env.GH_NODE_CLIENT_ROOT?pathToFileURL(resolve(process.env.GH_NODE_CLIENT_ROOT)+'/'):null;
export const LOGIC=client?new URL('prototypes/godot-node-logic/',client):new URL('../godot-node-logic/',import.meta.url);
export const {REPO,loadRuntime}=await import(new URL('load-runtime.mjs',LOGIC));
