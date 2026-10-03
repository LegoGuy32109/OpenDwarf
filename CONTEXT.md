# Open Dwarf vocabulary

Terms for the shared world and the people who connect to it.

## Language

**World authority**:
The single source of accepted actions and world state in a session.

**World host**:
The browser that owns and advances a world while its tab is open. It is the
world authority in the current demo.

**Joining player**:
A player who connects to an existing world host and controls an entity in that
world.

**Session**:
One active shared world and its participants. A session ID lets players find
and join it.

**Join link**:
A session-specific address that lets a player join that world directly. The
host display presents it as a QR code.

**Host display**:
The TV view that mirrors the world host's player view during a live session.

**Authored area**:
A playable area whose terrain is deliberately placed rather than generated.

**Chunk**:
A 16×16 horizontal region of world tiles across the world view levels. The
first expanded authored area contains four chunks.

**Material**:
What a terrain tile is made of: air, stone, or one of seven ores (coal, iron
ore, gold ore, lapis, redstone, diamond, emerald). Every material except air is
solid and blocks movement like stone. Mining a tile leaves a dropped item of the
matching item kind.

**Spawn chunk**:
The authored chunk where joining players first appear. Multiple players may
appear on the same tile.

**Entity view**:
A player's view limited by current sight and remembered terrain. Entities
that leave sight do not remain as remembered ghosts.

**Sight boundary**:
The edge between currently visible and hidden terrain in entity view. A visible
entity can appear partly transparent near this edge.

**Chat hearing range**:
The area within five horizontal blocks and four z levels of a client's entity
where another entity's active message text can be read, regardless of sight.
The wider talking range may show only a talking indicator.

**Talking indicator**:
A `:0` bubble attached to a speaker whose active message is too far away to
read but close enough to notice. Sight does not control the indicator.

**Hearing log**:
The scrolling panel of every message text the player's entity heard in this
session, plus system lines. It never holds messages outside chat hearing range.
A log button on touch and the backquote key open it.

**System line**:
A log line from the game rather than a speaker, such as a player joining,
leaving, or changing names. Features add one through the shared system-line
function.

**Master view**:
An unrestricted view of the world used to inspect development. Every player
can choose it in the current demo.

**Group stress run**:
A 15-minute simulated group session that measures performance and visual sync
while players move, type, and chat on one machine with about 100 ms round-trip
delay. It does not require world interaction.

**Synthetic peer**:
A scripted joining player used to load the world host during a group stress
run. It may participate in WebRTC without rendering WebGL.

**Rendered observer**:
A stress-run client whose WebGL output is sampled for visual-sync evidence.

**Destructive terrain edit**:
A world change that removes a solid terrain tile.

**Mining**:
A destructive terrain edit made by an entity. It always leaves the tile's
item as a dropped item.

**Additive terrain edit**:
A world change that places a carried stone item into the terrain as a solid
tile.

**Item kind**:
A type of item, such as stone, coal, iron ore, gold ore, lapis, redstone,
diamond, emerald, or coin.

**Dropped item**:
Items of one item kind that lie on a whole tile. Several kinds can lie on the
same tile, and items of one kind on a tile form one stack with a count.

**Inventory**:
The items an entity carries, as stacks with counts.

**Coin**:
An item kind received for selling items. For now the number of coins a player
carries is their score.

**Pickaxe**:
An item kind that lets an entity mine while the entity holds it.

**Held item**:
The one inventory item an entity has selected to use. Any item can be held, but
only a held pickaxe changes what interact does.

**Highlighted tile**:
The tile an entity aims at with the look control, shown by an orange outline.
With no aim, the entity's own tile is highlighted.

**Interact**:
The one action control. On a highlighted tile it picks up dropped items, starts
mining when the entity holds a pickaxe, or opens the shop at the shopkeeper.

**Mining progress**:
The local player's view of a mining action in progress, a square that grows
inside the highlight until the tile breaks. Other players see only the
breaking decal.
_Avoid_: Mining bar

**Breaking decal**:
Crack marks on a tile that grow while any entity mines it. Every player who can
see the tile sees them.

**Pickup grid**:
The dark squares that unfold into the 3×3 tiles around an entity when it
interacts with a tile that holds dropped items. Each square shows one stack.
More than nine stacks show a gray plus, and the selector scrolls down.

**Stamina**:
The sprint reserve of an entity. Sprint uses it over six seconds and it refills
in proportion over twelve seconds while the entity does not sprint.

**Shopkeeper**:
The NPC in the spawn room who buys items for coins.

**Spawn room**:
The authored room in the spawn chunk where joining players first appear.

**Generated terrain**:
Terrain outside the authored area, made from the session's seed.

**Visitor token**:
A tab-held identifier used to reclaim a joining player's place after a
connection drop.

**Move intent**:
A requested direction with a sequence number. The world authority decides
whether it becomes a move.

**Timed move**:
A move between whole tiles with a start tick and duration. Clients use it to
draw continuous sprite movement.

**Elevation step**:
A committed move between neighboring z levels while crossing a one-level
terrain height change. It can go up or down.
_Avoid_: Climb, when both directions are meant.

**Forced descent**:
A downward elevation step caused by loss of support rather than movement input.
It may repeat until the entity reaches supported ground.

**Entity footprint**:
The horizontal area an entity occupies for collision and terrain overlap. One
footprint can overlap several tiles at once.

**Presentation smoothing**:
Client-side easing of a remote sprite toward its latest authoritative
position. It does not change world state.
_Avoid_: Presentation buffer

**Phone test code**:
A temporary code that lets a test runner send predefined diagnostic commands
to a phone using the test route.
