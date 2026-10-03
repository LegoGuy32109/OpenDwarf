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
The code is hidden at start. Press Q on the host or use the QR button to show
it in the top right corner.

On a keyboard, ESDF moves the player continuously in eight directions. Keyboard
diagonals and the left stick share the same full walking speed, 30 ft or 1 tile per
second by default; release a direction to stop between tile centers. G cycles the
speed through 30, 50, and 60 ft, and H toggles sprint, which doubles it. On a
touch screen, the two buttons under the left stick do the same. In entity view, IJKL points an orange
square at one of the eight neighboring tiles. R/V selects the view level; the
square appears at the player's level or one level above or below. In master
view, IJKL pans the camera. Holding U/N smoothly zooms out/in. The mouse wheel
also zooms.
On the host, F3 toggles a small FPS, payload upload, queue, and join-failure
panel. `T` opens chat, `/` opens a command, and Escape opens the menu. On a
touch screen, the left stick moves the player and the right stick points at a
neighbor in entity view or pans in master view. Both sticks have a visible
center deadzone and eight direction guides.
With a gamepad connected to the device, press a button while the page is
focused. The left stick or D-pad moves, and the right stick points at a neighbor
in entity view or pans in master view.
Buttons 4/5 change the view level, 6/7 zoom, and 3 opens the menu. Button 1 has
no chat action. The browser can report a standard layout or the raw layout of
the Afterglow Wireless Deluxe Controller. The Afterglow Wireless
Deluxe Controller's USB connection charges it but does not send input. Pair
that model over Bluetooth to play.

The fullscreen button uses the browser API when available; on Safari, adding the
page to the Home Screen can hide browser controls. Pinch to zoom or drag two
fingers vertically to change view levels. The on-screen A button opens the chat
bar, and the on-screen B button opens the menu. Use `/nick Josh
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
snapshots and sends the newest state after the channel drains. Movement also
coalesces to the newest unsent state and sends a 300 ms settling tail after a
stop. An incomplete join expires after ten seconds. Entity view
contains currently visible players and NPCs plus last observed terrain;
undiscovered terrain is unknown. Master view contains the full world. Each
joining tab also receives chat by distance from its character: message text
within five horizontal blocks and four levels, a `:0` talking indicator from
five through twelve blocks, and no bubble beyond that range. Typing appears as
`...` within five blocks. Speech passes through walls and sight boundaries.
Chat uses the reliable `world` channel with snapshots and player input.
Replaceable movement uses a separate unordered `motion` channel with zero
retransmissions. Both channels must open to complete a join. Motion packets
carry attempt, view, and sight revisions so delayed updates cannot restore an
older view. The wire uses validated JSON and rejects incompatible versions
with a refresh instruction. Each snapshot acknowledges that recipient's latest
received input sequence.
Each joining tab predicts its own position, and the host sends movement positions
about every 100 ms for smooth remote interpolation. Meaningful corrections ease
back toward the host position. The
admin panel shows connection time, selected ICE route, and recent round trip
times.

Each joining tab automatically rejoins after a connection drop. The host holds
its sprite for up to five seconds and keeps its name and tile for a later rejoin
while the world remains open. View mode and discovered terrain also survive that
rejoin. Remote player and NPC sprites interpolate recent host positions with a 150 ms
presentation delay.

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

For current continuous movement, start a dedicated local server and run:

```sh
deno run -A scripts/benchmark-motion.ts --url=http://127.0.0.1:8000 --count=20 --rendered=4 --duration=60 --world=16 --rate=10 --seed=9
```

The benchmark measures actual x/y movement, both channel queues and payload,
frame timing, prediction corrections, and chat delivery. The URL is required;
the script does not start a server. `--duration=900` gives a 15-minute hold.
The host and four guests render WebGL. Other guests connect without rendering.
Use `--rendered=19` for host plus 19 rendered guests, `--world=32` for the larger
world, or `--view=master` to compare master view. `--rate=20` is a harness-only
experiment. The live default remains 10 Hz pending the rate review.

By default each browser delays game-message delivery by 50 ms, approximating
100 ms round trip without changing ICE or physical packet delay. Add
`--jitter=20 --loss=0.01` for jitter and 1% replaceable motion-message loss.
Reliable state/chat/input are not dropped. These conditions do not simulate
physical SCTP loss. Reports and traces land under ignored `exports/benchmarks/`.
Run browser workloads sequentially and keep served files unchanged during a run.
Reviewed summaries belong in [stress-run reports](docs/stress-runs/README.md).
The older `deno task stress` runner remains for historical comparisons, but its
committed-step movement counters do not measure continuous movement correctly.

`deno task capture:sync` records a five-second visual comparison from the host
and the 20th peer against the deployed site. All 20 peers use WebRTC, while the
host and 20th peer render WebGL. The script places players on separate walkable
cells, uses `/master` and the same zoom on both views, and records randomized
movement. It writes individual and side-by-side MP4 files plus a movement
manifest under ignored `exports/visual-sync/`. Pass
`--url=http://127.0.0.1:8000` for a server already running locally or
`--delay=<milliseconds>` to change the per-message application delay.

## Deploy

The `deploy` section in `deno.json` uses a dynamic Deno Deploy app with
`main.ts` as its entrypoint. The `opendwarf` app has a Deno KV database
assigned. Deno Deploy supplies that database to `Deno.openKv()`. Set
`XIRSYS_IDENT`, `XIRSYS_SECRET`, and `XIRSYS_CHANNEL` so WebRTC can use TURN
when a direct connection is unavailable.

For CLI access to the existing `opendwarf` app, load `DENO_DEPLOY_TOKEN` from
`~/Projects/work-portal/.env` into the command environment. Do not copy the
token into this repository.

The `client-first-deno` branch is linked to the `opendwarf` app. Pushing the
branch triggers a Deno Deploy build; verify the served client files and CI after
the push. `opendwarf.joshhale.me` is already configured. Add any extra domains
in Deno Deploy and DNS manually; the code does not register domains.

See the [Deno Deploy KV guide](https://docs.deno.com/deploy/reference/deno_kv/)
and [build configuration](https://docs.deno.com/deploy/reference/builds/).
