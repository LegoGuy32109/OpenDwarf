// Music tracks: convert them to Opus and upload them to the R2 bucket.
//
//   deno task music convert <folder of mp3s>   # writes public/assets/music/<name>.ogg
//   deno task music upload                     # puts every music.json track in the bucket
//
// The .ogg files are git-ignored; music.json, which lists them, is tracked. Conversion skips a
// track whose .ogg already exists. Upload skips a track whose bucket copy has the same MD5. The
// R2 keys come from .env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET.

const DIR = new URL("../public/assets/music/", import.meta.url);
const BITRATE = "64k";
const CACHE = "public, max-age=86400";

type Track = { file: string };

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

async function tracks(): Promise<Track[]> {
  const text = await Deno.readTextFile(new URL("music.json", DIR));
  return (JSON.parse(text) as { tracks: Track[] }).tracks;
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

async function convert(source: string | undefined) {
  if (!source) throw new Error("convert needs a folder of mp3s");
  const names: string[] = [];
  for await (const entry of Deno.readDir(source)) {
    if (entry.isFile && entry.name.endsWith(".mp3")) names.push(entry.name);
  }
  let made = 0;
  await pool(names, navigator.hardwareConcurrency || 4, async (name) => {
    const out = new URL(name.replace(/\.mp3$/, ".ogg"), DIR);
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

async function md5(url: URL): Promise<string> {
  const result = await run("md5sum", [url.pathname]);
  if (!result.ok) throw new Error(result.out);
  return result.out.split(" ")[0];
}

async function upload() {
  const bucket = `${env("R2_ENDPOINT")}/${env("R2_BUCKET")}`;
  const list = await tracks();
  let sent = 0;
  await pool(list, 6, async ({ file }) => {
    const local = new URL(file, DIR);
    if (!(await exists(local))) throw new Error(`Missing ${file}; convert it`);
    const target = `${bucket}/music/${encodeURIComponent(file)}`;
    const head = await r2(["-I", target]);
    const etag = /^etag:\s*"?([0-9a-f]+)"?/im.exec(head.out)?.[1];
    if (etag === (await md5(local))) return;
    const put = await r2([
      "-f",
      "-T",
      local.pathname,
      "-H",
      "Content-Type: audio/ogg",
      "-H",
      `Cache-Control: ${CACHE}`,
      target,
    ]);
    if (!put.ok) throw new Error(`Upload failed for ${file}:\n${put.out}`);
    sent++;
    console.log(`Uploaded ${file}`);
  });
  console.log(
    `Uploaded ${sent} of ${list.length}; the rest were already current.`,
  );
}

if (import.meta.main) {
  const [command, arg] = Deno.args;
  try {
    if (command === "convert") await convert(arg);
    else if (command === "upload") await upload();
    else {
      console.error("Usage: deno task music <convert <folder>|upload>");
      Deno.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
