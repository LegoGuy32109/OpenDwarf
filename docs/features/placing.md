# Placing stone

An entity that holds stone can **place** it on an empty tile, like placing a
block in Minecraft. This is the one additive terrain edit. Mining is the
destructive one, and a placed stone can be mined again.

## Player view

Interact acts on the highlighted tile: Space, gamepad ZR, or the on-screen
interact button. The order on a target tile is:

1. Dropped items on the tile: pick up.
2. An open tile while stone is held: place.
3. A solid tile while the pickaxe is held: mine.

A solid tile while stone is held shows "Hold the pickaxe to mine". A tile that
is occupied shows "Something is in the way". Placing has no timer: one stone
leaves the inventory, and the tile becomes stone at once.

On a phone, the interact button shows the stone icon while stone is held and the
pickaxe otherwise. It still acts on `pointerdown`.

## Rules

`placeStone` in `src/shared/placing.js` is the one check. The world host runs it
for its own player and for every guest. It rejects, in this order:

| Reason                    | Case                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `no stone held`           | stone is not the held item, or the inventory has none                                    |
| `Something is in the way` | the target is the entity's own tile                                                      |
| `out of reach`            | the tile is not in [reach](reach.md): the 3×3×3 around the entity, by an open path, seen |
| `tile is not open`        | the tile is not air                                                                      |
| `Something is in the way` | dropped items lie on it, an entity footprint overlaps it, or it is the shopkeeper's tile |

An entity footprint covers a player, an NPC, and the player's own body. A
walking entity also blocks the tile it leaves and the tile it walks into. The
shopkeeper is not in `world.players`, so `reservedTiles` names its tile in the
room layout.

## Network

A guest sends `{type:"place", x, y, z}`. `decodeControl` in `wire.js` checks the
shape, and the host calls `placeStone`. A refusal comes back as
`{type:"place-result", reason}` and shows as a notice. A success sends no
answer. The tile goes through `writeTile`, so `drainTileChanges` adds it to the
pending reveal of each peer that sees it, the same way as a mined tile. The
guest's inventory count follows through the inventory message.

## Not yet

Placing ore items as their own material. Stone only for now.
