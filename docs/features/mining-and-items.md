# Mining and items

## Mining

Interact starts a mining action in `src/shared/mining.js`. With the pickaxe
every entity holds, it starts mining the highlighted tile. The look control
points the highlight at a neighbor, and the entity's own tile is highlighted
with no aim. Mining is not held down; it finishes on its own. Stone takes 1 s,
coal 1.5 s, iron ore 2 s, gold ore, lapis, and redstone 3 s, and diamond and
emerald 4.5 s. Aiming at another tile or walking out of reach cancels it. A
finished tile drops its item, such as stone or coal, on that tile.

A guest sends only the tile it aimed at (`mine`, or `mine-cancel`); the world
host checks that the tile lies on the entity's level next to its center tile,
holds a mineable material (the table in `materials.js` gives each material's
time), and that the entity holds a pickaxe. The target locks at the start. Each
host tick `stepMining` cancels an action whose target left reach, whose held
item changed, or whose tile changed, and finishes the ones that are done.
`completeMining` is the one place a finished action is handled: it writes air
with `writeTile` and drops one item of the material's item kind on the tile. The
host adds the tiles `drainTileChanges` returns to each peer's pending reveal,
only for tiles that peer sees now, and publishes a state packet at once (see
[networking](networking.md)); a tile out of sight keeps its last observed state
until seen again. A `mining` message lists the actions a peer can see (and its
own), with elapsed and total time, so a peer draws the breaking decal on other
players' tiles and the miner draws a growing square. Clients cancel when the aim
changes by sending `mine-cancel`.

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

## Pickup

Several kinds on one tile take turns showing their icon about once a second, and
a number marks a stack of more than one. Interact on a highlighted tile that
holds one stack picks it up into your inventory instead of mining, and the
hearing log says "Picked up coal ×1" to you alone. A tile with several stacks
opens the pickup grid: dark squares unfold into the 3×3 tiles around you, one
per stack with its icon and count. IJKL, the look stick, or the D-pad moves the
orange selector (the D-pad does not walk you while the grid is open), and a tap
on a square selects it. Interact picks up the selected stack. With more than
nine stacks a small gray plus shows in the bottom-right square, and moving down
scrolls. Escape, or walking out of reach, closes the grid.

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
every `ICON_CYCLE_MS`. The pickup grid's state and geometry live in
`src/client/pickup-grid.js`. `loop.js` calls `updatePickupGrid` (`panels.js`)
each frame to close the grid when the entity leaves reach or the tile empties,
to move the selector, and to hand `scene.pickupCells` to the renderer. While the
grid is open, the look control and D-pad drive it, not the aim or movement.

See [inventory and shop](inventory-and-shop.md) for what happens to the items
after pickup.
