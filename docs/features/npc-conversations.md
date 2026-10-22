# NPC conversations

The shopkeeper is the NPC Ulgar (ADR 0010), and a player talks to it through a
conversation menu. This file describes what is implemented. Ticket #121 adds
spoken ore trading and is not implemented yet.

## What a player sees

Interact on Ulgar's tile, from a neighboring tile with its tile highlighted,
opens the conversation. The panel is titled with Ulgar's name and shows its
description, "An ore buyer with coin to trade.", as silent context. The choices
are specific lines the player can say: "I have ore to trade" and "What do you
buy?". The menu has no spoken opening, and highlighting a choice is silent.
Choices are private until confirmed.

While the menu is open, the player's thought icon shows (the bag does the same).
The icon goes away when the menu closes.

Confirming a choice speaks that line. The host speaks it through the player's
own speech queue, so it gets a bubble, chatter, and syllable reveal like typed
chat, and anyone who can hear the player hears it under the usual hearing rules.

- "I have ore to trade" speaks the line and opens the item list as a child menu.
  Back returns to the conversation with that choice still selected. Selling is
  unchanged (see [inventory and shop](inventory-and-shop.md)).
- "What do you buy?" speaks the line, and Ulgar answers it.

Navigation follows the shared model (see
[controls and UI](controls-and-ui.md#menu-navigation)): IJKL, the D-pad, or the
right stick move the selection; Space, ZR, the interact button, or a tap
confirm; Q, Escape, B, or the Back button go back one level. A newly opened menu
needs a fresh confirm press. ESDF and the left stick still move the player.

Walking out of Ulgar's range (`nearTrader`) closes the menu and its thought
icon. A line already spoken, and a reply already being prepared, finish
normally. Hearing still depends on the listener's distance.

## The reply queue

`src/shared/npc-conversation.js` holds the rules, and `createConversations` runs
inside the simulation (`simulation.js`), so the world host owns them.

A player confirms a choice by sending `talk` with the NPC id and a choice id. A
guest names the choice only; the host picks the reply. The host checks that the
player exists, that the NPC is a trader, that the player is in reach of its tile
on the same level (`reachesTrader`), that the choice is known, and that the
player has no unanswered request with that NPC. A refusal changes nothing, and a
guest gets `talk-result` with the reason.

A choice with replies adds one request to the NPC's queue. The host picks the
reply line at once, at random from the choice's three authored lines
(`BUY_REPLIES` for "What do you buy?"), so every listener hears the same line.
Requests are answered one at a time, in order. For the request at the head of
the queue, the NPC:

1. waits until the asker's own line has finished speaking and its previous reply
   has finished speaking;
2. shows its thought icon (`typing`) for the thinking delay;
3. speaks `<asker's name>, <reply>` through its own speech queue.

The thinking delay is `thinkingTicks(reply, roll)`: one to three seconds, longer
for a longer reply, with up to half a second of random jitter. It does not
choose the reply text, so an authored reply of any kind can use it. A player has
at most one unanswered request per NPC. The request is answered when the NPC
speaks its reply. While waiting, the player can browse and move. Another
player's request waits in the queue behind it.

## Code

- `src/shared/npc-conversation.js`: the choices, authored replies, thinking
  delay, and the reply queue.
- `src/client/shop-panel.js`: the panel's two levels, the conversation and the
  item list. `menu-nav.js` names them `shop` and `shop-items`; `parentLevel`
  makes the conversation the parent.
- `src/client/client-actions.js`: `talkRequest` sends `talk`, and `typing` keeps
  the thought icon up while the panel is open.
- `src/shared/control-wire.js`: the `talk` schema the host checks.

## Not implemented yet

Ticket #121 adds spoken selling. The item list's rows ("Sell all [ore]" and
"Sell all ore") will speak the request, the host will validate the sale at once,
and Ulgar's delayed reply will describe the actual result with three authored
lines per outcome (a per-kind sale, an all-ore sale, nothing to sell, a full
coin stack). Until then the item list sells silently, as before.

Greetings and farewells, quantity submenus, and further topics are outside this
version. There is no generated dialogue or word-level audio.
