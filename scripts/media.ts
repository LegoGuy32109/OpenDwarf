// Media for the opendwarf R2 bucket. The repo's media/ folder mirrors the bucket (ADR 0007).
//
//   deno task media convert <folder> [--to <dir>]  # writes media/<dir>/<name>.ogg (64 kbps Opus);
//                                                #   <dir> defaults to music; takes .mp3, .ogg, .wav, .flac
//   deno task media hash [<index>]                 # fills each entry's hash in every index, or one
//                                                #   such as sfx.v1.json
//   deno task media upload                     # sends every changed file in media/ to the bucket
//
// media/index/*.json is tracked in git; the rest of media/ is git-ignored. Conversion skips a
// track whose .ogg exists. Upload skips a file whose bucket copy has the same MD5. The R2 keys
// come from .env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET.

const MEDIA = new URL("../media/", import.meta.url);
const BITRATE = "64k";
const AUDIO = /\.(mp3|ogg|wav|flac)$/;
const TYPES: Record<string, string> = {
  ".ogg": "audio/ogg",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function run(
  command: string,
  args: string[],
  input?: string,
): Promise<{ ok: boolean; out: string }> {
  const child = new Deno.Command(command, {
    args,
    stdin: input === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (input !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
  }
  const result = await child.output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return {
    ok: result.success,
    out: decode(result.stdout) + decode(result.stderr),
  };
}

/** Runs `work` on every item, at most `limit` at a time. */
async function pool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await work(item);
      }
    }),
  );
}

async function exists(url: URL): Promise<boolean> {
  return await Deno.stat(url).then(() => true, () => false);
}

/** Every file under media/, as media keys such as `music/ACelticTale.ogg`. */
async function keys(dir = MEDIA, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name.startsWith(".")) continue;
    const key = prefix + entry.name;
    if (entry.isDirectory) {
      found.push(...await keys(new URL(`${entry.name}/`, dir), `${key}/`));
    } else if (entry.isFile) found.push(key);
  }
  return found.sort();
}

async function md5(url: URL): Promise<string> {
  const result = await run("md5sum", [url.pathname]);
  if (!result.ok) throw new Error(result.out);
  return result.out.split(" ")[0];
}

async function convert(source: string | undefined, to = "music") {
  if (!source) throw new Error("convert needs a folder of audio files");
  const names: string[] = [];
  for await (const entry of Deno.readDir(source)) {
    if (entry.isFile && AUDIO.test(entry.name)) names.push(entry.name);
  }
  const dir = new URL(`${to.replace(/\/+$/, "")}/`, MEDIA);
  await Deno.mkdir(dir, { recursive: true });
  let made = 0;
  await pool(names, navigator.hardwareConcurrency || 4, async (name) => {
    const out = new URL(name.replace(AUDIO, ".ogg"), dir);
    if (await exists(out)) return;
    const result = await run("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-i",
      `${source}/${name}`,
      "-vn",
      "-map_metadata",
      "-1",
      "-c:a",
      "libopus",
      "-b:a",
      BITRATE,
      out.pathname,
    ]);
    if (!result.ok) throw new Error(`ffmpeg failed on ${name}:\n${result.out}`);
    made++;
  });
  console.log(
    `Converted ${made} of ${names.length}; the rest were already there.`,
  );
}

/** Fills `hash` (12 hex digits of the MD5) for every entry with a `key`, in every index file. */
async function hash(only?: string) {
  for (const key of await keys()) {
    if (!key.startsWith("index/") || !key.endsWith(".json")) continue;
    if (only && key !== `index/${only}`) continue;
    const url = new URL(key, MEDIA);
    const index = JSON.parse(await Deno.readTextFile(url));
    let changed = 0;
    for (const list of Object.values(index)) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (typeof entry?.key !== "string") continue;
        const file = new URL(entry.key, MEDIA);
        if (!(await exists(file))) throw new Error(`${key}: no ${entry.key}`);
        const next = (await md5(file)).slice(0, 12);
        if (entry.hash !== next) changed++;
        entry.hash = next;
      }
    }
    await Deno.writeTextFile(url, JSON.stringify(index, null, 2) + "\n");
    console.log(`${key}: ${changed} hashes changed`);
  }
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

/** Calls curl with SigV4 signing. The keys go through stdin, not the command line. */
function r2(args: string[]) {
  const user = `${env("R2_ACCESS_KEY_ID")}:${env("R2_SECRET_ACCESS_KEY")}`;
  return run("curl", [
    "-sS",
    "-K",
    "-",
    "--aws-sigv4",
    "aws:amz:auto:s3",
    ...args,
  ], `user = "${user}"\n`);
}

async function upload() {
  const bucket = `${env("R2_ENDPOINT")}/${env("R2_BUCKET")}`;
  const list = await keys();
  let sent = 0;
  await pool(list, 6, async (key) => {
    const local = new URL(key, MEDIA);
    const target = `${bucket}/${
      key.split("/").map(encodeURIComponent).join("/")
    }`;
    const head = await r2(["-I", target]);
    const etag = /^etag:\s*"?([0-9a-f]+)"?/im.exec(head.out)?.[1];
    if (etag === (await md5(local))) return;
    const extension = key.slice(key.lastIndexOf("."));
    // An index is read fresh; any other file is addressed by its hash.
    const cache = key.startsWith("index/")
      ? "no-cache"
      : "public, max-age=31536000";
    const put = await r2([
      "-f",
      "-T",
      local.pathname,
      "-H",
      `Content-Type: ${TYPES[extension] ?? "application/octet-stream"}`,
      "-H",
      `Cache-Control: ${cache}`,
      target,
    ]);
    if (!put.ok) throw new Error(`Upload failed for ${key}:\n${put.out}`);
    sent++;
    console.log(`Uploaded ${key}`);
  });
  console.log(
    `Uploaded ${sent} of ${list.length}; the rest were already current.`,
  );
}

if (import.meta.main) {
  const [command, arg] = Deno.args;
  const toAt = Deno.args.indexOf("--to");
  try {
    if (command === "convert") {
      await convert(arg, toAt >= 0 ? Deno.args[toAt + 1] : undefined);
    } else if (command === "hash") await hash(arg);
    else if (command === "upload") await upload();
    else {
      console.error(
        "Usage: deno task media <convert <folder> [--to <dir>]|hash [<index>]|upload>",
      );
      Deno.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
