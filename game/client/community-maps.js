import { apiOrigin, loadApiConfig } from "./api-config.js";
import { protocolError } from "../i18n/errors.js";

const builtin = { id:"hotel", version:"builtin", revision:"builtin", name:"暮色酒店", clientScene:"hotel" };
const matches = (entry, room) => entry.id===room?.mapId && entry.version===room.mapVersion && entry.revision===room.mapRevision;
const selection = entry => ({ mapId:entry.id, mapVersion:entry.version, mapRevision:entry.revision, modeId:"tdm" });
const validEntry = entry => entry && typeof entry.revision==="string" && typeof entry.id==="string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(entry.id) &&
  typeof entry.version==="string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.version) &&
  typeof entry.name==="string" && entry.name.length>0 && entry.name.length<=80 && (entry.id===builtin.id && entry.version===builtin.version && entry.revision===builtin.revision
    ? entry.clientScene==="hotel"
    : entry.version!=="builtin" && /^[a-f0-9]{64}$/.test(entry.revision) &&
      (entry.clientScene==="gltf" || entry.clientScene==="hotel" && entry.id==="hotel"));
const key = entry => entry.id+"/"+entry.version;
const mismatch = () => Error(protocolError({code:"error.map_version"}));

export class CommunityMaps {
  constructor(page, origin, pageURL) {
    this.origin=origin;
    this.pageURL=pageURL;
    this.entries=[builtin];
    this.rooms=new Map();
    this.header=page.querySelector(".online-mode");
    this.field=document.createElement("label");
    this.field.className="row online-field";
    this.field.hidden=true;
    const label=document.createElement("span");
    label.textContent="地图";
    this.field.append(label);
    this.picker=document.createElement("select");
    this.picker.id="community-map";
    this.picker.dataset.nav="";
    this.field.append(this.picker);
    page.querySelector("#online-quick").before(this.field);
    this.picker.addEventListener("change",()=>this.room(null));
    this.picker.addEventListener("keydown",event=>{ if (event.key!=="Escape") event.stopPropagation(); });
  }
  refresh(force = false) {
    if (!this.loading && (force || !this.loaded)) {
      const update=loadApiConfig(this.origin,this.pageURL).then(config=>this.configure(config));
      this.loading=update;
      update.catch(()=>{}).finally(()=>{ if (this.loading===update) this.loading=null; });
    }
  }
  configure(config) {
    const catalog=config.communityMaps;
    const entries=catalog?.maps;
    if (catalog!==undefined && (catalog?.protocol!==1 || !Array.isArray(entries) || entries.length>33 ||
        !entries.every(validEntry) || new Set(entries.map(key)).size!==entries.length ||
        !entries.some(entry=>matches(builtin,selection(entry)))))
      throw Error("社区服务器的地图目录无效。");
    this.loaded=true;
    this.protocol=catalog?.protocol;
    this.entries=entries ?? [builtin];
    const previous=this.picker.value || key(builtin);
    this.picker.replaceChildren(...this.entries.map(entry => {
      const option=document.createElement("option");
      option.value=key(entry);
      const label=entry.id==="hotel"?entry.version==="builtin"?"（内置）":"（v"+entry.version+"）":"";
      option.textContent=entry.name+label;
      return option;
    }));
    this.picker.value=this.entries.some(entry=>key(entry)===previous)?previous:key(builtin);
    this.field.hidden=this.entries.length<=1;
    if (!this.active?.mounted) this.room(null);
  }
  list(rooms) {
    for (const room of rooms) this.rooms.set(room.room,room);
    // Keep enough previous listings for a click while the directory is paused.
    while (this.rooms.size>64) this.rooms.delete(this.rooms.keys().next().value);
  }
  entryFor(room) {
    return this.entries.find(entry=>matches(entry,room));
  }
  room(room) {
    const entry=room?this.entryFor(room):this.entries.find(entry=>key(entry)===this.picker.value);
    this.header.textContent=(entry ?? builtin).name+" · 团队死斗 · 先到 40 分";
  }
  start(mode, roomID) {
    const listed=this.rooms.get(roomID);
    const chosen=mode==="listed"
      ? this.entryFor(listed) : this.entries.find(entry=>key(entry)===this.picker.value);
    if (this.protocol && (mode!=="listed" && !chosen || listed?.mapId && !chosen)) throw mismatch();
    const fields=this.protocol?{ mapProtocol:1, ...(chosen && selection(chosen)) }:{};
    this.active=new CommunitySession(this.pageURL,this.entries,fields,chosen);
    return this.active;
  }
  reset() {
    const session=this.active;
    this.active=null;
    session?.close();
    this.room(null);
  }
  listingName(summary) {
    return this.entryFor(summary)?.name || this.entries.find(entry=>entry.id===summary.mapId)?.name ||
      (summary.mapId === undefined ? builtin.name : summary.mapId);
  }
}

