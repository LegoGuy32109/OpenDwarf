---
status: accepted
---

# The shopkeeper is an NPC entity

The shopkeeper becomes an NPC entity named Ulgar. Today a recipe entity with
`role: "shop"` contributes a stationary shop tile: a drawn fixture that players
can stand on, with no speech, sight, or hearing of its own. Other initial
entities in a recipe are already NPCs, such as the corner NPC that patrols the
spawn room. The shopkeeper joins that system instead of keeping a separate one.

## Decisions

Settled in a grilling session on 2026-10-21. The full conversation design is in
[NPC conversations](../features/npc-conversations.md).

**One NPC system.** The shopkeeper is an initial recipe entity with `npc: true`,
a name, and a stand-still behavior. The world host controls it. The trader role
adds the shop conversation to that NPC. It does not make a second kind of
entity.

**It blocks movement.** Ulgar occupies its tile like any entity. A player talks
to it from a neighboring tile with its tile highlighted, and can no longer stand
on it.

**No special cases for sight and hearing.** Ulgar follows the existing entity
rules: it is hidden when out of sight, and its speech reaches distant listeners
as a murmur, the same as a player's speech.

**It speaks through its speech queue.** NPC replies use the same speech queue,
chatter, syllable reveal, and thought icon as players (ADR 0006).

## Consequences

Later NPCs, traders or not, get speech, conversations, and sight from the same
entity model. Shop location travels as an NPC entity, so the snapshot and the
protocol version change. Tests and specs that stand on the shop tile must move
to a neighboring tile. A player can no longer walk through the shopkeeper's
tile.
