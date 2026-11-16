import { randomBytes } from "node:crypto";
import {
  identity,
  issuerBinding,
  keyPair,
  checkName,
  checkReceipts,
  proof,
  sign,
  verify,
} from "../game/client/local-account.js";

export async function admission(career, pin = "loopback") {
  const db = career.db;
  db.exec(
    "CREATE TABLE IF NOT EXISTS host_identity (slot INTEGER PRIMARY KEY CHECK(slot=1), keys TEXT NOT NULL)",
  );
  if (!db.prepare("SELECT 1 FROM host_identity").get())
    db.prepare("INSERT OR IGNORE INTO host_identity VALUES(1,?)").run(
      JSON.stringify(await keyPair()),
    );
  const keys = JSON.parse(
    db.prepare("SELECT keys FROM host_identity").get().keys,
  );
  const binding = await sign(keys.secret, issuerBinding(pin));
  const challenges = new Map(),
    sessions = new Map(),
    tickets = new Map();
  function issue(store, value, ttl) {
    const now = Date.now();
    for (const [key, entry] of store) if (entry.until <= now) store.delete(key);
    if (store.size >= 2048) throw Error("Too many requests");
    const token = randomBytes(32).toString("hex");
    store.set(token, { until: now + ttl, value });
    return token;
  }
  function read(store, key, consume = false) {
    const entry = store.get(key);
    if (consume) store.delete(key);
    if (!entry || entry.until <= Date.now())
      throw Error("Authentication expired");
    return entry.value;
  }
  return {
    challenge() {
      return { host: keys.pub, binding, nonce: issue(challenges, true, 60000) };
    },
    async authenticate(request) {
      const { nonce, id, pub, name, receipts, signature } = request;
      read(challenges, nonce, true);
      checkName(name);
      if (
        id !== (await identity(pub)) ||
        !(await verify(
          pub,
          proof({ host: keys.pub, nonce }, { id, pub, name, receipts }),
          signature,
        ))
      )
        throw Error("Invalid account proof");
      if (!Array.isArray(receipts) || receipts.length > 1 ||
          receipts.some(r => r?.record?.[1] !== keys.pub))
        throw Error("Unexpected match issuer");
      await checkReceipts(id, receipts);
      const player = { id, name };
      return {
        session: issue(sessions, player, 3600000),
        ticket: issue(tickets, player, 45000),
      };
    },
    take(ticket) {
      return read(tickets, ticket, true);
    },
    session(token) {
      return read(sessions, token);
    },
    async receipt(id) {
      const kills = Object.entries(career.progress(id).kills).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const { n, wins, losses, deaths, score } = career.finished.get(id);
      const record = [
        "GH-career-v1",
        keys.pub,
        id,
        n,
        kills,
        [wins, losses, deaths, score],
      ];
      return { record, signature: await sign(keys.secret, record) };
    },
  };
}
