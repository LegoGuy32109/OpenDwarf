# Open Dwarf — Agent Instructions

Open Dwarf is a Dwarf-Fortress-inspired, browser-playable game served by a
single **Deno Fresh** web server. It contains three rendering/engine surfaces,
all hosted by that one server:

- `/` — the **Bevy** game (`game_library/`, Rust→wasm). **Being deprecated.**
- `/webgl` — the "simple" TypeScript WebGL2 engine (`webgl2/` +
  `lib/webgl-world-sim.ts`). The current visual **parity reference**; slated for
  deletion at cutover.
- `/engine` — the **new Rust core** (`game_engine/`: `od_core`, `od_ui`,
  `od_world`, `od_wasm`), an immediate-mode UI engine compiled to wasm. This is
  the future; `od_world` (the sim) is still a stub.

See `docs/GAME_ENGINE_ARCHITECTURE.md` and `docs/design/` for the plan of
record. The testing-harness architecture is
`docs/design/game-testing-harness.md`.

## Cursor Cloud specific instructions

Standard commands live in `deno.json` (`tasks`) and the README; prefer those.
Notes below are the non-obvious bits for working in the cloud VM.

- **Runtime:** Deno is the core dependency (installed under `~/.deno/bin`, also
  on `PATH` at `/usr/local/bin/deno`). The startup update script runs
  `deno install` to refresh JS/TS deps (`deno.json` uses `nodeModulesDir: auto`;
  there is no `package.json`/npm lockfile — npm deps are managed through Deno).
- **Run the app (dev):** `deno run -A dev.ts`. This ensures the `/engine` wasm
  artifacts exist (builds via `scripts/bash/engine-dev.sh` if missing) and
  serves on `http://127.0.0.1:8000` (host/port fixed, `--strictPort`). Plain
  `deno task dev` runs `vite` without those args — use `dev.ts` for the
  Playwright-consistent `:8000` server.
- **Prebuilt wasm is committed** (`static/game/`, `static/game_debug/`,
  `engine/generated/`), so all three routes run **without** recompiling Rust.
  Rebuilding Rust→wasm (`deno task web-*`, `engine:*`) needs the
  `wasm32-unknown-unknown` target + `wasm-bindgen`/`wasm-opt`/`brotli`, which
  are **not installed** — only add them if you are changing Rust. Editing TS/TSX
  hot-reloads via Vite and needs no rebuild.
- **Lint:** `deno lint`. It currently reports ~10 **pre-existing**
  `require-await` findings (e.g. in `engine/runtime.ts`); those are code issues,
  not environment failures.
- **Unit tests:** `deno task unit` (`deno test tests/unit/`) — fast, all pass.
- **E2e tests:** `deno task test` (`npx playwright test`; reuses a running
  `:8000` server, else starts `deno run -A dev.ts`). `playwright.config.ts`
  hardcodes `/usr/bin/chromium`; the VM ships `google-chrome`, symlinked to that
  path (persisted in the snapshot). If a fresh pod lacks it, recreate:
  `ln -sf "$(command -v google-chrome-stable)" /usr/bin/chromium`.
- **Harness:** the working browser harness is `/engine?harness=1`
  (`globalThis.__openDwarfEngineHarness`, version 3 — `runScenario` + reserved
  `importReplay`/`stepSimTick` stubs), covered by `tests/engine-harness.test.ts`,
  `tests/engine-golden.test.ts`, `tests/engine-held-key.test.ts`, and
  `tests/engine-scenario.test.ts` (`deno task engine:test-scenario-browser`).
  Bless draw-hash fixtures with `deno task engine:bless-goldens` (or the
  `-native` / `-browser` variants). Scenario browser goldens:
  `ENGINE_SCENARIO_BROWSER_BLESS=1`. Native Scenario: `deno task engine:test-scenario`.
  The old `/webgl` harness surface has been retired; keep `/webgl` only as a
  manual visual-parity reference.
