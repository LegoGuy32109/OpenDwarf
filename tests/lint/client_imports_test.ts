// The client modules split out of `app.js` share state through `ctx`, not through each other. An
// import cycle among `src/client/*.js` would bring back the tangle, so it fails here.
import { assertEquals } from "@std/assert";

/** The static relative imports and re-exports of a module's source. */
export function importsOf(source: string): string[] {
  const found: string[] = [];
  for (
    const match of source.matchAll(
      /^\s*(?:import|export)\s[^;]*?\sfrom\s+["']\.\/([\w-]+\.js)["']/gm,
    )
  ) found.push(match[1]);
  for (
    const match of source.matchAll(/^\s*import\s+["']\.\/([\w-]+\.js)["']/gm)
  ) {
    found.push(match[1]);
  }
  return found;
}

/** One import cycle in the graph as a path that ends where it starts, or null. */
export function findCycle(graph: Map<string, string[]>): string[] | null {
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): string[] | null => {
    const at = path.indexOf(node);
    if (at >= 0) return [...path.slice(at), node];
    if (done.has(node)) return null;
    path.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    done.add(node);
    return null;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

Deno.test("findCycle reports a cycle and accepts a diamond", () => {
  const diamond = new Map([
    ["a.js", ["b.js", "c.js"]],
    ["b.js", ["d.js"]],
    ["c.js", ["d.js"]],
    ["d.js", []],
  ]);
  assertEquals(findCycle(diamond), null);
  const loop = new Map([
    ["a.js", ["b.js"]],
    ["b.js", ["c.js"]],
    ["c.js", ["a.js"]],
  ]);
  assertEquals(findCycle(loop), ["a.js", "b.js", "c.js", "a.js"]);
  assertEquals(findCycle(new Map([["a.js", ["a.js"]]])), ["a.js", "a.js"]);
});

Deno.test("importsOf reads static relative imports only", () => {
  const source = [
    'import { a } from "./one.js";',
    "import {",
    "  b,",
    '} from "./two-x.js";',
    'import { c } from "../shared/world.js";',
    'export { d } from "./three.js";',
    '  const lazy = () => import("./four.js");',
    '// import { e } from "./five.js";',
  ].join("\n");
  assertEquals(importsOf(source), ["one.js", "two-x.js", "three.js"]);
});

Deno.test("src/client/*.js has no import cycle", async () => {
  const graph = new Map<string, string[]>();
  for await (const entry of Deno.readDir("src/client")) {
    if (!entry.name.endsWith(".js")) continue;
    const source = await Deno.readTextFile(`src/client/${entry.name}`);
    graph.set(entry.name, importsOf(source));
  }
  const cycle = findCycle(graph);
  assertEquals(cycle, null, `import cycle: ${cycle?.join(" -> ")}`);
});
