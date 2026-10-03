# Open Dwarf vocabulary

Terms for the shared world and the people who connect to it.

## Language

**World authority**: The single source of accepted actions and world state in a
session.

**World host**: The browser that owns and advances a world while its tab is
open. It is the world authority in the current demo.

**Joining player**: A player who connects to an existing world host and controls
an entity in that world.

**Session**: One active shared world and its participants. A session ID lets
players find and join it.

**Join link**: A session-specific address that lets a player join that world
directly. It names the host's build, as in `/b/<label>/join/<session>`, so a
guest runs the same client as the host. The host display presents it as a QR
code.

**Host display**: The TV view that mirrors the world host's player view during a
live session.

**Authored area**: A playable area whose terrain is deliberately placed rather
than generated.

**Chunk**: A 16×16 horizontal region of world tiles across the world view
levels. The first expanded authored area contains four chunks.

**Material**: What a terrain tile is made of: air, stone, or one of seven ores
(coal, iron ore, gold ore, lapis, redstone, diamond, emerald). Every material
except air is solid and blocks movement like stone. Mining a tile leaves a
dropped item of the matching item kind.

**Spawn chunk**: The authored chunk where joining players first appear. Multiple
players may appear on the same tile.

**Entity view**: A player's view limited by current sight and remembered
terrain. Entities that leave sight do not remain as remembered ghosts.

**Sight boundary**: The edge between currently visible and hidden terrain in
entity view. A visible entity can appear partly transparent near this edge.

**Chat hearing range**: The area within five horizontal blocks and four z levels
of a client's entity where another entity's active message text can be read,
regardless of sight. The wider talking range may show only a talking indicator.

**Talking indicator**: A `:0` bubble attached to a speaker whose active message
is too far away to read but close enough to notice. Sight does not control the
indicator.

**Hearing log**: The scrolling panel of every message text the player's entity
heard in this session, plus system lines. It never holds messages outside chat
hearing range. A log button on touch and the backquote key open it.

**System line**: A log line from the game rather than a speaker, such as a
player joining, leaving, or changing names. Features add one through the shared
system-line function.

**UI layer**: The client module that lays out every UI element in CSS pixels
inside the safe area, scales it with the UI scale setting, draws it through the
renderer in the bitmap font, and routes pointer events. The game page holds a
canvas and nothing else visible.

**In-game keyboard**: The keyboard the game draws at the bottom of the safe area
on touch while chat is open. It has QWERTY letters, shift, a page of numbers and
symbols, space, backspace, send, and close, and holds the 120 characters a
message may have. The system keyboard never opens. _Avoid_: On-screen keyboard,
when the system's keyboard is meant

**Master view**: An unrestricted view of the world used to inspect development.
Every player can choose it in the current demo.

**Group stress run**: A 15-minute simulated group session that measures
performance and visual sync while players move, type, and chat on one machine
with about 100 ms round-trip delay. It does not require world interaction.

**Synthetic peer**: A scripted joining player used to load the world host during
a group stress run. It may participate in WebRTC without rendering WebGL.

**Rendered observer**: A stress-run client whose WebGL output is sampled for
visual-sync evidence.

**Destructive terrain edit**: A world change that removes a solid terrain tile.

**Mining**: A destructive terrain edit made by an entity. It always leaves the
tile's item as a dropped item.

**Additive terrain edit**: A world change that places a carried stone item into
the terrain as a solid tile.

**Place**: An additive terrain edit made by an entity. It spends one held stone
and turns an empty tile into stone at once. See
[docs/features/placing.md](docs/features/placing.md).

**Item kind**: A type of item, such as stone, coal, iron ore, gold ore, lapis,
redstone, diamond, emerald, or coin.

**Stack**: Items of one item kind with a count. A tile's dropped items and an
entity's inventory each hold at most one stack per item kind.

**Dropped item**: Items of one item kind that lie on a whole tile. Several kinds
can lie on the same tile, and items of one kind on a tile form one stack with a
count. Their icons take turns about once a second. They stay until picked up or
the session ends.

**Pickup**: Moving a whole stack of dropped items from a highlighted tile into
an entity's inventory. The world host checks reach and gives a contested stack
to the first request. Its system line goes only to the player who picked up.

