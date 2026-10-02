# Continuous movement design

Status: implemented. This records the agreed movement rules. The first playable
build uses a six-tick elevation step; this value can be tuned after controller
and phone playtesting.

## Speed

One tile is a 5 ft square and a D&D round is 6 seconds, so a 30 ft speed is
1 tile per second. The default is 30 ft. The speed button steps through 30, 50,
and 60 ft (1, 1.67, and 2 tiles per second). The sprint button is the Dash
action and doubles the chosen speed. Both are per-player and are sent to the
world host with each input. The earlier build moved at 2.8 tiles per second.

## Position and input

- An entity has continuous x/y center coordinates and one logical integer z.
  Players and the corner NPC start with a square footprint half a tile wide and
  one z level tall. Other entity sizes can differ while using the same
  movement and collision rules.
- The keyboard and left stick choose one of eight directions at full speed.
  Keyboard diagonals are normalized. The stick gives neither finer angles nor
  partial speed. Flat travel has a short start and stop ramp but no commitment
  to a tile center. Releasing or changing direction can reshape the path.
- Two entities can share a tile when their boxes do not overlap. Their boxes
  block each other on contact. A diagonal direction against a flat wall keeps
  its free component at full walking speed. Contact at a corner with
  conflicting elevations stops movement until the entity reaches a clear face
  or corner; it does not choose a route automatically. A gap that only meets at
  a point cannot fit the footprint.
- The current looping NPC uses the same movement rules. It waits and retries
  when another entity blocks its route. It does not pathfind around the block.

## Elevation and support

- The center tile determines support, sight, and the origin of the eight-way
  target highlight. The collision footprint can overlap up to four tiles.
- Moving into a one-level raised tile starts an elevation step when the
  leading side of the footprint contacts a valid face or corner. Moving toward
  a one-level drop starts a downward step when the entity center crosses the
  edge. Voluntary movement stops at drops of two or more levels.
- A step request reaches the world authority when contact starts. The step
  finishes even if input stops or reverses; new input takes effect after it
  finishes. Logical z changes at 75% of the animation. The view level changes
  then, including the existing visible layer switch.
- A face step lands with the entire footprint just inside the destination
  tile's near edge, preserving its sideways coordinate. A diagonal step lands
  just inside the destination corner. Neither pulls the entity to a tile
  center. A landing that overlaps another entity is blocked like a wall until
  the held input finds a valid move. An accepted step reserves its landing;
  later entrants are blocked. The body needs clearance across its vertical
  space, including during the step.
- When support disappears, the entity finishes any elevation step already in
  progress. It then repeats downward elevation steps at a constant pace,
  keeping x/y fixed, until it reaches support. If an entity blocks the next
  landing, the descent pauses and retries when that space clears. This is a
  provisional forced-descent rule, not a gravity simulation.

## View and multiplayer presentation

- Entity view keeps the local character exactly at screen center, including
  near world boundaries. The area beyond the authored map can remain visible.
  Master view keeps its camera clamp. Sight and the orange target change their
  anchor tile when the entity center crosses a tile boundary.
- Local input appears immediately through prediction. Host and guests use the
  same remote presentation rule, with other entities about 100–150 ms behind
  authority to smooth updates. Small rejected predictions ease back while the
  local character stays centered; a correction that would visibly cross solid
  terrain or another entity snaps to authority.
- The current 100 ms host publish cap is not a presentation buffer. Remote
  motion needs timed updates and enough samples to interpolate across that
  delay. Measure motion and host upload on a phone and in the group stress run
  before fixing the update rate.
- Sight-edge opacity and distance-based chat bubbles are specified in
  [the sight-boundary design](sight-boundary-design.md).

## Deliberately deferred

- Tune flat speed, start and stop ramp, and elevation-step duration in a
  playable controller and phone build.
- Replace the provisional forced-descent chain with gravity only if later
  terrain interactions need it.
- Decide future item placement and other new terrain interactions when those
  features are built.
