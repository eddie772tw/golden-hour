import { bind } from "../i18n/dom.js";

export function installAccountMenu(vault, onReady) {
  const button = document.createElement("button"),
    dialog = document.createElement("dialog");
  button.className = "btn";
  button.id = "account-open";
  bind(button, "account.title");
  document.querySelector("#online-connect").prepend(button);
  dialog.id = "account-dialog";
  dialog.innerHTML =
    '<form><h2></h2><label><span></span><input id="account-name" maxlength="32" autocomplete="nickname"></label><label><span></span><input id="account-pass" type="password" autocomplete="off"></label><input type="file" accept=".ghsave" id="account-file" hidden><p id="account-id" translate="no"></p><div></div><output role="status"></output></form>';
  document.body.append(dialog);
  const form = dialog.querySelector("form"),
    name = form.querySelector("#account-name"),
    pass = form.querySelector("#account-pass"),
    file = form.querySelector("#account-file"),
    out = form.querySelector("output");
  bind(form.querySelector("h2"), "account.title");
  const labels = form.querySelectorAll("label span");
  bind(labels[0], "account.name");
  bind(labels[1], "account.pass");
  const avatar = document.createElement("img"),
    photo = document.createElement("input"),
    summary = document.createElement("p");
  avatar.width = avatar.height = 64;
  avatar.alt = "";
  photo.type = "file";
  photo.accept = "image/png,image/webp";
  photo.hidden = true;
  form.querySelector("div").before(avatar, summary, photo);
  const actions = {};
  function add(key, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.id = "account-" + key;
    bind(b, "account." + key);
    form.querySelector("div").append(b);
    actions[key] = b;
    b.onclick = () => perform(fn);
  }
  let pending = false;
  async function perform(fn) {
    if (pending) return;
    pending = true;
    out.textContent = "";
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await fn();
    } catch (e) {
      out.textContent =
        e.name === "OperationError"
          ? "🔒 " + pass.labels[0].textContent + " / .ghsave"
          : e.message;
    } finally {
      pending = false;
      form.querySelectorAll("button").forEach((b) => (b.disabled = false));
      render();
    }
  }
  function render() {
    actions.create.hidden = !!vault.saved;
    actions.unlock.hidden = !vault.saved || !!vault.account;
    actions.export.hidden =
      actions.rename.hidden =
      actions.avatar.hidden =
        !vault.account;
    avatar.hidden = !vault.account?.avatar;
    if (!avatar.hidden) avatar.src = vault.account.avatar;
    summary.hidden = !vault.account;
    if (vault.account) {
      const totals = [0, 0, 0, 0, 0];
      for (const { record: r } of vault.account.receipts) {
        totals[0] += r[3];
        totals[1] += r[5][0];
        totals[2] += r[5][1];
        totals[3] += r[4].reduce((n, p) => n + p[1], 0);
        totals[4] += r[5][2];
      }
      bind(summary, "account.stats", ...totals);
    }
    form.querySelector("#account-id").textContent = vault.account?.id ?? "";
    if (vault.account) {
      name.value = vault.account.name;
      document.querySelector("#online-name").textContent = vault.account.name;
    }
  }
  async function ready() {
    pass.value = "";
    render();
    try {
      await onReady();
      dialog.close();
    } catch (err) {
      out.textContent = err.message;
    }
  }
  add("create", async () => {
    await vault.create(name.value.trim(), pass.value);
    await ready();
  });
  add("unlock", async () => {
    await vault.unlock(pass.value);
    await ready();
  });
  add("rename", async () => {
    await vault.rename(name.value.trim());
    await ready();
  });
  add("avatar", () => photo.click());
  photo.onchange = () =>
    perform(async () => {
      const f = photo.files[0];
      photo.value = "";
      if (!f) return;
      if (
        !["image/png", "image/webp"].includes(f.type) ||
        f.size > 2 * 1024 * 1024
      )
        throw Error("PNG / WebP ≤ 2 MiB");
      const bitmap = await createImageBitmap(f, {
        resizeWidth: 128,
        resizeHeight: 128,
      });
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      await vault.run(() =>
        vault.commit(
          { ...vault.account, avatar: canvas.toDataURL("image/png") },
          vault.keys,
        ),
      );
    });
  add("import", () => file.click());
  file.onchange = () =>
    perform(async () => {
      const f = file.files[0];
      file.value = "";
      if (!f) return;
      if (f.size > 1024 * 1024) throw Error("Invalid save size");
      const approved = await vault.import(await f.text(), pass.value, (a) =>
        confirm(actions.import.textContent + "?\n" + a.name + "\n" + a.id),
      );
      if (approved) await ready();
    });
  add("export", async () => {
    const blob = new Blob([await vault.export()], {
        type: "application/octet-stream",
      }),
      url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = vault.account.id + ".ghsave";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  add("close", () => dialog.close());
  dialog.addEventListener("close", () => {
    pass.value = "";
  });
  for (const event of ["keydown", "keyup"])
    dialog.addEventListener(event, (e) => e.stopPropagation());
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!vault.account) (vault.saved ? actions.unlock : actions.create).click();
  };
  function open() {
    render();
    out.textContent = "";
    dialog.showModal();
    (vault.saved && !vault.account ? pass : name).focus();
  }
  button.onclick = open;
  return { open, render };
}
