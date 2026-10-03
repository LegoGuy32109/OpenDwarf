// Markdown links to repository files must resolve, so a moved or renamed doc cannot leave a dead
// link behind.
import { assert, assertEquals } from "@std/assert";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The relative file targets of the inline Markdown links in `text`, ignoring code. */
export function relativeLinks(text: string): string[] {
  const prose = text.replace(/^```[\s\S]*?^```/gm, "").replace(
    /`[^`\n]*`/g,
    "",
  );
  const targets: string[] = [];
  for (
    const match of prose.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)
  ) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    targets.push(target.split("#")[0]);
  }
  return targets.filter((target) => target !== "");
}

async function markdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      if (
        !entry.name.startsWith(".") && entry.name !== "node_modules" &&
        entry.name !== "exports"
      ) {
        files.push(...await markdownFiles(path));
      }
    } else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

Deno.test("relativeLinks keeps file links and drops URLs, anchors, and code", () => {
  const text = [
    "[a](docs/a.md) [b](../b.md#part) [c](https://example.com/x.md) [d](#here)",
    "`[e](e.md)`",
    "```",
    "[f](f.md)",
    "```",
  ].join("\n");
  assertEquals(relativeLinks(text), ["docs/a.md", "../b.md"]);
});

Deno.test("every relative Markdown link in the repository resolves", async () => {
  const files = await markdownFiles(root);
  assert(files.length > 0);
  const broken: string[] = [];
  for (const file of files) {
    for (const target of relativeLinks(await Deno.readTextFile(file))) {
      const path = resolve(dirname(file), decodeURIComponent(target));
      try {
        await Deno.stat(path);
      } catch {
        broken.push(`${relative(root, file)} -> ${target}`);
      }
    }
  }
  assertEquals(broken, []);
});
