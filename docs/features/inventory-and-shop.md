# Inventory and shop

## Inventory

Every player starts with one pickaxe. B, gamepad button 2, or the bag button
beside B opens the inventory panel: one icon and count per stack. IJKL, the look
stick, or the D-pad moves the selection, and interact or a tap makes that stack
the held item. A small icon at the top right always shows the held item. Only a
held pickaxe lets interact mine, and any held item still allows pickup. Choosing
another item cancels mining. While the panel is open, interact and the look
control drive the panel and others see your typing bubble. B, Escape, gamepad
button 1, or the close button closes it. The world host stores the held item and
checks that the inventory holds it. Coins are an item and the score; the
inventory panel shows them.

## Shop

In the spawn room a gold-tinted shopkeeper stands on the north wall. Interact
with that tile highlighted (or standing on it) opens the shop panel: every stack
you carry with its count and unit price, and a "Sell all ore" row. IJKL, the
look stick, or the D-pad move the selection, and interact (or a tap on a row)
sells it; Escape, gamepad button 1, or the × button closes the panel. Prices:
coal 1, iron ore 3, lapis 4, redstone 4, gold ore 8, emerald 15, diamond 20.
Stone, the pickaxe, and coins show dimmed. Each sale adds a line such as "Sold
coal ×3 for 3 coins" to the seller's hearing log.

`src/shared/shop.js` holds the price table (`PRICES`, one place) and
`sellItems`, the one sale rule. The shopkeeper stands on `SHOPKEEPER_TILE` in
the room layout only and is a drawn fixture, not an entity: it does not block
movement. A sale is a host decision. Interact on the shopkeeper's tile opens the
panel (`src/client/shop-panel.js`), which only asks. The host's own player calls
`sellItems`; a guest sends `sell` with an item kind and a count, or `all`. The
host checks the entity, that its tile is the shopkeeper's or a neighbor on the
same level, that the kind has a price (stone, the pickaxe, and coins do not),
that the inventory holds the count, and that the coin stack has room. A failed
check changes nothing and a guest gets `sell-result` with the reason. A sale
removes the items, adds coins to the inventory's coin stack, and adds the sale
line through `tell`, so only the seller sees it. The score is the coin count in
the inventory panel; there is no separate readout. While the panel is open,
interact and the look controls drive it instead of mining and aiming, and
movement input is ignored.

Item kinds, stacks, and pickup are in [mining and items](mining-and-items.md).
