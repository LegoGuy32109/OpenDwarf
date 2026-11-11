# Single-plane world and portrait controls

Status: implementation authorized. Josh asked agents to finish the described
changes while he is away and to track implementation in GitHub tickets. Rounds
one through seven record his decisions. Remaining details use the explicit
implementation defaults below and can be tuned after review.

## Destination

Agree on a playable single-plane world, more varied terrain artwork, and
portrait iPhone controls built around movement-facing and a held action button.
Produce enough decisions and acceptance scenarios to plan the implementation.

## Requested direction

- Play happens on one horizontal plane. Prevent movement between Z levels.
- Keep the 3D engine, existing chunk dimensions, and multiplayer streaming
  structure for now. Unused Z levels can remain allocated.
- Remove the blue depth tint, upper-layer shadows, and view-level controls from
  the new playing experience.
- Expand the terrain selection with more Excalibur textures to give the world
  variety.
- Prioritize a vertical iPhone layout with one movement joystick low on the left
  and a large, roughly square action button on the right.
- Show the equipped item on the action button, such as the pickaxe or stone.
- Remove the dedicated hearing-log button for now.
- Move Escape to the top center. Put chat at the bottom left and the bag at the
  bottom right. Place the bag below sprint on the right. Exact relative
  positions still need a layout review.
- Show an arrow or chevron indicating an entity's movement octant.
- Keep a default target indicator on the facing tile. Use rounded white corner
  brackets at roughly half opacity instead of the current thin square.
- Use movement-facing to choose the target for mining and placement. The same
  direction model should support combat later. Combat is outside this change.
- Require the action control to remain held while mining.
- Permit stationary mining using the last direction entered with the movement
  stick. Releasing the stick stops walking and preserves facing. Turning during
  held mining cancels the old target and immediately attempts the new target.

## Current implementation facts

- A chunk stores 16×16 horizontal cells across eight Z levels. The host
  generates chunks, sends terrain to guests, and retains edits across chunk
  unload and regeneration.
- Every known terrain material except air is solid. Walkable space is air above
  supporting solid terrain. The renderer finds solid surfaces below the selected
  view level and applies depth tints.
- Movement supports automatic climbs and descents. Disabling view-level controls
  alone will not prevent movement between levels.
- The generator distributes ore by depth. Fixing play to one plane requires a
  new distribution rule if every current ore should remain obtainable.
- The current target comes from a separate look input. With no look input,
  interaction targets the entity's own tile and the idle cursor is hidden.
- Mining currently continues after a single action press. Moving the cursor does
  not cancel it. Movement out of reach does.
- Touch UI is drawn in the WebGL canvas and routes each pointer separately.
  Portrait play must support moving with one finger while holding action with
  another.
- The repository's Excalibur sources currently include item icons and mining
  cracks. The full texture selection and import source need inspection before
  choosing additional terrain frames.

## Decisions already supplied

The requested direction above defines the scope. Preserve the existing chunk and
streaming structure while restricting the experience to one plane. This does not
mean reducing chunk storage to a single layer in this effort.

## Settled in round one

### Movement and facing

Releasing the movement control stops walking. The entity retains the last facing
octant, which supplies its default action target while stationary.

### Held mining and turning

The player can tunnel forward through successive blocks by holding action and
moving toward them. Moving toward a block keeps that block targeted until it
breaks. Releasing action stops mining.

A turn while action remains held cancels mining on the old target and
immediately attempts mining on the newly targeted block. A fresh action press is
not required. This settles the behavior of movement-facing turns. A pickaxe does
not enter directional aiming when dragged. Other eligible items can aim
independently of movement, as settled in round three.

### Planar cave and ore generation

Keep the current cave and ore-cluster style, expressed horizontally on one
playable plane. Every ore type must remain obtainable. Ore may spawn only on the
playable Z level, never in the supporting floor or unused levels.

The initial world remains a cave with walkable floors and mineable walls.

### Input devices

Keyboard, gamepad, and touch share the new movement-facing and held-mining
rules. Keyboard movement is ESDF and action is Space. Preserve IJKL for the
aiming interaction still to be designed. The action button will have a tap and
drag interaction that Josh wants to describe in the next round.

## Settled in round two

### Playable plane and supporting floor

The playable plane is Z=1 with a permanent supporting floor at Z=0. Mineable and
placeable blocks occupy Z=1. Mining removes a wall and exposes the floor
underneath. Ore occurs only at Z=1. The remaining allocated levels have no
gameplay role. Their contents still need a generation policy.

### Item-dependent action-button drag

Pressing the action button with a pickaxe starts mining immediately. The pickaxe
is not throwable and dragging it must not enter the aiming gesture.

An equipped item with a `throwable` or `aimable` capability can use a drag that
starts on the action button. Josh's examples are a bow, coin, and rock. Once the
drag passes a dead zone, show directional aiming feedback. A small joystick well
appears as the thumb drags, indicating the eight octants. The direction comes
from the drag away from its starting point.

