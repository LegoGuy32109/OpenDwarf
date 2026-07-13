import { writeFile } from "node:fs/promises";

type Profile = "debug" | "release";

type ToolVersion = string | null;

const [profileArg, wasmOptArg, brotliArg] = Deno.args;
if (profileArg !== "debug" && profileArg !== "release") {
  throw new Error(
    "usage: engine-wasm-metadata.ts <debug|release> <wasm-opt-applied> <brotli-applied>",
  );
}

const profile: Profile = profileArg;
const wasmOptApplied = wasmOptArg === "true";
const brotliApplied = brotliArg === "true";
const roots = ["static/engine", "engine/generated"];
const wasmName = "od_wasm_bg.wasm";
const metadataName = "od_wasm.build.json";

async function commandVersion(
  command: string,
  args: string[] = ["--version"],
): Promise<ToolVersion> {
  try {
    const output = await new Deno.Command(command, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!output.success) return null;
    return new TextDecoder().decode(output.stdout).trim() ||
      new TextDecoder().decode(output.stderr).trim() || null;
  } catch {
    return null;
  }
}

async function sha256(path: string) {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

const hashes = await Promise.all(
  roots.map((root) => sha256(`${root}/${wasmName}`)),
);
if (hashes[0] !== hashes[1]) {
  throw new Error(
    `wasm copies disagree: static=${hashes[0]} generated=${hashes[1]}`,
  );
}

const metadata = {
  schemaVersion: 1,
  profile,
  wasm: { file: wasmName, sha256: hashes[0] },
  transforms: {
    wasmBindgen: { applied: true },
    wasmOpt: {
      available: await commandVersion("wasm-opt") !== null,
      applied: wasmOptApplied,
    },
    brotli: {
      available: await commandVersion("brotli", ["--version"]) !== null,
      applied: brotliApplied,
      file: brotliApplied ? `${wasmName}.br` : null,
    },
  },
  tools: {
    cargo: await commandVersion("cargo"),
    rustc: await commandVersion("rustc"),
    wasmBindgen: await commandVersion("wasm-bindgen"),
    wasmOpt: await commandVersion("wasm-opt"),
    brotli: await commandVersion("brotli", ["--version"]),
  },
};
const encoded = `${JSON.stringify(metadata, null, 2)}\n`;
await Promise.all(
  roots.map((root) => writeFile(`${root}/${metadataName}`, encoded)),
);

for (const root of roots) {
  const written = JSON.parse(
    await Deno.readTextFile(`${root}/${metadataName}`),
  ) as typeof metadata;
  if (written.wasm.sha256 !== await sha256(`${root}/${wasmName}`)) {
    throw new Error(`metadata hash does not match ${root}/${wasmName}`);
  }
}
