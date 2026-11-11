# Movement

Players and the corner NPC use continuous x/y centers and half-tile square
footprints. They stop between tiles, slide along flat walls, and block one
another when footprints overlap. Playable worlds set `world.planeZ=1`.
Continuous movement, NPC movement and legacy tile move intents remain on that
plane. Walls refuse climbing and unsupported ground refuses descending. The host
and local prediction call the same shared movement rules.

Explicit low-level fixtures without `planeZ` retain one-level climbs and
descents, with reserved origin and landing footprints and elevation
interpolation. See [movement design](../movement-design.md) and
[ADR 0002](../adr/0002-continuous-horizontal-positions.md).

On a keyboard, ESDF moves the player continuously in eight directions. Keyboard
diagonals and the left stick share the same full walking speed, 30 ft or 1 tile
per second; release a direction to stop between tile centers. H toggles sprint,
which doubles walking speed and drains stamina in 6 s. An empty reserve refills
in 12 s while not sprinting. Exhaustion locks sprint until stamina is full. On a
touch screen, the sprint button sits beside the right stick and shows the
remaining stamina.

Movement begins locally on the next 50 ms simulation tick. The browser host
applies each joining player's eight-direction input on its 20 Hz simulation
tick, and the joining browser predicts its own movement immediately. See
[networking](networking.md) for how movement travels.

The corner NPC follows an E, S, W, N loop around four tiles and pauses one
second after every two loops. It uses the same move rules as players.

Facing starts south (`{x:0,y:1}`) and follows nonzero intended movement as an
eight-direction octant. Blocked movement still turns the entity. Neutral input
preserves facing. Horizontal input continues to update `facingLeft` for sprite
flipping. A malformed off-plane entity cannot move until its state is corrected.

In a planar world, targeting defaults to the adjacent tile in retained facing.
An explicit aim can override that direction. Targets and reach must remain at
Z=1, including while a player is stationary. The existing diagonal reach rule
still requires at least one open side, so actions cannot pass through a closed
corner. Legacy fixtures without `planeZ` retain their previous 3D target rules.
