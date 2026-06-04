# Getting Started

This guide takes you from zero to a running Open Dwarf server with a custom
mod loaded.

## Prerequisites

- [Deno](https://docs.deno.com/runtime/getting_started/installation) 2.0+
- [Rust toolchain](https://rustup.rs) (for building the WASM engine)
- [Chromium](https://www.chromium.org/) (for Playwright debugging examples)

You only need Rust on first run — the compiled WASM artifacts are checked in
under `static/game/` for everyday development.

## 1. Clone and install

```bash
git clone https://github.com/your-org/open-dwarf.git
cd open-dwarf
deno task check
```

`deno task check` runs the formatter, linter, type checker, and `cargo check`
against both native and `wasm32-unknown-unknown` targets. If it passes, your
toolchain is healthy.

## 2. Build the engine

Build the Bevy game library to WebAssembly:

```bash
deno task web-release    # optimized build
# or
deno task web-dev        # faster, larger build at /?debug
```

Output lands in `static/game/` and `static/game_debug/`.

## 3. Run the dev server

```bash
deno task dev
```

Open <http://localhost:8000> — you should see the game canvas.
For the debug build with verbose logging, open
<http://localhost:8000/?debug>.

## 4. Write your first mod

Create `mods/my-first-mod/mod.ts`:

```ts
import { createMod } from "@opendwarf/sdk";

export default createMod({
  name: "my-first-mod",
  version: "0.1.0",

  onPlayerJoin(ctx, player) {
    ctx.broadcast(`Welcome, ${player.name}!`);
  },

  onTick(ctx) {
    // Runs once per simulation tick (~10Hz by default).
  },
});
```

Restart the dev server. The mod runtime auto-discovers anything under `mods/`
that exports a default `createMod()` result.

## 5. Try the debugger

Open Dwarf ships a Playwright-based debugger you can use from any TypeScript
test or script:

```ts
// scripts/smoke.ts
import { createGameDebugger } from "@opendwarf/debugger";

const debug = await createGameDebugger({
  baseUrl: "http://localhost:8000",
});

const alice = await debug.connectPlayer("Alice");
await alice.performAction("move", { x: 5, y: 5 });
await debug.waitForState((s) => s.players.length === 1);

console.log(await debug.captureSnapshot());
await debug.close();
```

Run it:

```bash
deno run -A scripts/smoke.ts
```

## 6. What to read next

- [Modding API](./modding-api.md) — every hook and context method
- [Debugging with Playwright](./debugging-with-playwright.md) — the debugger in depth
- [Architecture](./architecture.md) — how the pieces fit together
- [API Reference](./api-reference.md) — exhaustive type listing

## Troubleshooting

**`deno task web-release` fails with `wasm32-unknown-unknown` target missing**

```bash
rustup target add wasm32-unknown-unknown
```

**The canvas is blank**

Make sure `static/game/` exists and is populated. Re-run `deno task web-release`.

**Playwright can't find Chromium**

Set `CHROMIUM_PATH` or edit `playwright.config.ts` — the launcher uses
`/usr/bin/chromium` by default.
