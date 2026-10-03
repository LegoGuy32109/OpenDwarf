# Client first demo

## What this branch keeps

The WebGL experiment gives the demo its floor texture, 16×16 dwarf sprite,
camera motion, movement rules, line of sight, edge and ceiling atlases, and
depth tint. The engine page gives it the VGA bitmap font and the Escape menu
structure: Open Dwarf, Resume, Settings, Leave Game, and UI Scale. The current
demo draws these with one small WebGL2 renderer. The older Rust engine stays on
`webgl-version`.

A normal page starts the spawn room (`src/shared/spawn-room.js`): a 9×7 room at
z 4 in the 2×2 spawn chunks, one doorway in its south wall that opens into solid
stone, two stair tiles down to a tunnel at z 2, and a reserved shopkeeper tile.
Everything else is solid stone. The host and every joining player spawn inside
the room, and the corner NPC walks a square in its south west corner.
`?layout=test` loads the older layout below. A page with `?harness=1` uses that
test layout unless it adds `?layout=room`, so the motion and sight specs keep
their pillar and staircase.

The test layout is one 16×16 tile square across z levels 0–7. `?world=32` starts
an expanded 32×32 authored area with four fixed 16×16 chunks and the same eight
levels. The expanded area includes a second pillar. Terrain is stored per 16×16
chunk in a map keyed by chunk coordinates, which can be negative
([ADR 0003](adr/0003-chunked-terrain-generated-on-demand.md)).
`src/shared/terrain.js` is the API: `readTile` and `writeTile` for one material
at x, y, z; `world.generateChunk`, a hook `ensureChunk` calls to create a
missing chunk (the generator plugs into it); and `drainTileChanges`, which lists
the tiles written since the last call so the host can send them to peers. A tile
in a chunk that does not exist reads as solid stone. Materials and their stable
ids live in `src/shared/materials.js`: air, stone, then coal, iron ore, gold
ore, lapis, redstone, diamond, and emerald. Every material except air is solid.
The chunk wire accepts ids up to `MAX_MATERIAL`, and the renderer draws an ore
from `public/assets/ores.png`. A test row of each ore sits in the authored area.
The world host creates generated terrain from the session seed in
`src/shared/generation.js`: every chunk within one chunk of any player is
created, at most two per 50 ms tick, nearest first, and an existing chunk,
including the authored area, is never replaced. A chunk is solid stone with
noise caves that continue across chunk borders, and ore clusters by depth band:
coal and iron at z 5–7, gold, lapis, redstone and some iron at z 2–4, and
diamond and emerald at z 0–1. A chunk takes well under one millisecond to
generate. `?seed=` replays a world for tests. Joining players never generate;
they receive generated terrain only for tiles they see. A seven-step staircase
on the south edge reaches the top landing; a full-height pillar tests occlusion.
The view can show five lower levels, with deeper floors turning blue before they
disappear. There is no chunk unloading or persistence. Players and the corner
NPC use continuous x/y centers and half-tile square footprints. They stop
between tiles, slide along flat walls, and block one another when footprints
overlap. A one-level climb or descent is a short committed step with reserved
origin and landing footprints. The renderer interpolates elevation during the
step. See [movement design](movement-design.md).

