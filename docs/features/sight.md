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
player's sight moves to another tile. Visibility uses one bit mask per chunk in
network snapshots. Terrain does not repeat: the host sends only the tiles that
entered the player's remembered terrain or changed in it since the last packet,
as run-length encoded 16×16 chunks in `reveal`, and the guest keeps its own copy
(see [networking](networking.md)). A tile is remembered when that copy knows it
and the visible mask does not hold it, so remembered terrain keeps its warm tint
without a memory mask on the wire. The host keeps remembered terrain and view
mode in the browser; closing that world discards them. They survive a guest's
rejoin, which sends the whole remembered terrain again in batches.
