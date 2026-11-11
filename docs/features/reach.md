# Reach and targeting

[ADR 0009](../adr/0009-reach-free-cursor-and-controller.md) holds the decision.
This page says how the code keeps it.

## Reach

Playable worlds restrict reach to Z=1. The default cursor selects the adjacent
movement-facing tile and keeps that facing at rest. A diagonal requires an open
corner path and current sight. Supporting floors and unused levels cannot be
mined or placed on. Explicit legacy fixtures retain the 3D reach rule.

`inReach` takes a `sees` function for the acting entity's current sight. The
world host passes the per-peer visible set for a guest (all tiles in a master
view) and `scene.visibility` for its own player. `seesFrom` makes the function
from a visible set. `startMining`, `miningCancelReason` (and so `stepMining`)
and `placeStone` use it; the existing refusal reasons stay, and `out of reach`
covers both path and sight. A call without `sees` checks the path alone; only
unit tests do that.

`interactPreview` (`src/shared/interact-preview.js`, apart from `reach.js` so
the mining and placing checks it calls can import `inReach`) names the action
interact would take on a tile: `pickup`, `shop`, `place`, `mine`, or null. It
runs the checks the host runs (`miningRefusal`, `placeRefusal`, the pickup
reach), so a null answer means the host would refuse. `shop` means a trader NPC,
Ulgar in the spawn room, stands on the tile within pickup reach.

## Held target

Holding a pickaxe starts mining immediately. The target stays pinned while
moving toward it, turns retarget immediately, and release or interruption stops
mining. Placement happens once on release. Eligible-item aim temporarily
overrides movement-facing, then restores it after release or cancellation. See
[controls and UI](controls-and-ui.md) for every input device.

## Dropped items

A peer sees a dropped item when the item's tile or the floor under it is in its
visible set (`itemSeen`). The host's `items` message to a guest and the host's
own items view both use it, so planar support inherits the playable cell
visibility and cannot reveal items behind a hidden playable cell.
