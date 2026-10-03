# Worker primer

What an agent needs before changing Open Dwarf. Read this instead of every doc;
open the others when your ticket touches their area.

## Shape

- The game runs in the browser. One tab is the **world host**: it owns the world
  and validates every guest action. Guests send intents and draw what the host
  sends. See ADR 0001.
- The **shell** (`main.ts`, `src/server/`) serves builds, hands out signaling
  and ICE credentials, and records labels, sessions, and telemetry in Turso. It
  is deployed rarely. A client change needs only a push (ADR 0004).
- Browser code is plain JavaScript with JSDoc types and no build step. Server
  code is Deno TypeScript.

## Where things are

| Area                              | Files                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| World state, ticks, players       | `src/shared/world.js`, `locomotion.js`, `surface.js`                                             |
| Terrain, chunks, materials        | `src/shared/terrain.js`, `materials.js`, `generation.js`, `spawn-room.js`, `chunk-wire.js`       |
| Mining, items, inventory, shop    | `src/shared/mining.js`, `items.js`, `held-item.js`, `shop.js`, `target.js`                       |
| Chat and hearing log              | `src/shared/chat.js`, `hearing-log.js`                                                           |
| Network messages and validation   | `src/shared/protocol.js`, `wire.js`; host and guest in `src/client/network.js`                   |
| Client startup and shared state   | `src/client/app.js` (wiring only), `context.js` (the `ctx` object, held-item and sale requests)  |
| Input and gamepad                 | `src/client/input.js` (handlers), `input-read.js` (directions)                                   |
| Interact, mining, pickup, placing | `src/client/interact.js`                                                                         |
| Chat typing and keyboard          | `src/client/chat-input.js`                                                                       |
| Panels, HUD view, drawn state     | `panels.js`, `ui-view.js`, `display.js`, `inventory-panel.js`, `shop-panel.js`, `pickup-grid.js` |
| Hosting, joining, telemetry       | `src/client/session.js`; network in `network.js`                                                 |
| Frame loop and camera             | `src/client/loop.js`; `harness.js` exposes `globalThis.__od`                                     |
| Drawing                           | `src/client/render.js` (WebGL2, bitmap font in `public/assets/font.png`)                         |
| Build routing, API, store         | `src/server/builds.ts`, `session-routes.ts`, `admin-api.ts`, `store.ts`, `migrations/`           |
| Unit tests                        | `tests/shared`, `tests/client`, `tests/server`                                                   |
| Browser tests                     | `tests/e2e` (`?harness=1` loads the test layout and exposes `globalThis.__od`)                   |

## Rules that bite

- A guest action is a message the host checks: add the message to `protocol.js`
  and `wire.js` validation, apply it on the host, and send the result back.
  Never trust guest state.
- Terrain changes go through `writeTile`, and the host sends them with
  `drainTileChanges`. Do not resend whole chunks.
- Touch buttons act on `pointerdown`: iOS sends no click while another finger is
  on the screen.
- Canvas UI stays inside `scene.safe` (the safe-area insets).
- Use a distinct `PORT` for e2e, because Playwright reuses a server already on
  its port.
- Document your feature in its file under `docs/features/` (a new file gets one
  line in the README index). Do not extend `README.md` or
  `docs/architecture.md`.
- Use the `CONTEXT.md` terms. Add a term there when you add a domain idea.

## Commands

```sh
deno task verify                      # fmt, lint, type check, unit tests
PORT=81xx deno task e2e <spec files>  # browser tests on your own port
EVIDENCE=1 PORT=81xx deno task e2e <spec>
deno task evidence:publish <issue>-<slug> <files>
```