The direction marker should visibly distinguish an intended aimed action. The
precise treatment is still open, such as a changed arrow color or another
indicator. Exact dead-zone size and joystick geometry also remain open.

A rock can have both a normal placement action on the selected square and a
directional throw. Round three settles how release distinguishes them.

The bow example establishes the need for an aimable item. Bow shooting,
ammunition, and combat are deferred, as settled in round four.

## Settled in round three

### All placement happens on release

Release places the equipped placeable item on the crosshaired tile. This rule
also applies to items that cannot be thrown or aimed. Holding the action control
alone does not repeatedly place blocks. Pickaxe mining remains an immediate
press-and-hold action.

For an item supporting placement and directional aiming, a normal placement
release requires that the gesture never entered directional aiming.

### Directional release and cancellation

After a drag crosses the aiming dead zone, releasing outside it performs one
aimed action in the selected octant. Returning inside the dead zone and
releasing cancels the gesture. A cancelled aiming gesture must not fall back to
placement. The input therefore needs to distinguish an ordinary placement press
from a press that entered aiming and then returned to center.

### Movement during directional aiming

The left stick continues moving the entity while the action-button drag
independently selects aim. Movement must not overwrite the active aim direction.
For example, the entity can walk south while aiming a coin north. The pickaxe
keeps the previously agreed movement-facing mining rules.

## Settled in round four

### Keyboard and gamepad equivalent

For an eligible item, holding Space on keyboard or ZR on gamepad arms the
action. IJKL or the right stick selects the aiming octant. Releasing Space or ZR
while aiming performs the action. Returning the aiming input to neutral before
releasing the action control cancels it. Cancelling an aimed action does not
become a placement.

The pickaxe retains movement-facing, hold-to-mine behavior. Aiming input does
not turn it into a throwable item or change its mining rules.

### Targeting after an aimed action

After an aimed action executes or is cancelled, the crosshair returns to the
direction last entered with the movement control. An aiming gesture overrides
default targeting only while active. Walking south while throwing north leaves
the default crosshair south afterward.

### Initial throwing scope

The first implementation includes actual coin and stone throwing. Bow shooting,
ammunition, and combat remain deferred. Throw range, flight, collisions,
landing, and inventory behavior still need decisions.

## Settled in round five

### Throw range

Throws initially travel up to four tile widths, measured as world distance. Drag
distance and hold time do not change the range. The selected octant determines
direction. Diagonal throws cover the same world distance as straight throws. The
range is an initial tuning choice that can change later.

### Throw collisions

Solid walls stop a thrown item at the last open tile before impact. Hitting a
player's hitbox also stops the item. This overrides the previous recommendation
that entities would not block flight. Throws do not bounce or deal damage.

The item remains collectible rather than being automatically caught. Round six
settles the player-impact landing tile and the initial NPC collision behavior.

### Inventory and landing

Each accepted throw removes one coin or stone from inventory. The item lands as
a normal dropped item for ordinary pickup. A cancelled or refused throw spends
nothing. A thrown stone does not become a placed wall.

## Settled in round six

### Impact landing and NPCs

On hitting a player, a thrown item drops on that player's occupied tile. NPC
hitboxes also stop throws and use the same landing behavior. Neither impact
automatically collects the item or deals damage. Use ordinary pickup. This is
the initial behavior and can be revisited later.

### Portrait control arrangement

Escape sits at the top center. The movement stick is low on the left, with chat
below it at the bottom left. A large action button is low on the right. Sprint
sits on the outer right, above the bag at the bottom right. The stick and action
button are the main thumb targets. All controls stay inside the iPhone's safe
areas. The dedicated hearing-log button is absent.

Agreed relative arrangement, with sizes and spacing still to be reviewed:

```text
┌──────────────────────────────┐
│             ESC              │
│                              │
│            WORLD             │
│                              │
│                              │
│   ( MOVE )    ┌────────┐      │
│              │ ACTION │ RUN  │
│              └────────┘      │
│   CHAT                  BAG  │
└──────────────────────────────┘
```

### Initial terrain palette scope

Start with Excalibur stone-family variants and varied floor textures. Mineable
stone variants retain stone's mining time and stone drop. Existing ores retain
their distinct mining times and drops. Distinct new materials with new mining
rules and drops are deferred. The supporting floor remains permanent.

## Settled in round seven

Preserve existing camera framing and lower the portrait controls. Josh clarified
that the current arrangement already broadly meets his intent and the controls
are simply too high. Do not add a taller footer or shrink the world viewport.

Walls continue blocking sight, unexplored terrain remains hidden, and remembered
terrain keeps its current tint. Preserve the existing RGBA multiplier
`[1, 0.86, 0.34, 0.95]` exactly. Remove depth-related blue tint and upper-layer
shadows without changing this remembered tint.

Texture variants form deterministic, coherent patches that continue across chunk
boundaries. Walkable floor and solid walls remain visually distinct. Unloading
and regenerating a chunk must preserve its appearance.

## Implementation defaults selected for unattended work

These details were not individually answered during the interview. They are
conservative, reviewable defaults under Josh's instruction to finish the change.

