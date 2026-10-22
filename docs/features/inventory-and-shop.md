# Inventory and shop

## Inventory

Every player starts with one pickaxe. B, the gamepad's Y (button 2), or the bag
button beside B opens the inventory panel: one icon and count per stack. IJKL or
the D-pad moves the selection, a gamepad stick steps it by the stick step rule
(one step when it leaves center, a new direction only 200 ms after the last
step, a held direction repeating after 400 ms and then every 200 ms), and
interact (ZR) or a tap makes that stack the held item. A small icon at the top
right always shows the held item. Only a held pickaxe lets interact mine, and
any held item still allows pickup. Choosing another item cancels mining. While
the panel is open, interact and the look control drive the panel and others see
your typing bubble, and ESDF still moves the player. Q, Escape, the gamepad's B
or Y, the touch Back button, or the close button closes it; the gamepad's X
replaces it with the menu (see
[Menu navigation](controls-and-ui.md#menu-navigation)). The world host stores
the held item and checks that the inventory holds it. Coins are an item and the
score; the inventory panel shows them.

## Shop

In the spawn room the shopkeeper Ulgar, a gold-tinted NPC with its name drawn
under it, stands against the north wall. It blocks movement, so a player cannot
stand on its tile. Interact from a neighboring tile with Ulgar's tile
highlighted opens a conversation (see
[NPC conversations](npc-conversations.md)). Choosing "I have ore to trade" opens
the item list inside it: "Sell all ore" and one "Sell all [ore]" row per stack
you carry, each with its count and total in coins. IJKL or the D-pad move the
selection, a gamepad stick steps it by the same stick step rule, and interact
(Space, ZR, or a tap on a row) sells it; Q, Escape, the gamepad's B, or the
touch Back button goes back to the conversation, and from there to the world;
the × button closes the panel, and the gamepad's X or Y replaces it with the
menu or the bag. Walking out of reach of the NPC it talks to (`reachesTrader`)
closes the panel, as it closes the pickup grid out of reach. Prices: coal 1,
iron ore 3, lapis 4, redstone 4, gold ore 8, emerald 15, diamond 20. Stone, the
pickaxe, and coins show dimmed. Selling is spoken (see
[NPC conversations](npc-conversations.md#spoken-sales)): confirming a row says
"Sell all coal" or "Sell all ore", the host sells at once, and the sale adds a
line such as "Sold coal ×3 for 3 coins" to the seller's hearing log. Ulgar then
answers the request.

`src/shared/shop.js` holds the price table (`PRICES`, one place) and
`sellItems`, the one sale rule. Ulgar is an NPC entity in `world.players` (ADR
0010): an initial recipe entity with `npc: true`, the `trader` role, and the
`still` behavior, controlled by the world host like the corner NPC. It follows
the entity rules for sight and hearing with no special cases. `traderAt` finds
it for the interact target, and `reachesTrader` is the range check for every
conversation request, sales included. A sale is a host decision. Interact on
Ulgar's tile opens the panel (`src/client/shop-panel.js`), which only asks. A
panel row sends `talk` with the `sale` choice and the ore kind, or `all`, and
the host runs `sellItems` with the count it finds. The host refuses with
`talk-result` and the reason, before anything is spoken or sold, when the entity
or NPC is unknown, the player is out of reach of the NPC, the kind has no price
(stone, the pickaxe, and coins have none), the player still has an unanswered
request, or the player speaks too fast. Two outcomes are spoken and answered,
and change nothing: nothing to sell, and a coin stack with no room for the
coins. A sale removes the items, adds coins to the inventory's coin stack, and
adds the sale line through `tell`, so only the seller sees it. The score is the
coin count in the inventory panel; there is no separate readout. While the panel
is open, interact and the look controls drive it instead of mining and aiming,
and ESDF and the left stick still move the player.

Item kinds, stacks, and pickup are in [mining and items](mining-and-items.md).

## Potential improvements

The reach and controller map (#97) leaves an inventory panel redesign
unspecified. No replacement design is approved or implemented, and it is outside
that map's acceptance requirements.
