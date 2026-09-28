# Open Dwarf

A small browser world for testing movement, touch controls, chat, and a direct
connection between two players. This branch starts from `webgl-version` and has
no client build step or Rust runtime.

## Run

```sh
deno task start
```

Open `http://localhost:8000/` to start a local 16×16 world with eight view
levels, a staircase, and a center pillar. Open
`http://localhost:8000/admin` in another browser to see active worlds and join
one. A corner NPC loops around four tiles. The `/admin` route has no access
control in this demo. A host world accepts up to eight distinct joining tabs.

On a keyboard, ESDF moves the player, IJKL moves the camera, R/V changes the
view level, and holding U/N smoothly zooms out/in. The mouse wheel also zooms.
`T` opens chat, `/` opens a command, and Escape opens the menu. On a touch
screen, the left stick moves the player and the right stick moves the camera.
Both sticks have a visible center deadzone and eight direction guides. The
fullscreen button uses the browser API when available; on Safari, adding the
page to the Home Screen can hide browser controls.
Pinch to zoom or drag two fingers vertically to change view levels. The A
button opens the chat bar and the B button opens the menu. Use `/nick Josh
Hale` to set a name. Names are unique within a world. Use `/master` for an
unrestricted camera or `/entity` to return to the player's field of view.

## Code

- `src/client/`: browser input, WebGL2 rendering, and WebRTC networking.
- `src/shared/`: world rules and move intent validation. Plain JavaScript with
  JSDoc types runs in the browser without compilation.
- `src/server/`: Deno TypeScript routes for static files, presence, ICE
  configuration, and a KV signal mailbox.
- `public/`: HTML, custom CSS, browser entrypoint, and texture atlases.

Each visitor owns their world in the browser. Movement begins locally on the
next 50 ms simulation tick. Joining tabs connect as players through WebRTC.
Deno KV stores short lived presence and signaling messages.
It does not run the world. The host sends the small world state every 500 ms
with each recipient's latest processed input sequence. Each joining tab keeps
its own matching animation and eases genuine corrections. The admin panel shows
connection time, selected ICE route, and recent round trip times.

Each joining tab automatically rejoins after a connection drop. The host holds
its sprite for up to five seconds and keeps its name and tile for a later
rejoin while the world remains open. Remote player and NPC animations queue
their moves in order, starting two simulation ticks after the first move arrives.

For a TURN diagnostic, open `/admin?relay=1` and join a world. That join
forces relay candidates on both browsers and shows the selected candidate
types in the admin panel. A working TURN configuration is required. Normal
WebRTC joins allow a direct route. The Xirsys values belong in the server
environment; the browser receives temporary ICE credentials. For local testing,
put `XIRSYS_IDENT`, `XIRSYS_SECRET`, and `XIRSYS_CHANNEL` in an ignored `.env`
file and run `deno task start:env`.

After deployment, follow the [phone connection test](docs/phone-network-test.md)
to compare direct and TURN routes on Wi-Fi and cellular data. The opt-in
`/phone-test` route accepts a small set of remote commands under a random code.

The floor, edges, ceilings, depth tint, visibility, and player sprite come
from the WebGL experiment. The bitmap font and Escape menu labels come from
the engine page. The old Rust engine and world generation code remain in
`webgl-version` for reference. See
[`docs/architecture.md`](docs/architecture.md) for the design choice and
limits.

## Check

```sh
deno task verify
deno task e2e
deno task hooks
```

`verify` checks formatting, lint, types, and deterministic world tests. The
Git pre-push hook runs the same task. CI also runs Playwright in Chromium. The
Playwright tests compare desktop and phone screenshots and exercise the
WebRTC connection. Run `deno task e2e --grep 'host and two joining tabs'` to
check one host, two joining tabs, and each tab's view of remote movement on this
machine. The shared tests also replay delayed and reordered snapshots with a
fixed schedule. A system Chromium installation is used locally when present.

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
the app is deployed. Domain setup and deployment are manual steps. The code
does not register domains or publish a deployment.

See the [Deno Deploy KV guide](https://docs.deno.com/deploy/reference/deno_kv/)
and [build configuration](https://docs.deno.com/deploy/reference/builds/).