**Inventory**: The items an entity carries, as stacks with counts. Every entity
starts with one pickaxe. Only its owner receives it.

**Inventory panel**: The panel B or the bag button opens. It lists the
inventory's stacks; interact or a tap makes the selected stack the held item.
While it is open, other players see the entity's typing bubble.

**Coin**: An item kind received for selling items. For now the number of coins a
player carries is their score.

**Pickaxe**: An item kind that lets an entity mine while the entity holds it.

**Held item**: The one inventory item an entity has selected to use. Any item
can be held, but only a held pickaxe changes what interact does.

**Highlighted tile**: The tile an entity aims at with the look control, shown by
an orange outline. With no aim, the entity's own tile is highlighted.

**Interact**: The one action control. On a highlighted tile it picks up dropped
items, starts mining when the entity holds a pickaxe, or opens the shop at the
shopkeeper.

**Mining progress**: The local player's view of a mining action in progress, a
square that grows inside the highlight until the tile breaks. Other players see
only the breaking decal. _Avoid_: Mining bar

**Breaking decal**: Crack marks on a tile that grow while any entity mines it.
Every player who can see the tile sees them.

**Pickup grid**: The dark squares that unfold into the 3×3 tiles around an
entity when it interacts with a tile that holds dropped items. Each square shows
one stack. More than nine stacks show a gray plus, and the selector scrolls
down.

**Stamina**: The sprint reserve of an entity. Sprint uses it over six seconds
and it refills in proportion over twelve seconds while the entity does not
sprint.

**Shopkeeper**: The NPC in the spawn room who buys items for coins.

**Spawn room**: The authored room in the spawn chunk where joining players first
appear.

**Generated terrain**: Terrain outside the authored area, made from the
session's seed.

**Visitor token**: A tab-held identifier used to reclaim a joining player's
place after a connection drop.

**Move intent**: A requested direction with a sequence number. The world
authority decides whether it becomes a move.

**Timed move**: A move between whole tiles with a start tick and duration.
Clients use it to draw continuous sprite movement.

**Elevation step**: A committed move between neighboring z levels while crossing
a one-level terrain height change. It can go up or down. _Avoid_: Climb, when
both directions are meant.

**Forced descent**: A downward elevation step caused by loss of support rather
than movement input. It may repeat until the entity reaches supported ground.

**Entity footprint**: The horizontal area an entity occupies for collision and
terrain overlap. One footprint can overlap several tiles at once.

**Presentation smoothing**: Client-side easing of a remote sprite toward its
latest authoritative position. It does not change world state. _Avoid_:
Presentation buffer

**Shopkeeper**: A fixed character on the reserved tile in the spawn room who
buys ore for coins at fixed prices. It sells nothing yet. Interact on its tile
opens the shop panel.

**Coin**: The item the shopkeeper pays in. A player's coin count is the score.

**Shell**: The small server that serves builds, hands out signaling and ICE
credentials, records history in the database, and shows the admin dashboard. It
is deployed rarely, from the CLI, and each deploy is recorded. _Avoid_: Server,
when the game client is meant

**Build**: The game client (`public/`, `src/client/`, `src/shared/`) at one git
commit. The shell serves its page and loads its files from jsDelivr, so a build
needs only a pushed commit, not a deploy. `/b/<sha7>` opens any build.

**Label**: A movable name for a build, such as `seeded-chunk-gen`. It points to
a branch (and follows its latest commit) or to one commit, and it can be
renamed. `/b/<name>` looks up a label, then a branch, then a commit. _Avoid_:
Slug, tag

**Main**: The build `/` serves. It is a saved commit, changed only by a
promotion.

**Promotion**: Making a build main. Each promotion is recorded with the commit
and the label it came from.

**Shell deploy**: One recorded deploy of the shell to Deno Deploy, with its
commit and time.

**Session channel**: The Xirsys signaling sub-channel created for one session.
Peers in a session exchange offers, answers, and ICE candidates through it, not
through the shell.

**Admin dashboard**: The public, read-only page at `/admin` that lists live
sessions, builds and labels, main and its promotions, shell deploys, and session
telemetry.
