# Open Dwarf

A small browser world for testing movement, touch controls, chat, and direct
WebRTC connections. This branch starts from `webgl-version` and has no client
build step or Rust runtime. The
[live-session vision](docs/live-session-vision.md) and
[shared vocabulary](CONTEXT.md) record the next group-demo milestone.

## Run

```sh
deno task start
```

Open `http://localhost:8000/` to start a local 16×16 world with eight view
levels, a staircase, and a center pillar. Open `http://localhost:8000/admin` in
another browser to see active worlds and join one. A corner NPC loops around
four tiles. The `/admin` route has no access control in this demo. Joining has
no fixed cap for stress testing; the practical limit is still being measured.
The host's QR code opens `/join/<session>` so a phone joins that world directly.
Press Q on the host or use the QR button to show the code again.

On a keyboard, ESDF moves the player, IJKL moves the camera, R/V changes the
view level, and holding U/N smoothly zooms out/in. The mouse wheel also zooms.
On the host, F3 toggles a small FPS, payload upload, queue, and join-failure
panel. `T` opens chat, `/` opens a command, and Escape opens the menu. On a
touch screen, the left stick moves the player and the right stick moves the
camera. Both sticks have a visible center deadzone and eight direction guides.
The fullscreen button uses the browser API when available; on Safari, adding the
page to the Home Screen can hide browser controls. Pinch to zoom or drag two
fingers vertically to change view levels. The A button opens the chat bar and
the B button opens the menu. Use `/nick Josh
Hale` to set a name. Names are
unique within a world. Any player can use `/master` for an unrestricted camera
and the complete world view, then `/entity` to return to the player's field of
view. Master travel does not add tiles to entity-view memory.

## Code

- `src/client/`: browser input, WebGL2 rendering, and WebRTC networking.
- `src/shared/`: world rules and move intent validation. Plain JavaScript with
  JSDoc types runs in the browser without compilation.
- `src/server/`: Deno TypeScript routes for static files, presence, ICE
  configuration, and a KV signal mailbox.
- `public/`: HTML, custom CSS, browser entrypoint, and texture atlases.

Each visitor owns their world in the browser. Movement begins locally on the
next 50 ms simulation tick. Joining tabs connect as players through WebRTC. Deno
KV stores short lived presence and signaling messages. It does not run the
world. The host sends a view filtered for each joining tab every 500 ms, and
when that player's sight moves to another tile. Visibility uses compact bit
masks on the wire. When a WebRTC channel backs up, the host coalesces unsent
snapshots and sends the newest state after the channel drains. Entity view
contains currently visible players and NPCs plus last observed terrain;
undiscovered terrain is unknown. Master view contains the full world. Each
snapshot acknowledges that recipient's latest processed input sequence. Each
joining tab keeps its own matching animation and eases genuine corrections. The
admin panel shows connection time, selected ICE route, and recent round trip
times.

Each joining tab automatically rejoins after a connection drop. The host holds
its sprite for up to five seconds and keeps its name and tile for a later rejoin
while the world remains open. View mode and discovered terrain also survive that
rejoin. Remote player and NPC sprites follow recent host positions with short
visual smoothing, without building a queue of stale moves.

For a TURN diagnostic, open `/admin?relay=1` and join a world. That join forces
relay candidates on both browsers and shows the selected candidate types in the
admin panel. A working TURN configuration is required. Normal WebRTC joins allow
a direct route. The Xirsys values belong in the server environment; the browser
receives temporary ICE credentials. For local testing, put `XIRSYS_IDENT`,
`XIRSYS_SECRET`, and `XIRSYS_CHANNEL` in an ignored `.env` file and run
`deno task start:env`.

After deployment, follow the [phone connection test](docs/phone-network-test.md)
to compare direct and TURN routes on Wi-Fi and cellular data. The opt-in
`/phone-test` route accepts a small set of remote commands under a random code.

The floor, edges, ceilings, depth tint, visibility, and player sprite come from
the WebGL experiment. The bitmap font and Escape menu labels come from the
engine page. The old Rust engine and world generation code remain in
`webgl-version` for reference. See
[`docs/architecture.md`](docs/architecture.md) for the design choice and limits.

## Check

```sh
deno task verify
deno task e2e
deno task hooks
```

`verify` checks formatting, lint, types, and deterministic world tests. The Git
pre-push hook runs the same task. CI also runs Playwright in Chromium. The
Playwright tests compare desktop and phone screenshots and exercise the WebRTC
connection. Run `deno task e2e --grep 'host and two joining tabs'` to check one
host, two joining tabs, and each tab's view of remote movement on this machine.
The shared tests also replay delayed and reordered snapshots with a fixed
schedule. A system Chromium installation is used locally when present.

## Group stress run

`deno task stress --smoke` runs a short two-guest check. For the sustained 16×16
baseline, run `deno task stress --count=20 --rendered=4 --duration=900`. The
host and four guests render WebGL; the other guests connect through WebRTC
without WebGL. `--rendered=19` exercises the separate 20-renderer profile. Add
`--world=32` to repeat the run across four fixed 16×16 chunks and all eight z
levels; the default keeps the original 16×16 baseline. The runner starts a local
server unless given `--url=https://...`. It applies 50 ms of game-message
delivery delay in each browser by default, approximating 100 ms round trip
without changing ICE or physical packet delay. Reports and raw samples land
under ignored `exports/stress/`; move reviewed summaries into
[stress-run reports](docs/stress-runs/README.md). Adding `?telemetry=1` to a
game URL opts that browser into structured, content-free diagnostic logs on Deno
Deploy. The runner enables it and marks its events as test traffic. For a second
application-delivery profile, add `--jitter=20 --loss=0.01`. The drop applies to
delivered game messages, not physical WebRTC packets.

## Deploy

The `deploy` section in `deno.json` uses a dynamic Deno Deploy app with
`main.ts` as its entrypoint. The `opendwarf` app has a Deno KV database
assigned. Deno Deploy supplies that database to `Deno.openKv()`. Set
`XIRSYS_IDENT`, `XIRSYS_SECRET`, and `XIRSYS_CHANNEL` so WebRTC can use TURN
when a direct connection is unavailable.

For CLI access to the existing `opendwarf` app, load `DENO_DEPLOY_TOKEN` from
`~/Projects/work-portal/.env` into the command environment. Do not copy the
token into this repository.

Set `opendwarf.joshhale.me` and any extra domains in Deno Deploy and DNS after
the app is deployed. Domain setup and deployment are manual steps. The code does
not register domains or publish a deployment.

See the [Deno Deploy KV guide](https://docs.deno.com/deploy/reference/deno_kv/)
and [build configuration](https://docs.deno.com/deploy/reference/builds/).
