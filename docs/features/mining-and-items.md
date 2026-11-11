# Mining and items

## Mining

Holding the action control with a pickaxe starts mining the movement-facing
neighbor. The input adapter sends `mine-hold` every four world ticks while held,
and `mine-cancel` on release or interruption. The host grants a ten-tick lease.
Renewing the same target preserves its start tick and progress. A changed target
stops the previous action even if the new target is refused. Without a renewal,
mining stops at the lease deadline before completing or making another hit
sound. Disconnect and held-item changes also cancel mining.

The host checks integer tile coordinates, the play plane, the held pickaxe,
[reach](reach.md), sight, and the material. Movement preserves progress while
the pinned target remains in reach. Closed corners prevent mining. Stone takes 1
s, coal 1.5 s, iron ore 2 s, gold ore, lapis, and redstone 3 s, and diamond and
emerald 4.5 s. The unleased `mine` intent remains available only in explicit
legacy worlds without `planeZ`; playable worlds use `mine-hold`.

`stepMining` cancels invalid actions and completes finished ones. Completion
writes air through `writeTile` and drops one material item on the tile. The host
reveals terrain edits only to peers that see them. A reliable `mining` feed
carries visible actions and the recipient's own action, including elapsed and
total time for the existing breaking decal.

## Items

`src/shared/items.js` holds the item model. An item kind is a string from
`ITEM_KINDS` (stone, coal, iron ore, gold ore, lapis, redstone, diamond,
emerald, coin, pickaxe), each with a frame in the item sprite sheet
`public/assets/items.png`, one column of 16×16 frames that
`scripts/make-item-sheet.ts` builds from the Excalibur resource pack's icons in
`art/excalibur/item/` (see the README's credits): stone is an isometric cube
rendered from its stone block, the pickaxe is its stone pickaxe, and the coin is
its emerald with the hue turned to gold. A stack is `{kind, count}`. Dropped
items and inventories are both plain stack lists with one stack per kind, and
`addStack` and `takeStack` change them, so the pickup grid (#18), the inventory
panel and held item (#19), and the shop (#20) reuse them. `droppedItems(world)`
keeps the stacks that lie on each tile for the session; nothing removes them but
a pickup. `inventoryOf(player)` is an entity's inventory, which starts with one
pickaxe. `heldItem` in `mining.js` returns the chosen item, with the pickaxe as
the default.

## Pickup

Several kinds on one tile take turns showing their icon about once a second, and
a number marks a stack of more than one. Interact on a highlighted tile that
holds one stack picks it up into your inventory instead of mining, and the
hearing log says "Picked up coal ×1" to you alone. A tile with several stacks
opens the pickup grid: dark squares unfold into the 3×3 tiles around you, one
per stack with its icon and count. IJKL, the controller right stick, or the
D-pad moves the orange selector (the D-pad does not walk you while the grid is
open), and a tap on a square selects it. Interact picks up the selected stack.
With more than nine stacks a small gray plus shows in the bottom-right square,
and moving down scrolls. ESDF still walks you. Q, Escape, the gamepad's B, the
touch Back button, or walking out of reach closes the grid.

A pickup is a host decision. Interact on a highlighted tile that holds dropped
items calls `pickUp` on the host, or sends a `pickup` request with the tile from
a guest, both naming the item kind of the chosen stack. The host checks the
entity, the tile, the kind, and reach (the tile is on the entity's level, and is
its own tile or a neighbor), and moves that whole stack into the inventory. A
request names a kind rather than a list position because another pickup can
shift the list in between. It handles requests one at a time, so the first of
two contested requests gets the stack and the other receives "nothing to pick
up". The host sends each peer an `items` message with only the dropped items on
tiles that peer sees, or whose floor one level down it sees (all of them in
master view) whenever that list changes, and an `inventory` message with only
that peer's own inventory. A pickup system line goes to the player who picked up
and nobody else, through `tell` next to `announce` in `network-host.js`. A
client draws one icon per tile, cycling the kinds every `ICON_CYCLE_MS`. The
pickup grid's state and geometry live in `src/client/pickup-grid.js`. `loop.js`
calls `updatePickupGrid` (`panels.js`) each frame to close the grid when the
entity leaves reach or the tile empties, to move the selector, and to hand
`scene.pickupCells` to the renderer. While the grid is open, the look control
and D-pad drive it, not the aim or movement.

See [inventory and shop](inventory-and-shop.md) for what happens to the items
after pickup.

## Throwing coins and stone

`itemInfo(kind).tags` and `hasItemTag(kind, tag)` describe capabilities. Stone
is `placeable` and `throwable`, coin is `throwable`, and pickaxe is
`mineable-tool`. Other items have no action tags. A pickaxe cannot be thrown.

The guest sends `{type:"throw",dx,dy}` with a nonzero integer octant. It cannot
supply an origin, item kind, or quantity. `startThrow` validates the player,
plane, origin, equipped capability, and inventory before removing one item.
Refused requests spend nothing. The host uses its player position at release on
Z=1. Flight travels ten tile widths per second and at most four tile widths;
diagonal directions are normalized to the same world distance.

`stepThrows` sweeps each segment through terrain and other players' and NPCs'
half-tile hitboxes. The thrower is excluded. Walls and closed corners stop an
item on the last open tile; an entity stops it on that entity's occupied tile.
There is no damage, bounce, automatic catching, or stone placement. Landing uses
ordinary dropped stacks and pickup. If a stack already contains 9,999 of the
item, the host retains a stationary flight entry and retries landing after
pickup frees space. This bounded-stack fallback prevents loss or duplication.
The host refuses new throws at 1,024 concurrent entries.

`world.throws` holds current flight entries. Reliable state snapshots carry only
flight visible to their recipient (all flight in master view), with an update
when that filtered list changes. Full state carries current flight during join,
resync, and reconnect; removed or hidden entries disappear from the guest copy.
Input gestures and flight drawing are owned by the input and presentation
features, respectively.
