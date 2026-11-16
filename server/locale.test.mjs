import test from "node:test";
import assert from "node:assert/strict";
import {catalogs, languages, legacy, message, resolveLocale} from "../game/i18n/index.js";
import {protocolError} from "../game/i18n/errors.js";
import {Room} from "./room.mjs";

const fields = s => [...s.matchAll(/\{(\d+)\}/g)].map(m=>m[1]).sort();
test("every selectable locale has every message, argument and safe tip markup", () => {
  const base = catalogs["zh-CN"];
  assert.equal(Object.keys(languages).length, 5);
  for (const locale of Object.keys(languages)) {
    const messages = catalogs[locale];
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(base).sort());
    for (const [key,v] of Object.entries(messages)) {
      assert.ok(v.trim(), key);
      assert.deepEqual(fields(v), fields(base[key]), locale+" "+key);
      assert.doesNotMatch(v.replace(/<\/?b>/g,""), /<[^>]*>/);
    }
  }
});
test("saved locale, browser preference order and explicit Kyoto", () => {
  assert.equal(resolveLocale(null, ["fr", "zh-Hant-HK"]), "zh-TW");
  assert.equal(resolveLocale(null, ["ja-JP-x-kyoto"]), "ja-JP");
  assert.equal(resolveLocale("ja-JP-x-kyoto", ["en-US"]), "ja-JP-x-kyoto");
  assert.equal(resolveLocale("missing", ["en-GB"]), "en-US");
  assert.equal(resolveLocale(null, ["de"]), "zh-CN");
});
test("legacy templates, whitespace and opaque player arguments", () => {
  assert.equal(legacy("en-US"," 我的排名：第 7 名 · 15 击杀 "), " Your rank: #7 · 15 kills ");
  assert.equal(legacy("ja-JP","RANK 17"), "ランク17");
  assert.equal(legacy("en-US","2 真人 / 8 人机"), "2 players / 8 bots");
  assert.equal(message("ja-JP","room.host",["BACK {0}"]), "BACK {0}の部屋");
  assert.notEqual(legacy("ja-JP","快速加入"), legacy("ja-JP-x-kyoto","快速加入"));
});
test("server weapon denial localizes on the recipient", () => {
  const events=[], room=new Room(), peer={send:e=>events.push(e)};
  const player=room.join(peer,{name:"BACK"});
  room.command(player,{type:"equip",weapon:"shotgun"});
  const event=events.find(e=>e.code==="error.weapon_locked");
  assert.ok(event);
  for (const locale of Object.keys(languages)) {
    assert.equal(legacy(locale, protocolError(event)), message(locale, event.code));
  }
  assert.equal(protocolError({code:"toString"}), catalogs["zh-CN"]["error.command"]);
});
