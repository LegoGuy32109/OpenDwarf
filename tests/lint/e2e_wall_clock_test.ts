// E2E specs wait on world ticks, drawn frames, or game state (tests/e2e/time.ts), never on the
// wall clock: a fixed sleep or a time limit lets less of the game happen on a slow machine, which
// made specs flaky.
import { assertEquals } from "@std/assert";

const DIR = new URL("../e2e/", import.meta.url);
/** The helpers that own the remaining real waits. */
const ALLOWED_FILES = new Set(["time.ts", "evidence.ts"]);
/**
 * Sleeps, clock reads and time limits. Waits are bounded in ticks instead
 * (`waitFor`, `holdUntil`); the config holds the one hang limit.
 */
const BANNED =
  /\bwaitForTimeout\(|\bsetTimeout\(|\bsetInterval\(|\bperformance\.now\(|\bDate\.now\(|\btimeout:|\btest\.slow\(/;
/** A spec that tests real time itself says why on the line or the line above. */
const EXCUSE = /\/\/ wall-clock: \S/;

Deno.test("e2e specs do not sleep or read the clock", async () => {
  const found: string[] = [];
  for await (const entry of Deno.readDir(DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    if (ALLOWED_FILES.has(entry.name)) continue;
    const lines = (await Deno.readTextFile(new URL(entry.name, DIR))).split(
      "\n",
    );
    lines.forEach((line, index) => {
      if (!BANNED.test(line)) return;
      if (EXCUSE.test(line) || EXCUSE.test(lines[index - 1] ?? "")) return;
      found.push(`tests/e2e/${entry.name}:${index + 1}: ${line.trim()}`);
    });
  }
  assertEquals(
    found.sort(),
    [],
    "Wait with tests/e2e/time.ts (waitFor, holdUntil, waitTicks, waitFrames), bounded in ticks",
  );
});
