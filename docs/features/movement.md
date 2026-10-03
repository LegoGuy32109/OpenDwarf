# Movement

Players and the corner NPC use continuous x/y centers and half-tile square
footprints. They stop between tiles, slide along flat walls, and block one
another when footprints overlap. A one-level climb or descent is a short
committed step with reserved origin and landing footprints. The renderer
interpolates elevation during the step. See
[movement design](../movement-design.md) and
[ADR 0002](../adr/0002-continuous-horizontal-positions.md).

On a keyboard, ESDF moves the player continuously in eight directions. Keyboard
diagonals and the left stick share the same full walking speed, 30 ft or 1 tile
per second by default; release a direction to stop between tile centers. G
cycles the speed through 30, 50, and 60 ft, and H toggles sprint, which doubles
it. On a touch screen, the two buttons under the left stick do the same.

Movement begins locally on the next 50 ms simulation tick. The browser host
applies each joining player's eight-direction input on its 20 Hz simulation
tick, and the joining browser predicts its own movement immediately. See
[networking](networking.md) for how movement travels.

The corner NPC follows an E, S, W, N loop around four tiles and pauses one
second after every two loops. It uses the same move rules as players.
