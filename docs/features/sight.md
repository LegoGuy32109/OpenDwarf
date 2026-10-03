# Sight and view modes

`/entity` uses a 20-tile, three-axis field of view. Terrain leaving view is
remembered with a warm tint; unseen terrain is black. Remote entities fade by
their center's distance to the closest visible edge, and the fade persists when
they stop. A sight change blends over 150 ms; the guest can briefly retain the
last visible sprite position while it fades out. Entity view contains currently
visible players and NPCs plus last observed terrain; undiscovered terrain is
unknown.

`/master` shows the full world and permits camera panning while keeping at least
one full row and column of the authored square visible. Any player can use
`/master` for an unrestricted camera and the complete world view, then `/entity`
to return to the player's field of view. `/master` requests a full snapshot from
the host. Returning to `/entity` drops master-only data and adds only tiles in
the player's current sight to entity memory. Master travel does not add tiles to
entity-view memory, so it does not reveal the path there. These commands grant
no movement or world-editing powers.

The browser host computes each joining player's sight and sends only currently
visible entities and discovered terrain in `/entity`. The host sends only
entities whose center tile is visible. Terrain remembered from earlier sight
keeps its last observed state. The host browser still owns the full world, so
this is a view protocol, not a security boundary. Guest packet filtering is not
an anti-cheat boundary.

Same-level rays check every grid cell touched at a corner, making sight
reciprocal between stationary positions. Different-height sight retains the
earlier ray rule. See [sight boundary design](../sight-boundary-design.md).

The host sends a view filtered for each joining tab every 500 ms, and when that
player's sight moves to another tile. Visibility and memory use one bit mask per
chunk in network snapshots, and terrain travels as run-length encoded 16×16
chunks. A joining player receives only the chunks that hold a tile it has seen.
Terrain memory and view mode live in the browser host; closing that world
discards them. They survive a guest's rejoin (see [networking](networking.md)).
