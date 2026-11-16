import test from "node:test";
import assert from "node:assert/strict";
import {
  createAccount,
  encryptSave,
  unlockSave,
  proof,
  sign,
  keyPair,
  checkReceipts,
  mergeRecords,
} from "../game/client/local-account.js";
import { Career, profileID } from "./career.mjs";
import { Vault } from "../game/client/account-vault.js";
import { admission } from "./admission.mjs";
import { randomUUID } from "node:crypto";

test("encrypted saves retain identity and reject corruption, wrong passphrases and mismatched keys", async () => {
  const a = await createAccount("Operator"),
    other = await createAccount("Other"),
    pass = "test secret";
  const { envelope, key, salt } = await encryptSave(a, pass);
  assert.equal(JSON.stringify(envelope).includes(a.secret), false);
  assert.deepEqual((await unlockSave(envelope, pass)).account, a);
  await assert.rejects(unlockSave(envelope, "wrong"));
  const broken = JSON.parse(envelope);
  broken.data = (broken.data[0] === "A" ? "B" : "A") + broken.data.slice(1);
  await assert.rejects(unlockSave(JSON.stringify(broken), pass));
  const changed = await encryptSave({ ...a, secret: other.secret }, null, {
    key,
    salt,
  });
  await assert.rejects(unlockSave(changed.envelope, pass));
});
test("host verifies signed challenges, binds the UUID and consumes each ticket exactly once", async (t) => {
  const c = new Career();
  t.after(() => c.db.close());
  const auth = await admission(c),
    a = await createAccount("Pilot");
  const make = async () => {
    const n = auth.challenge();
    return {
      ...a,
      nonce: n.nonce,
      signature: await sign(a.secret, proof(n, a)),
    };
  };
  const request = await make(),
    tickets = await auth.authenticate(request);
  assert.equal(auth.take(tickets.ticket).id, a.id);
  assert.throws(() => auth.take(tickets.ticket));
  await assert.rejects(auth.authenticate(request));
  await assert.rejects(
    auth.authenticate({ ...(await make()), name: "Imposter" }),
  );
  await assert.rejects(
    auth.authenticate({ ...(await make()), id: randomUUID() }),
  );
  const issuer = await keyPair(),
    foreign = [
      "GH-career-v1",
      issuer.pub,
      a.id,
      50,
      [["ar", 400]],
      [0, 0, 0, 0],
    ];
  a.receipts = [
    { record: foreign, signature: await sign(issuer.secret, foreign) },
  ];
  await assert.rejects(auth.authenticate(await make()), /Unexpected match issuer/);
  assert.deepEqual(c.progress(a.id).kills, {});
  const receipt = await auth.receipt(a.id);
  await checkReceipts(a.id, [receipt]);
  assert.equal(mergeRecords([receipt], [receipt]).length, 1);
  a.receipts = [receipt];
  await auth.authenticate(await make());
  receipt.record[3] = 999;
  await assert.rejects(auth.authenticate(await make()));
});
test("admission sends only the pinned issuer's receipt and keeps other saves locally", async (t) => {
  const vault = new Vault();
  vault.account = await createAccount("Traveler");
  const { id } = vault.account;
  const hosts = [];
  for (const pin of ["a".repeat(64), "b".repeat(64), "c".repeat(64)]) {
    const career = new Career();
    t.after(() => career.db.close());
    const auth = await admission(career, pin);
    hosts.push({ pin, auth, receipt: await auth.receipt(id) });
  }
  const saved = hosts.slice(0, 2).map(h => h.receipt);
  vault.account.receipts = structuredClone(saved);
  let target, challenge, sent;
  t.mock.method(globalThis, "fetch", async (path, options) => {
    if (path === "/api/auth/challenge")
      return Response.json(challenge ?? target.auth.challenge(), { headers: { "X-GH-Host-Pin": target.pin } });
    assert.equal(path, "/api/auth/prove");
    assert.equal(options.headers["X-GH-Host-Pin"], target.pin);
    sent = JSON.parse(options.body);
    return Response.json(await target.auth.authenticate(sent));
  });
  for (target of hosts) {
    await vault.authenticate();
    assert.deepEqual(sent.receipts, saved.filter(r => r.record[1] === target.receipt.record[1]));
    assert.deepEqual(vault.account.receipts, saved);
  }
  // A host relaying another issuer's signed binding must receive no account proof.
  challenge = hosts[0].auth.challenge();
  sent = undefined;
  await assert.rejects(vault.authenticate(), /Invalid match issuer/);
  assert.equal(sent, undefined);
});
test("legacy ledger migration is transactional and cannot claim the same identity twice", (t) => {
  const c = new Career();
  t.after(() => c.db.close());
  const old = profileID(randomUUID()),
    id = randomUUID();
  c.insert.run("match", 1, 1, old, randomUUID(), "ar", "Test");
  c.migrate(old, id);
  c.migrate(old, id);
  assert.equal(c.progress(id).kills.ar, 1);
  assert.throws(() => c.migrate(old, randomUUID()));
});
