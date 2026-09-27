// @ts-check

/** @typedef {typeof import('../../src/client/app.js').phoneDiagnostics} Diagnostics */

/** @param {Diagnostics} diagnostics */
export async function startPhoneTest(diagnostics) {
  document.body.classList.add("phone-test");
  const key = "opendwarf:phone-test-code";
  const code = sessionStorage.getItem(key) ??
    crypto.randomUUID().replaceAll("-", "");
  sessionStorage.setItem(key, code);
  const panel = document.createElement("aside");
  panel.id = "phone-test-panel";
  panel.innerHTML = `<strong>Phone network test</strong><br>
    Code: <code id="phone-test-code"></code><br>
    <span id="phone-test-status">Registering…</span><br>
    <button id="phone-test-hide" type="button">Hide panel</button>`;
  document.querySelector("#game")?.append(panel);
  const codeElement = panel.querySelector("#phone-test-code");
  const status = panel.querySelector("#phone-test-status");
  if (codeElement) codeElement.textContent = code;
  panel.querySelector("#phone-test-hide")?.addEventListener("click", () => {
    panel.classList.toggle("small");
  });
  const endpoint = `/api/phone-test/${code}`;
  /** @param {string} path @param {unknown} value */
  const post = (path, value) =>
    fetch(`${endpoint}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
  const lastKey = "opendwarf:phone-test-last";
  let lastCommand = sessionStorage.getItem(lastKey) ?? "";
  /** @param {{id:string,kind:string,data?:string}} command */
  async function execute(command) {
    if (command.kind === "sample") return diagnostics.sample();
    if (command.kind === "drop") {
      diagnostics.drop(Number(command.data) || 0);
      return { dropped: true, ...diagnostics.sample() };
    }
    if (command.kind === "join") {
      let id = command.data ?? "";
      if (!id) {
        const response = await fetch("/api/admin/sessions");
        const data = await response.json();
        id = String(data.sessions?.[0]?.id ?? "");
      }
      const joined = diagnostics.join(id);
      if (joined) {
        const url = new URL(location.href);
        url.searchParams.set("session", id);
        history.replaceState(null, "", url);
      }
      return { joined, session: id };
    }
    if (command.kind === "relay") {
      const url = new URL(location.href);
      if (command.data === "1") url.searchParams.set("relay", "1");
      else url.searchParams.delete("relay");
      return { reload: url.href };
    }
    return { error: "unknown command" };
  }
  async function poll() {
    try {
      await post("register", {});
      const response = await fetch(`${endpoint}/state`, { cache: "no-store" });
      const state = await response.json();
      if (status) {
        const sample = diagnostics.sample();
        status.textContent = `${sample.status} · ${sample.route}`;
      }
      const command = state.command;
      if (command && command.id !== lastCommand) {
        const result = await execute(command);
        await post("result", { id: command.id, result });
        lastCommand = command.id;
        sessionStorage.setItem(lastKey, lastCommand);
        if (command.kind === "relay" && "reload" in result) {
          location.href = String(result.reload);
        }
      }
    } catch {
      if (status) status.textContent = "Network unavailable; retrying…";
    }
    setTimeout(poll, 1000);
  }
  await poll();
}