class CommunitySession {
  constructor(pageURL, entries, fields, chosen) {
    this.pageURL=pageURL;
    this.entries=entries;
    this.fields=fields;
    this.chosen=chosen;
    this.controller=new AbortController();
    this.events=[];
  }
  holdEvent(event) {
    if (this.mounted) {
      if (this.fields.mapProtocol && ["welcome","room"].includes(event.type) && !this.sameRoom(event)) {
        this.error=mismatch();
        return true;
      }
      return false;
    }
    if (event.type==="welcome") this.welcome=event;
    if (this.events.length>=96) this.events.splice(1,1);
    this.events.push(event);
    return true;
  }
  holdSnapshot(snapshot) {
    if (this.mounted) return false;
    this.snapshot=snapshot;
    return true;
  }
  sameRoom(value) {
    return value.room===this.welcome.room && value.modeId==="tdm" &&
      matches(this.chosen,value);
  }
  async preload(engine) {
    if (this.chosen) this.prepared=await this.prepare(engine,this.chosen);
  }
  async prepare(engine, entry) {
    if (entry.version==="builtin") return null;
    const {signal}=this.controller;
    const origin=apiOrigin(undefined,this.pageURL);
    const folder=new URL("/assets/maps/"+key(entry)+"/",origin);
    const filenames=["manifest.json","world.json","gameplay.json"];
    const hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),
      byte=>byte.toString(16).padStart(2,"0")).join("");
    const files=await Promise.all(filenames.map(async name=>{
      const res=await fetch(new URL(name,folder),{signal,credentials:"omit",redirect:"error"});
      if (!res.ok) throw mismatch();
      return res.arrayBuffer();
    }));
    const hashes=await Promise.all(files.map(hex));
    if (await hex(new TextEncoder().encode(hashes.join(":")))!==entry.revision) throw mismatch();
    signal.throwIfAborted();
    const [manifest, world, gameplay]=files.map(bytes=>JSON.parse(new TextDecoder().decode(bytes)));
    if (manifest.clientScene!==entry.clientScene) throw mismatch();
    const runtime=await import("./maps/map-runtime.js");
    const prepared=await runtime.prepareMap(engine.gh,entry,{signal});
    try {
      signal.throwIfAborted();
      if (entry.clientScene==="gltf" && ![manifest,world,gameplay].every((value,i)=>
        JSON.stringify(value)===JSON.stringify(prepared.data?.[["manifest","world","gameplay"][i]]))) throw mismatch();
    } catch (error) {
      prepared.dispose?.();
      throw error;
    }
    return { runtime, prepared, world };
  }
  async mount(engine) {
    const {signal}=this.controller;
    const welcome=this.welcome;
    if (!welcome) throw mismatch();
    if (this.fields.mapProtocol) {
      const entry=this.entries.find(candidate=>matches(candidate,welcome));
      if (!entry || welcome.modeId!=="tdm" || this.chosen && !matches(this.chosen,welcome)) throw mismatch();
      this.chosen=entry;
      const asset=this.prepared ?? await this.prepare(engine,entry);
      if (asset) {
        this.prepared=asset;
        signal.throwIfAborted();
        const { runtime, prepared, world }=asset;
        this.unmountScene=runtime.installMap(engine.gh,prepared);
        this.prepared=null;
        this.unmountPrediction=engine.useWorld(world.colliders,world.bounds);
      }
      if (this.events.some(e=>["welcome","room"].includes(e.type) && !this.sameRoom(e))) throw mismatch();
    }
    signal.throwIfAborted();
    this.mounted=true;
    const pending={events:this.events,snapshot:this.snapshot};
    this.events=[];
    this.snapshot=null;
    return pending;
  }
  close() {
    this.controller.abort();
    this.events=[];
    this.snapshot=null;
    this.prepared?.prepared.dispose?.();
    this.prepared=null;
    try { this.unmountPrediction?.(); }
    finally { this.unmountScene?.(); }
  }
}