- Preserve the spawn room, Ulgar, and a safe connection to generated caves at
  Z=1. Remove stairs. All seven ores occur horizontally, with common coal and
  iron and rarer high-value ores. Preserve vein-like clusters and cave style.
  Avoid multiplying total ore density by eight when removing depth bands.
- Z=0 is permanent supporting stone without ore. Unused Z=2 through Z=7 are air
  without ore. Keep eight allocated levels, chunk keys, streaming, unload
  limits, edit replay, and guest visibility filtering.
- Enforce the plane on the host and in prediction, spawning, NPCs, targeting,
  mining, placing, and throws. Keep low-level 3D support for explicit legacy
  fixtures. All built-in playable recipes become planar.
- Facing follows nonzero intended movement even when blocked, persists on
  release, and starts south. Preserve horizontal sprite flipping and existing
  collision and corner reach rules. Prevent actions through closed corners.
- Keep the mining target pinned while moving toward it. Turns retarget at once
  while action is held. After a block breaks, choose the next adjacent target as
  the player advances. Do not mine distant blocks or repeat pickups.
- Release places one item on the current crosshaired tile. A coin tap without
  aiming does nothing. Preserve explicit NPC and pickup interactions. Opening a
  panel consumes that press and never repeatedly confirms while held.
- Pointer cancellation, focus loss, hidden tabs, panels, item changes, and
  disconnects cancel mining and armed actions without performing release. Host
  mining leases prevent a missing cancel packet from leaving it running.
- Aiming can re-enter after returning inside the dead zone. Releasing at center
  after any aiming cancels. Keep movement-facing separate from aim. Start with a
  tunable 16 CSS pixel dead zone and accessible touch geometry.
- Throws start at the entity's release position on Z=1, travel at ten tiles per
  second up to four tiles, and exclude the thrower's hitbox. Sweep walls and
  other players/NPCs. Walls drop at the last open tile. Entity hits drop on
  their tile. No bounce, damage, automatic catching, or lost items. The host
  owns inventory, flight, and landing.
- Landscape touch uses the same single-stick action model with a responsive
  arrangement. Preserve panel navigation and pinch zoom. Remove all Z-change
  gestures and bindings. Master view can pan but remains on the plane.
- Keep the hearing log and existing non-touch access. Remove its dedicated touch
  button. Avoid adding a new menu solely for this change.
- Use rounded half-opacity white local target corners. Show direction chevrons
  for visible moving entities and retain local facing at rest. Distinguish
  active aiming with a marker and the eight-octant well.
- Use available Excalibur stone-family art for the first palette. Import more
  pack textures where available. Preserve attribution and the pack's style.

## Details covered by implementation defaults

- Supporting-floor appearance and the unused layers' contents.
- Host enforcement of the plane, including guests, NPCs, spawning, actions,
  prediction, and any legacy movement path.
- How the pinned mining target behaves at tile-center boundaries and how the
  next target is selected after the current block breaks.
- Diagonal target reach and corner rules, wall sliding, and whether facing
  follows intended movement or actual displacement when blocked.
- Default facing at spawn and how other clients learn an entity's octant.
- Whether the chevron stays visible while stationary and which entities show it.
  The target brackets and direction marker serve different purposes.
- Pickup and conversation priority, and prevention of accidental actions
  immediately after a panel closes.
- Cancellation on pointer loss, a hidden tab, menu entry, disconnection, item
  changes, and other interruptions.
- Whether the hearing log remains available through another route.
- Input ordering for Space/ZR and directional aiming, and returning to
  directional aiming after a gesture has entered the dead zone.
- Default actions for non-placeable items without an aimed direction.
- Throw flight timing and presentation and host validation. Resolve these as
  item movement without combat damage. Bow shooting and ammunition remain
  deferred.
- Landscape touch layout, master view, and gestures.
- Terrain palette, visual variants versus distinct materials, ore frequency,
  world structure, spawn safety, and generation continuity across chunks.
- Which darkness belongs to sight and remembered terrain after depth effects
  disappear. Removing depth tint does not by itself decide visibility rules.
- Camera framing and safe areas with Safari chrome, the home indicator, and the
  in-game keyboard open.

## Documentation and implementation boundaries

Keep this document as the interview record. Use `CONTEXT.md` for settled domain
terms and `docs/adr/` for architectural decisions once the trade-offs are
agreed. Existing feature docs describe the shipped implementation until it
changes. Josh has now authorized GitHub tickets, parallel implementation,
commits, branch pushes, pull requests, and integration. Workers push only their
own branches. The coordinator owns merging. Production promotion and shell
deployment remain separate from this work.

The eventual plan should cover world generation, plane enforcement, rendering,
facing and targeting, held actions, portrait layout, and host/guest validation.
Tests must exercise stationary mining, turning, release, diagonal targeting,
simultaneous touch controls, and actions across chunk boundaries.

## Method

This session follows Matt Pocock's
[grill-with-docs](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md)
and its
[grilling](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md)
and
[domain-modeling](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md)
workflows. Use the existing repository's documentation layout.
