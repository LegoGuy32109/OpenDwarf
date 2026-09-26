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
one. The `/admin` route has no access control in this demo. Only one visitor can
join a world.

On a keyboard, ESDF moves the player, IJKL moves the camera, R/V changes the
view level, and holding U/N smoothly zooms out/in. The mouse wheel also zooms.
`T` opens chat, `/` opens a command, and Escape opens the menu. On a touch
screen, the left stick moves the player and the right stick moves the camera.
Pinch to zoom or drag two fingers vertically to change view levels. The A
button opens the chat bar and the B button opens the menu. Use `/nick Josh
Hale` to set a name. Names are unique within a world. Use `/master` for an
unrestricted camera or `/entity` to return to the player's field of view.

## Code

- `src/client/`: browser input, WebGL2 rendering, and network transports.
- `src/shared/`: world rules and move intent validation. Plain JavaScript with
  JSDoc types runs in the browser without compilation.
- `src/server/`: Deno TypeScript routes for static files, presence, ICE
  configuration, and a KV signal mailbox.
- `public/`: HTML, custom CSS, browser entrypoint, and texture atlases.

Each visitor owns their world in the browser. Movement begins locally on the
next 50 ms simulation tick. The admin joins as another player through WebRTC
or HTTP POST plus SSE. Deno KV stores short lived presence and signal messages.
It does not run the world. The host sends the small world state every 500 ms to
correct the joined player's prediction. The admin panel shows connection time
and recent round trip times for either transport.

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
Playwright tests compare desktop and phone screenshots and exercise both
connection paths. A system Chromium installation is used locally when present.

## Deploy

The `deploy` section in `deno.json` uses a dynamic Deno Deploy app with
`main.ts` as its entrypoint. Create the `open-dwarf` app in the selected Deno
Deploy organization, then provision a Deno KV database and assign it to the
app. Deno Deploy supplies that database to `Deno.openKv()`. Set
`XIRSYS_IDENT`, `XIRSYS_SECRET`, and `XIRSYS_CHANNEL` if WebRTC should work
across networks that need TURN. The SSE path still works without TURN.

Set `opendwarf.joshhale.me` and any extra domains in Deno Deploy and DNS after
the app is deployed. Domain setup and deployment are manual steps. The code
does not register domains or publish a deployment.

See the [Deno Deploy KV guide](https://docs.deno.com/deploy/reference/deno_kv/)
and [build configuration](https://docs.deno.com/deploy/reference/builds/).
