# Client first demo

How the pieces fit together. Each feature has its own document under
[`docs/features/`](features/); this page only links them.

## What this branch keeps

The WebGL experiment gives the demo its floor texture, 16×16 dwarf sprite,
camera motion, movement rules, line of sight, edge and ceiling atlases, and
depth tint. The engine page gives it the VGA bitmap font and the Escape menu
structure (see [controls and UI](features/controls-and-ui.md)). The current demo
draws these with one small WebGL2 renderer. The older Rust engine and world
generation code stay on `webgl-version` for reference.

## The pieces

- **World host.** One browser tab owns the world, advances it on a fixed tick,
  and validates every guest action
  ([ADR 0001](adr/0001-browser-hosted-world-for-live-sessions.md)). See
  [world and terrain](features/world-and-terrain.md),
  [movement](features/movement.md), [sight](features/sight.md),
  [mining and items](features/mining-and-items.md),
  [inventory and shop](features/inventory-and-shop.md), and
  [chat](features/chat.md).
- **Guests.** Joining tabs send intents over WebRTC and draw what the host
  sends. See [networking](features/networking.md) and
  [controls and UI](features/controls-and-ui.md).
- **Shell.** The Deno server in `main.ts` and `src/server/` hands out signaling
  and ICE credentials, records sessions in Turso, and serves builds. See
  [sessions and signaling](features/sessions-and-signaling.md),
  [shell and builds](features/shell-and-builds.md), and the
  [admin dashboard](features/admin-dashboard.md).
- **Builds.** A pushed commit is a build the shell serves from jsDelivr, and
  main is the latest promotion
  ([ADR 0004](adr/0004-shell-serves-builds-from-commits.md)).

## Code

- `src/client/`: browser input, WebGL2 rendering, and WebRTC networking.
- `src/shared/`: world rules and move intent validation. Plain JavaScript with
  JSDoc types runs in the browser without compilation.
- `src/server/`: Deno TypeScript routes for static files, live sessions, session
  channels for signaling, ICE servers, and the local signaling relay.
- `public/`: the page (a canvas and a hidden live region), a small stylesheet,
  the browser entrypoint, and texture atlases.
- `tests/`: unit tests in `shared`, `client`, `server`, and `lint`, and browser
  tests in `e2e` (see [testing and evidence](features/testing-and-evidence.md)).

## Decisions and design notes

- [ADR 0001](adr/0001-browser-hosted-world-for-live-sessions.md),
  [0002](adr/0002-continuous-horizontal-positions.md),
  [0003](adr/0003-chunked-terrain-generated-on-demand.md), and
  [0004](adr/0004-shell-serves-builds-from-commits.md).
- [Live-session vision](live-session-vision.md),
  [movement design](movement-design.md),
  [multiplayer protocol design](multiplayer-protocol-design.md), and
  [sight boundary design](sight-boundary-design.md).
- [Shared vocabulary](../CONTEXT.md).
