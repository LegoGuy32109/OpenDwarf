async function ensureEngineArtifacts() {
  try {
    await Deno.stat("./engine/generated/od_wasm.js");
    await Deno.stat("./engine/generated/od_wasm_bg.wasm");
    return;
  } catch {
    // build below
  }

  const buildProcess = new Deno.Command("bash", {
    args: ["scripts/bash/engine-dev.sh"],
    cwd: Deno.cwd(),
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await buildProcess.status;
  if (!status.success) {
    throw new Error("engine dev build failed");
  }
}

await ensureEngineArtifacts();

const devServer = new Deno.Command(Deno.execPath(), {
  args: [
    "task",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
    "--strictPort",
  ],
  cwd: Deno.cwd(),
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

await devServer.status;