`/entity` uses a 20-tile, three-axis field of view. Terrain leaving view is
remembered with a warm tint; unseen terrain is black. Remote entities fade by
their center's distance to the closest visible edge, and the fade persists when
they stop. A sight change blends over 150 ms; the guest can briefly retain the
last visible sprite position while it fades out. `/master` shows the full world
and permits camera panning while keeping at least one full row and column of the
authored square visible. The browser host computes each joining player's sight
and sends only currently visible entities and discovered terrain in `/entity`.
Terrain remembered from earlier sight keeps its last observed state. `/master`
requests a full snapshot from the host; any player can use it. Returning to
`/entity` drops master-only data and adds only tiles in the player's current
sight to entity memory. Master travel does not reveal the path in entity memory.
These commands grant no movement or world-editing powers. The host browser still
owns the full world, so this is a view protocol, not a security boundary.
Same-level rays check every grid cell touched at a corner, making sight
reciprocal between stationary positions. Different-height sight retains the
earlier ray rule. The host sends only entities whose center tile is visible.
Chat has its own recipient-specific feed: message text reaches a player within
five horizontal blocks and four levels; from five to twelve horizontal blocks
the feed carries only a `:0` talking indicator. Typing shows `...` only within
five blocks. Bubbles can be heard through walls and outside sight without
exposing the speaker's sprite or name. The hearing log keeps each message text
it receives once, so unheard messages never enter it. The world host adds join,
leave, and name change system lines to its own log and sends them to guests as
`system` packets on the reliable channel. Visibility and memory use one bit mask
per chunk in network snapshots, and terrain travels as run-length encoded
chunks. A joining player receives only the chunks that hold a tile it has seen.
The host skips superseded snapshots while a guest's data channel is backed up,
then sends the current state when that channel drains. R/V changes view level,
holding U/N lerps zoom, and touch offers pinch zoom and two-finger vertical drag
for view levels. A brief bitmap HUD shows both values during changes.

## Mining

