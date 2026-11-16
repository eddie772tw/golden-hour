// The same wire encoding runs in browsers and Node. Signed records use fixed-order arrays.
const utf8 = new TextEncoder(),
  decode = new TextDecoder("utf-8", { fatal: true });
const curve = { name: "ECDSA", namedCurve: "P-256" },
  algorithm = { name: "ECDSA", hash: "SHA-256" };
const iterations = 600000;
export const storageKey = "gh.encrypted-account.v1";
export function base64(bytes) {
  let value = "";
  const array = new Uint8Array(bytes);
  for (let i = 0; i < array.length; i += 8192)
    value += String.fromCharCode(...array.subarray(i, i + 8192));
  return btoa(value);
}
function bytes(value, limit) {
  if (typeof value !== "string" || value.length > Math.ceil(limit / 3) * 4)
    throw Error("Invalid account data");
  const raw = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (raw.length > limit || base64(raw) !== value)
    throw Error("Invalid encoding");
  return raw;
}
export async function identity(pub) {
  const raw = bytes(pub, 65);
  if (raw.length !== 65 || raw[0] !== 4) throw Error("Invalid public key");
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new Uint8Array([...utf8.encode("GH-account-v1\0"), ...raw]),
    ),
  );
  hash[6] = (hash[6] & 15) | 128;
  hash[8] = (hash[8] & 63) | 128;
  const hex = Array.from(hash.slice(0, 16), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
export async function keyPair() {
  const pair = await crypto.subtle.generateKey(curve, true, ["sign", "verify"]);
  return {
    pub: base64(await crypto.subtle.exportKey("raw", pair.publicKey)),
    secret: base64(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
  };
}
export async function sign(secret, data) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    bytes(secret, 256),
    curve,
    false,
    ["sign"],
  );
  return base64(
    await crypto.subtle.sign(algorithm, key, utf8.encode(JSON.stringify(data))),
  );
}
export async function verify(pub, data, signature) {
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(pub, 65),
    curve,
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    algorithm,
    key,
    bytes(signature, 64),
    utf8.encode(JSON.stringify(data)),
  );
}
export function checkName(name) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name !== name.trim() ||
    name.length > 32 ||
    /[<>&\u0000-\u001f]/.test(name)
  )
    throw Error("Invalid display name (1–32 characters)");
}
export async function checkReceipts(id, receipts) {
  if (!Array.isArray(receipts) || receipts.length > 256)
    throw Error("Invalid match records");
  const issuers = new Set();
  for (const { record, signature } of receipts) {
    if (!Array.isArray(record) || record.length !== 6)
      throw Error("Invalid match record");
    const [tag, issuer, owner, matches, kills, stats] = record;
    if (
      !Array.isArray(stats) ||
      stats.length !== 4 ||
      !stats.every((n) => Number.isSafeInteger(n) && n >= 0) ||
      stats[0] + stats[1] > matches
    )
      throw Error("Invalid match totals");
    if (
      tag !== "GH-career-v1" ||
      owner !== id ||
      issuers.has(issuer) ||
      !Number.isSafeInteger(matches) ||
      matches < 0 ||
      !Array.isArray(kills) ||
      kills.length > 32 ||
      !kills.every(
        (row) =>
          Array.isArray(row) &&
          row.length === 2 &&
          typeof row[0] === "string" &&
          Number.isSafeInteger(row[1]) &&
          row[1] >= 0,
      ) ||
      !(await verify(issuer, record, signature))
    )
      throw Error("Invalid match signature");
    issuers.add(issuer);
  }
}
export function mergeRecords(old, news) {
  const map = new Map(old.map((r) => [r.record[1], r]));
  for (const r of news) {
    const last = map.get(r.record[1]);
    if (last) {
      const covers = (a, b) => {
        const counts = new Map(a[4]);
        return (
          a[3] >= b[3] &&
          a[5].every((n, i) => n >= b[5][i]) &&
          b[4].every(([w, n]) => (counts.get(w) ?? 0) >= n)
        );
      };
      if (covers(last.record, r.record)) continue;
      if (!covers(r.record, last.record))
        throw Error("Conflicting match history");
    }
    map.set(r.record[1], r);
  }
  return [...map.values()];
}
export async function createAccount(name) {
  checkName(name);
  const keys = await keyPair();
  return {
    ...keys,
    id: await identity(keys.pub),
    name,
    avatar: null,
    receipts: [],
    preferences: null,
  };
}
export function issuerBinding(pin) {
  return ["GH-receipt-issuer-v1", pin];
}
export function proof(challenge, account) {
  return [
    "GH-admission-v1",
    challenge.host,
    challenge.nonce,
    account.id,
    account.pub,
    account.name,
    account.receipts,
  ];
}
async function encryptionKey(password, salt) {
  if (typeof password !== "string" || !password.length)
    throw Error("Enter a passphrase");
  const raw = await crypto.subtle.importKey(
    "raw",
    utf8.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
const aad = utf8.encode(
  "Golden Hour .ghsave v1 / PBKDF2-SHA256-600000 / AES-256-GCM",
);
export async function encryptSave(account, password, existing) {
  const salt = existing?.salt ?? crypto.getRandomValues(new Uint8Array(16)),
    key = existing?.key ?? (await encryptionKey(password, salt));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const blob = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    utf8.encode(JSON.stringify(account)),
  );
  return {
    envelope: JSON.stringify({
      version: 1,
      salt: base64(salt),
      iv: base64(iv),
      data: base64(blob),
    }),
    key,
    salt,
  };
}
export async function unlockSave(text, password) {
  if (typeof text !== "string" || text.length > 1024 * 1024)
    throw Error("Invalid save size");
  const e = JSON.parse(text),
    salt = bytes(e.salt, 16),
    iv = bytes(e.iv, 12);
  if (e.version !== 1 || salt.length !== 16 || iv.length !== 12)
    throw Error("Unsupported save format");
  const key = await encryptionKey(password, salt);
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    bytes(e.data, 768 * 1024),
  );
  const account = JSON.parse(decode.decode(data));
  checkName(account.name);
  if (
    account.id !== (await identity(account.pub)) ||
    !(await verify(
      account.pub,
      ["GH-key-check", account.id],
      await sign(account.secret, ["GH-key-check", account.id]),
    ))
  )
    throw Error("Account key mismatch");
  if (
    account.avatar !== null &&
    (typeof account.avatar !== "string" ||
      account.avatar.length > 175000 ||
      !/^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/.test(account.avatar))
  )
    throw Error("Invalid avatar");
  await checkReceipts(account.id, account.receipts);
  return { account, key, salt };
}
