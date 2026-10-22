# NPC conversations

Design agreed in a grilling session on 2026-10-21. Ticket #119 implemented the
first part: the shopkeeper is the NPC Ulgar, an entity that blocks movement and
follows entity sight and hearing. The conversation, speech, and menu behavior
below is not implemented. The current shop behavior remains in
[inventory and shop](inventory-and-shop.md). ADR 0010 records why the shopkeeper
becomes an NPC entity.

## Agreed behavior

The shopkeeper becomes an NPC entity that the world host controls. Its name is
Ulgar. It blocks movement and speaks through its own speech queue. Today it is a
drawn fixture that players can stand on. As an NPC, a player talks to it from a
neighboring tile with its tile highlighted. Ulgar follows the existing entity
sight and hearing rules with no special cases: it is hidden when out of sight,
and its speech reaches distant listeners as a murmur.

Conversations focus on actionable questions and requests. Greeting and farewell
niceties are outside this first change. Choices show specific lines the player
can say, rather than only broad topic labels.

Q and Escape go back one menu level. Back from the outermost conversation
returns to the world. Highlighting a choice is silent. Confirming it speaks the
selected line through the existing speech queue, chatter, and syllable reveal.

While the conversation menu is active, the player's thought icon animates. The
NPC also shows its thought icon while preparing a reply. After the player
finishes speaking, the NPC thinks for roughly one to three seconds, with longer
responses taking longer, then speaks through the same existing speech system.
The presentation delay is separate from response generation so authored replies
can use it too.

Nearby entities hear the exchange under the existing speech hearing rules.
Conversation choices are private until confirmed. This uses existing game speech
and chatter, without a new promise of recorded or synthesized words.

IJKL and the look control navigate conversation choices. ESDF remains the
keyboard movement binding. On iPhone and controller, the right stick navigates
and the left stick continues moving the player. Conversation menus do not stop
world movement.

Leaving the NPC's interaction range closes the conversation menu and stops new
transactions. Already spoken lines and an NPC reply already being prepared
finish normally. Hearing still depends on the listener's distance.

Choosing to sell opens the item list immediately, with quantities and prices. A
separate choice asks what the shopkeeper buys. The item list offers "Sell all
[ore]" for each carried ore kind, and "Sell all ore" for every kind. Each choice
shows its quantity and total. There is no quantity submenu. Confirmation speaks
the request. The host validates the sale immediately. The seller's private
system line, such as "Sold coal ×3 for 3 coins", stays and appears at that time.
The NPC's delayed reply then describes the actual accepted or refused result.
Each outcome has three authored reply lines, so the trader feels responsive and
does not repeat one line. The outcomes are a per-kind sale accepted, an all-ore
sale accepted, nothing to sell, and a full coin stack. "What do you buy?" also
has three lines. The host picks one line at random, so every listener hears the
same reply. A reply uses the real numbers, such as "Three coal? Here's three
coin."

Several players can browse their conversation menus privately at the same time.
Confirmed requests enter one NPC queue in order. The NPC speaks one public reply
at a time and names the player being answered.

A player can have only one unanswered request with a given NPC. While waiting,
the player can browse and move, but cannot confirm another request to that NPC.

Space or controller ZR confirms the selected choice. Q or Escape goes back one
level, and so does controller B, following the Switch convention. X and Y keep
their world meanings: in a conversation, Y opens the bag and X opens the menu,
and each replaces the conversation. On iPhone, the interact button confirms and
a persistent Back button goes back. Direct taps remain available.

Trader conversations use actionable fantasy wording. The shopkeeper seeks ore
and offers coins in exchange. The question "What do you buy?" is reusable across
traders. The description appears silently as menu context, without an automatic
spoken opening. Ulgar's description is "An ore buyer with coin to trade." The
initial choices are "I have ore to trade" and "What do you buy?"

Back restores the selection in the parent menu. Scrolling keeps the selected
choice visible. A newly opened menu requires a fresh confirm press, so holding
the button that opened it cannot choose an option. In Settings, I/K selects a
row and J/L changes its value. The right stick follows the same directions.

The first delivery also applies consistent selection and one-level Back to
Settings, inventory, and pickup menus. ESDF and the left stick keep moving the
player while these menus are open. Chat text entry keeps its typing controls.

## Delivery

Map #117 tracks the work in four tickets:

1. #118 Consistent menu navigation: Settings, inventory, pickup, and the shop
   panel share selection, one-level Back (Q, Escape, controller B, iPhone Back),
   retained parent selection, and movement while a menu is open.
2. #119 The shopkeeper becomes the NPC Ulgar: a named NPC entity that blocks
   movement and follows entity sight and hearing (ADR 0010).
3. #120 Trader conversation with Ulgar: private choices, spoken lines, the NPC
   thinking delay, and one NPC reply queue. Blocked by #118 and #119.
4. #121 Spoken ore trading: "Sell all [ore]" and "Sell all ore" through the
   conversation, with host-chosen replies. Blocked by #120.

#118 and #119 can run at the same time. Each ticket includes its own behavior
checks and visible evidence. Changed browser specs must pass five repetitions.

## Outside this version

Greetings and farewells, quantity submenus, and new conversation topics beyond
the two trader choices are excluded. There is no new generated dialogue or
word-level audio requirement.