Interact starts a mining action in `src/shared/mining.js`. A guest sends only
the tile it aimed at (`mine`, or `mine-cancel`); the world host checks that the
tile lies on the entity's level next to its center tile, holds a mineable
material (the table in `materials.js` gives each material's time), and that the
entity holds a pickaxe. The target locks at the start. Each host tick
`stepMining` cancels an action whose target left reach, whose held item changed,
or whose tile changed, and finishes the ones that are done. `completeMining` is
the one place a finished action is handled: it writes air with `writeTile` and
drops one item of the material's item kind on the tile. The host sends the tiles
`drainTileChanges` returns to each peer as a small `terrain` message, only for
tiles that peer sees now, and updates that peer's remembered terrain for them; a
tile out of sight keeps its last observed state until seen again. A `mining`
message lists the actions a peer can see (and its own), with elapsed and total
time, so a peer draws the breaking decal on other players' tiles and the miner
draws a growing square. Clients cancel when the aim changes by sending
`mine-cancel`.

## Items

`src/shared/items.js` holds the item model. An item kind is a string from
`ITEM_KINDS` (stone, coal, iron ore, gold ore, lapis, redstone, diamond,
emerald, coin, pickaxe), each with a frame in the item sprite sheet
`public/assets/items.png`, one column of 16×16 frames that
`scripts/make-item-sheet.ts` draws; the pickaxe is cut from the dwarf mining
frames on `main`. A stack is `{kind, count}`. Dropped items and inventories are
both plain stack lists with one stack per kind, and `addStack` and `takeStack`
change them, so the pickup grid (#18), the inventory panel and held item (#19),
and the shop (#20) reuse them. `droppedItems(world)` keeps the stacks that lie
on each tile for the session; nothing removes them but a pickup.
`inventoryOf(player)` is an entity's inventory, which starts with one pickaxe.
`heldItem` in `mining.js` still returns the pickaxe by default; #19 replaces it
with the entity's chosen item.

A pickup is a host decision. Interact on a highlighted tile that holds dropped
items calls `pickUp` on the host, or sends a `pickup` request with the tile from
a guest, both naming the item kind of the chosen stack. The host checks the
entity, the tile, the kind, and reach (the tile is on the entity's level, and is
its own tile or a neighbor), and moves that whole stack into the inventory. A
request names a kind rather than a list position because another pickup can
shift the list in between. It handles requests one at a time, so the first of
two contested requests gets the stack and the other receives "nothing to pick
up". The host sends each peer an `items` message with only the dropped items on
tiles that peer sees (all of them in master view) whenever that list changes,
and an `inventory` message with only that peer's own inventory. A pickup system
line goes to the player who picked up and nobody else, through `tell` next to
`announce` in `network.js`. A client draws one icon per tile, cycling the kinds
every `ICON_CYCLE_MS`. Interact on a tile with several stacks opens the pickup
grid instead, whose state and geometry live in `src/client/pickup-grid.js`.
`app.js` calls it each frame to close the grid when the entity leaves reach or
the tile empties, to move the selector, and to hand `scene.pickupCells` to the
renderer. While the grid is open, the look control and D-pad drive it, not the
aim or movement.

## Shop

`src/shared/shop.js` holds the price table (`PRICES`, one place) and
`sellItems`, the one sale rule. The shopkeeper stands on `SHOPKEEPER_TILE` in
the room layout only and is a drawn fixture, not an entity: it does not block
movement. A sale is a host decision. Interact on the shopkeeper's tile opens the
panel (`src/client/shop-panel.js`), which only asks. The host's own player calls
`sellItems`; a guest sends `sell` with an item kind and a count, or `all`. The
host checks the entity, that its tile is the shopkeeper's or a neighbor on the
same level, that the kind has a price (stone, the pickaxe, and coins do not),
that the inventory holds the count, and that the coin stack has room. A failed
check changes nothing and a guest gets `sell-result` with the reason. A sale
removes the items, adds coins to the inventory's coin stack, and adds the sale
line through `tell`, so only the seller sees it. The score is the coin count in
the inventory the client already receives. While the panel is open, interact and
the look controls drive it instead of mining and aiming, and movement input is
ignored.

## Why the visitor hosts the world

Each visitor can start moving before a server round trip. The visitor's browser
owns the world state. Deno Deploy serves code and hands out signaling
credentials, so isolated server instances do not need a shared in memory game
loop. The `/host` route lists recent visitor heartbeats and joins through a
WebRTC data channel. A Xirsys session channel carries connection signaling (see
Signaling); it does not carry game updates. The host displays a session-specific
QR code for `/join/<session>`. The Deno server generates its SVG with one
server-side dependency; guest browser code still has no build step.

The browser host applies each joining player's eight-direction input on its 20
Hz simulation tick. The joining browser predicts its own movement immediately.
The host sends recipient-specific full snapshots every 500 ms and compact
position updates about every 100 ms while entities move. Both browsers present
remote players about 150 ms behind the latest authoritative tick, interpolating
between received positions. Full snapshots acknowledge processed input and
correct meaningful local prediction errors. The renderer does not queue old
remote paths. The reliable ordered `world` channel carries state, chat, and
input. The unordered `motion` channel has `maxRetransmits: 0` and carries
independent filtered entity records without chat or unnecessary simulation
fields. Both channels share SCTP congestion control. Pending sends coalesce to
current state when each channel drains. Stops send a 300 ms settling tail, with
500 ms reliable snapshots as recovery.

Protocol version 3 requires a matching join/offer version. Complete snapshots
are validated before scene mutation. Motion is fenced by connection attempt,
view revision, sight revision, and tick. The guest retains only the newest
motion awaiting reliable sight. Older reliable state can refresh terrain and
sight without rewinding newer remote positions. Invalid motion is discarded.
Malformed reliable state requests a full resync. Repeated recovery failure
closes the connection with a refresh instruction. Incomplete attempts expire
after ten seconds independently of player creation.

This is not rollback netcode. Input acknowledgments indicate the latest received
direction, not completed movement. Input replay remains deferred. WebRTC uses
direct connectivity when ICE can establish it; Xirsys TURN credentials supply a
relay when needed.

Each joining tab keeps a session token while its tab exists. If its WebRTC
connection drops, it sends a fresh join request. The host keeps its sprite for
at most five seconds and preserves its name, tile, view mode, and entity terrain
memory for a later rejoin while the host world remains open. Ping activity also
expires a silent connection. The corner NPC follows an E, S, W, N loop and
pauses one second after every two loops. It uses the same move rules as players.

The admin panel records join time, selected ICE candidate types, and the last 32
ping round trips. It shows their median and 95th percentile. `/host?relay=1`
forces a TURN relay for a WebRTC diagnostic. Compare direct and relay paths on
one network and again with a phone on cellular service. Browser tests cover
function and screenshots; they do not substitute for those device measurements.

## Current limits

- `/host` and its APIs have no authentication. Anyone who knows the route can
  list and join active worlds in this stage.
- A world has one browser host and currently has no fixed joining cap. Host
  upload and browser performance set the practical limit. It ends when the host
  closes the page. A missed close signal leaves the session live until 45
  seconds pass without a heartbeat.
- A signal for a peer that is not connected to its session channel is dropped. A
  guest asks again when the host's `peer_connected` frame arrives, and otherwise
  retries its join after eight seconds.
- Joining players receive filtered state snapshots in `/entity` and can see
  brief corrections when the host rejects a predicted move. There is no clock
  synchronization, input replay, or authoritative server.
- Terrain memory and view mode live in the browser host; closing that world
  discards them. Guest packet filtering is not an anti-cheat boundary.
- Offline caching is deferred. A visitor needs the website to load the game.

## Signaling

Peers exchange offers, answers, and the leave notice through a Xirsys session
channel, the sub-channel `<XIRSYS_CHANNEL>/<session>`
([ADR 0004](adr/0004-shell-serves-builds-from-commits.md)). The shell holds the
Xirsys credentials. `src/server/session-routes.ts` answers:

- `POST /api/v1/sessions` with `{id, commit?, label?, hostKey?}` creates the
  channel, records the session with the host's build, and returns the host's
  `channel`, `token`, `host`, `signalUrl`, `iceServers`, and a `hostKey`. The
  host sends its `hostKey` back to get a fresh token for the same channel. The
  key is an HMAC of the session id, so the shell stores nothing. A taken id
  without its key answers 409. A build with no commit (the working tree) is
  stored as `local`.
- `POST /api/v1/sessions/<id>/join` with `{peer}` returns the same for a guest,
  and the host's `build`: `{commit, label, path}`. A session that ended answers
  404.
- `POST /api/v1/sessions/<id>/heartbeat` with the `x-host-key` header and
  `{players, commit?, label?}`. See Live sessions.
- `GET /api/v1/sessions/<id>/ice` returns fresh ICE servers, because TURN
  credentials last 60 seconds.
- `DELETE /api/v1/sessions/<id>` with the `x-host-key` header ends the session
  and deletes the channel. The host calls it when it leaves.

The client (`src/client/signaling.js`) opens `signalUrl`
(`wss://<host>/v2/<token>`) and sends
`{t:"u", m:{f, o:"message", t:<peer>}, p:<signal>}`
(`src/shared/signal-frame.js`). It names the sender from the frame's `f`, which
the channel sets. A token must be used before it expires, but an open socket
outlives it, so when a socket closes the client asks the shell for a new token.
`src/server/relay.ts` is the local relay: a WebSocket endpoint on the shell at
`/v2/<token>` that issues its own tokens and speaks the same frames. The shell
uses it when the Xirsys values are missing. Session starts and joins are limited
per IP in memory (120 a minute, so a room of phones on one Wi-Fi address fits;
ICE requests 240 a minute).

## Live sessions

The host sends a heartbeat about every 15 seconds with its player count and
build. The `x-host-key` header proves the host, so only the host updates its
session. A session with no heartbeat for 45 seconds counts as ended, but its row
stays as history. A heartbeat on a session the host ended answers 410. Public
reads, with no host key and no peer id in them:

- `GET /api/v1/sessions` lists live sessions, newest first.
- `GET /api/v1/sessions/recent?limit=` lists ended sessions, newest first. A
  session whose heartbeat timed out has `ended` set to that time.
- `GET /api/v1/sessions/<id>/telemetry` lists the stored summaries of a session.

Each session is
`{id, build:{commit,label,path}, started, lastHeartbeat,
playerCount, ended}`.
`path` is `/b/<commit>/`, the build's base path.

A guest joins on the host's build. The join response carries the host's build,
and a client whose own commit differs opens `<path>join/<session>` (`local` is
the commit of the working tree). The world host still validates every guest
action; the build only decides which client the guest runs.

`POST /api/v1/telemetry` keeps its validation and its console line, and stores
each `summary` for 30 days. `connection` and `error` events stay in the log.

`src/server/sweep.ts` deletes the Xirsys channel of every ended session. Deno
Deploy has no cron here, so each session start and heartbeat runs the sweep, at
most once a minute in each isolate. An isolate takes a lease on a session in
Turso before it deletes the channel, so isolates running at once delete a
channel once. A failed delete is tried again after the two minute lease. The
same run prunes telemetry older than 30 days once an hour. A host that loses its
heartbeat for 45 seconds, for example in a tab the browser throttles, can lose
its channel to the sweep.

## Shell database

The shell keeps labels, promotions, shell deploys, sessions, and telemetry
summaries in Turso (see ADR 0004). `migrations/` holds numbered SQL files.
`deno task db:migrate` applies the pending ones to the database named by
`TURSO_DB_URL` and `TURSO_DB_TOKEN` in `.env`, and `deno task db:migrate:prod`
reads `.env.prod`. Each applied file is recorded with its checksum in
`schema_migrations`, so a second run changes nothing and an edited migration is
refused. Add a schema change as a new numbered file.

`src/server/store.ts` is the one interface the shell uses. `createTursoStore`
talks to Turso, `createMemoryStore` serves unit tests, and `openStore()` picks
Turso when both variables are set and the memory store otherwise. Main is the
latest promotion. The shared cases in `tests/server/store_cases.ts` run against
both stores; the Turso run is skipped without credentials and needs a scratch
database, because the cases leave rows behind.

## Build routes

`src/server/builds.ts` serves the build pages. `/b/<name>` resolves `<name>` as
a label, then a branch, then a commit SHA of 7 to 40 hex characters. A branch
becomes its latest commit through the GitHub API (`GITHUB_TOKEN` when set),
cached for 60 s; a commit never changes, so its lookups and its page stay cached
for a day. The shell fetches that commit's `public/index.html` from jsDelivr,
sets `<base href>` to the commit's `public/` folder on jsDelivr, and fills the
build config with base `/b/<name>/`, an empty `api` (the shell), the label, and
the commit. `/`, `/host`, and `/join/<session>` serve main, the latest
promotion, the same way with base `/`; before the first promotion they show a
short message. An unknown name gets a 404 page that links to `/admin`.

The shell serves no files from disk, except for the build `local`.
`deno task
dev` sets `OD_LOCAL_BUILD=1`, so `/` and `/b/local` serve the working
tree, with `/js/`, `/css/`, `/assets/`, and `/src/` read from disk. Playwright
starts its server the same way, so e2e specs run the working tree. `/b/<sha>`
still loads from jsDelivr under `dev`, which needs a pushed commit.

## Build base path

A build can be served under a path such as `/b/test/`, with its files on another
origin ([ADR 0004](adr/0004-shell-serves-builds-from-commits.md)), so the client
assumes neither. `public/index.html` names its CSS and scripts with relative
paths. A `<base href>` in the page says where they live; the Deno server serves
them from `/`, and the shell sets it to the build's file origin. The shell also
fills `<script id="od-build" type="application/json">` with
`{"base", "api", "label", "commit"}`. `src/client/build.js` reads it: `base` is
the page's path prefix and `api` is the API origin. Without that script the base
is `/` and the API is the page's own origin.

Routes are read under the base: `<base>` starts a world host, `<base>host` lists
worlds to join, and `<base>join/<session>` joins one. A join link and its QR
code carry the base, so a guest opens the host's build. The client calls
`<api>/api/v1/...`; the Deno server answers the same routes at `/api/v1/` and at
their older `/api/` paths. `/api/v1/qr/<session>` encodes the `link` query
parameter when it ends in `/join/<session>`, and its own `/join/<session>`
otherwise. Browser code names no absolute `/css`, `/js`, `/src`, `/assets`, or
`/api` path except through this config. `tests/e2e/base-path.spec.ts` serves the
page at `/b/test/` with its files from a second local port.
