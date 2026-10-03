// Publish screenshots and videos for a ticket to the orphan `evidence` branch
// and print Markdown that embeds them in an issue or pull request.
//
// deno task evidence:publish <ticket-dir> <file>...
// Example: deno task evidence:publish 12-mining exports/evidence/mining.png
// Rename a file with path=name, because Playwright names every video
// video.webm: exports/playwright-results/<test>/video.webm=mining.webm
//
// Each video also gets a GIF preview, because a raw video link may download
// instead of playing in the GitHub mobile app.

const MEDIA = /\.(png|jpe?g|gif|webp|webm|mp4)$/i;
const VIDEO = /\.(webm|mp4)$/i;

const [ticket, ...files] = Deno.args;
if (!ticket || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(ticket) || !files.length) {
  console.error(
    "Usage: deno task evidence:publish <ticket-dir> <file>...\n" +
      "<ticket-dir> is lowercase, such as 12-mining.",
  );
  Deno.exit(2);
}
const inputs = files.map((arg) => {
  const [file, rename] = arg.split("=");
  const name = rename ?? file.split("/").pop()!;
  if (!MEDIA.test(name) || !/^[\w.-]+$/.test(name)) {
    throw new Error(`Not an image or video name: ${name}`);
  }
  return { file, name };
});
for (const { file } of inputs) await Deno.stat(file);

/** Run a command and return its trimmed standard output. */
async function run(cmd: string, args: string[], cwd?: string) {
  const result = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const out = new TextDecoder().decode(result.stdout).trim();
  if (!result.success) {
    const err = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${err || out}`);
  }
  return out;
}

const remote = await run("git", ["remote", "get-url", "origin"]);
const slug = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote)?.[1];
if (!slug) throw new Error(`Origin is not a GitHub remote: ${remote}`);
const rawBase = `https://raw.githubusercontent.com/${slug}/evidence/${ticket}`;

const dir = await Deno.makeTempDir({ prefix: "od-evidence-" });
let orphan = "";
const exists = await new Deno.Command("git", {
  args: ["fetch", "--quiet", "origin", "evidence"],
  stdout: "null",
  stderr: "null",
}).output();
try {
  if (exists.success) {
    await run("git", ["worktree", "add", "--detach", dir, "FETCH_HEAD"]);
  } else {
    await run("git", ["worktree", "add", "--detach", dir]);
    orphan = `evidence-${Date.now()}`;
    await run("git", ["switch", "--orphan", orphan], dir);
  }
  const target = `${dir}/${ticket}`;
  await Deno.mkdir(target, { recursive: true });
  const published: string[] = [];
  for (const { file, name } of inputs) {
    await Deno.copyFile(file, `${target}/${name}`);
    published.push(name);
    if (VIDEO.test(name)) {
      const gif = name.replace(VIDEO, ".gif");
      await run("ffmpeg", [
        "-loglevel",
        "error",
        "-y",
        "-i",
        file,
        "-vf",
        "fps=10,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
        `${target}/${gif}`,
      ]);
      published.push(gif);
    }
  }
  await run("git", ["add", ticket], dir);
  await run("git", ["commit", "--quiet", "-m", `Evidence for ${ticket}`], dir);
  // Workers publish at the same time. Their folders differ, so a rebase onto
  // the newer branch is always clean.
  for (let attempt = 1;; attempt++) {
    const push = await new Deno.Command("git", {
      args: ["push", "--quiet", "origin", "HEAD:refs/heads/evidence"],
      cwd: dir,
      stdout: "null",
      stderr: "piped",
    }).output();
    if (push.success) break;
    if (attempt === 5) {
      throw new Error(new TextDecoder().decode(push.stderr));
    }
    await run("git", ["fetch", "--quiet", "origin", "evidence"], dir);
    await run("git", ["rebase", "--quiet", "FETCH_HEAD"], dir);
  }
  const lines = published.map((name) => {
    const url = `${rawBase}/${encodeURIComponent(name)}`;
    return VIDEO.test(name) ? `[Video: ${name}](${url})` : `![${name}](${url})`;
  });
  console.log(lines.join("\n\n"));
} finally {
  await run("git", ["worktree", "remove", "--force", dir]).catch(() => {});
  if (orphan) await run("git", ["branch", "-D", orphan]).catch(() => {});
}
