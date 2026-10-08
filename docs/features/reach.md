# Reach and the free cursor

[ADR 0009](../adr/0009-reach-free-cursor-and-controller.md) holds the decision.
This page says how the code keeps it.

## Reach

An entity reaches the 3×3×3 tiles around its center tile `C`. A target `T` is in
reach when the entity sees `T` now and an open path leads to it. `pathReach` in
`src/shared/reach.js` holds the path rule, and `inReach` adds sight:

| Level of `T`  | `T` is in reach when                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Same as `C`   | it is an orthogonal neighbor, or `C` itself; a diagonal needs one of the two tiles between open  |
| One above `C` | it is directly above `C`; any other tile needs the tile above `C` open, then the same-level rule |
| One below `C` | never directly under `C`; any other tile needs the tile directly above `T` (on `C`'s level) open |

The cursor's level is the view level (R and V). Mining a tile on another level
works, so a dwarf can dig up and down, never under its own feet.

`inReach` takes a `sees` function for the acting entity's current sight. The
world host passes the per-peer visible set for a guest (all tiles in a master
view) and `scene.visibility` for its own player. `seesFrom` makes the function
from a visible set. `startMining`, `miningCancelReason` (and so `stepMining`)
and `placeStone` use it; the existing refusal reasons stay, and `out of reach`
covers both path and sight. A call without `sees` checks the path alone; only
unit tests do that.

`interactPreview` names the action interact would take on a tile: `pickup`,
`shop`, `place`, `mine`, or null. It runs the checks the host runs
(`miningRefusal`, `placeRefusal`, the pickup reach), so a null answer means the
host would refuse. The shopkeeper stands in every layout but `"test"`.

## Free cursor

Starting an action does not lock the cursor. Mining goes on while its target
stays in reach, the held item is unchanged and the tile is unchanged; the host
cancels it otherwise. Clients send no `mine-cancel` when the aim moves. Interact
on the tile being mined cancels it (`mine-cancel` from a guest). Interact on
another tile cancels the mining and does the new action there.

## Dropped items

A peer sees a dropped item when the item's tile or the floor under it is in its
visible set (`itemSeen`). The host's `items` message to a guest and the host's
own items view both use it, so mining around a corner shows the floor before the
open tile above it.
