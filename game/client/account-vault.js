import {
  createAccount,
  encryptSave,
  unlockSave,
  storageKey,
  checkName,
  checkReceipts,
  mergeRecords,
  proof,
  issuerBinding,
  verify,
  sign,
} from "./local-account.js";
import { loadout, profile } from "./progress-ledger.js";
import { selectedModel, selectModel } from "./weapon-models.js";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("golden-hour-accounts", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("vault");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}
async function request(path, body, token, pin) {
  const headers = token ? { Authorization: "Bearer " + token } : {};
  if (pin) headers["X-GH-Host-Pin"] = pin;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok)
    throw Error(
      res.status === 401
        ? "Account verification required"
        : "Server unavailable (" + res.status + ")",
    );
  const data = await res.json();
  if (path === "/api/auth/challenge") {
    // The local gateway supplies the pinned TLS fingerprint independently of the host.
    const expectedPin = res.headers.get("X-GH-Host-Pin");
    if (!expectedPin || !data.binding || !await verify(data.host, issuerBinding(expectedPin), data.binding))
      throw Error("Invalid match issuer");
    data.pin = expectedPin;
  }
  return data;
}
export class Vault {
  constructor() {
    this.queue = Promise.resolve();
    this.saved = null;
    this.account = null;
  }
  async init() {
    this.db = await openDB();
    this.saved = await new Promise((ok, fail) => {
      const r = this.db
        .transaction("vault")
        .objectStore("vault")
        .get(storageKey);
      r.onsuccess = () => ok(r.result ?? null);
      r.onerror = () => fail(r.error);
    });
  }
  run(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async commit(account, keys) {
    const encrypted = await encryptSave(account, null, keys);
    await new Promise((ok, fail) => {
      const tx = this.db.transaction("vault", "readwrite"),
        store = tx.objectStore("vault"),
        get = store.get(storageKey);
      get.onsuccess = () => {
        if ((get.result ?? null) !== this.saved) {
          tx.abort();
          return;
        }
        store.put(encrypted.envelope, storageKey);
      };
      tx.oncomplete = ok;
      tx.onabort = () =>
        fail(tx.error ?? Error("Save changed in another tab. Reload first."));
    });
    this.saved = encrypted.envelope;
    this.keys = { key: encrypted.key, salt: encrypted.salt };
    this.account = account;
  }
  preferences() {
    const bridge = globalThis.GHProgress;
    return bridge
      ? {
          profile: profile(bridge.readProfile()),
          loadout: loadout(bridge.readLoadout()),
          models: Object.fromEntries(
            ["pistol", "smg", "shotgun"].map((k) => [k, selectedModel(k)]),
          ),
        }
      : null;
  }
  restore() {
    const p = this.account.preferences,
      b = globalThis.GHProgress;
    if (!p || !b) return;
    b.writeProfile(profile(p.profile));
    b.writeLoadout(loadout(p.loadout));
    for (const family of ["pistol", "smg", "shotgun"])
      selectModel(family, p.models?.[family] ?? family);
  }
  create(name, password) {
    return this.run(async () => {
      if (this.saved) throw Error("Unlock your existing account");
      const a = await createAccount(name);
      a.preferences = this.preferences();
      const keys = await encryptSave(a, password);
      await this.commit(a, keys);
    });
  }
  unlock(password) {
    return this.run(async () => {
      const result = await unlockSave(this.saved, password);
      if (result.account.preferences) {
        profile(result.account.preferences.profile);
        loadout(result.account.preferences.loadout);
      }
      this.keys = { key: result.key, salt: result.salt };
      this.account = result.account;
      this.restore();
    });
  }
  import(text, password, approve = () => true) {
    return this.run(async () => {
      const result = await unlockSave(text, password);
      if (result.account.preferences) {
        profile(result.account.preferences.profile);
        loadout(result.account.preferences.loadout);
      }
      if (this.saved && !this.account)
        throw Error("Unlock the current account first");
      if (this.account && this.account.id !== result.account.id)
        throw Error("Use a separate browser profile for another UUID");
      result.account.receipts = mergeRecords(
        this.account?.receipts ?? [],
        result.account.receipts,
      );
      if (!approve(result.account)) return false;
      await this.commit(result.account, this.keys ?? result);
      this.restore();
      return true;
    });
  }
  rename(name) {
    return this.run(async () => {
      checkName(name);
      await this.commit({ ...this.account, name }, this.keys);
    });
  }
  export() {
    return this.run(async () => {
      await this.commit(
        { ...this.account, preferences: this.preferences() },
        this.keys,
      );
      return this.saved;
    });
  }
  async authenticate() {
    const a = this.account;
    if (!a) throw Error("Unlock your local account first");
    const challenge = await request("/api/auth/challenge", {});
    const receipts = a.receipts.filter(r => r.record[1] === challenge.host);
    const payload = {
      nonce: challenge.nonce,
      id: a.id,
      pub: a.pub,
      name: a.name,
      receipts,
    };
    payload.signature = await sign(a.secret, proof(challenge, payload));
    const auth = await request("/api/auth/prove", payload, undefined, challenge.pin);
    this.session = auth.session;
    this.host = challenge.host;
    return auth.ticket;
  }
  async read(path) {
    if (!this.account) throw Error("Unlock your local account first");
    if (!this.session) await this.authenticate();
    try {
      return await request(path, undefined, this.session);
    } catch (err) {
      if (err.message !== "Account verification required") throw err;
      await this.authenticate();
      return request(path, undefined, this.session);
    }
  }
  sync() {
    return this.run(async () => {
      const r = await this.read("/api/receipt");
      if (r.record?.[1] !== this.host) throw Error("Unexpected match issuer");
      await checkReceipts(this.account.id, [r]);
      const receipts = mergeRecords(this.account.receipts, [r]);
      await this.commit(
        { ...this.account, receipts, preferences: this.preferences() },
        this.keys,
      );
    });
  }
  async migrate() {
    const legacy = localStorage.getItem("gh_career_key_v1:");
    if (legacy) await request("/api/auth/migrate", { legacy }, this.session);
  }
}
