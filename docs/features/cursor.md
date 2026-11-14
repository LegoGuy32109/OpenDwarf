# Cursor

The world **Cursor** is the outline on the highlighted tile (ADR 0009). It shows
in entity view when the pickup grid is closed. It follows active aiming, or the
current target direction, and retains movement-facing at rest (south for older
state without facing). A local mining target stays pinned until it changes.

- Four pixel-stepped gradient brackets from the editable 16×16 Aseprite asset.
  Source pixels are fully opaque. The engine applies 25% opacity to the frame.
- The held item's icon (its item sheet frame) sits in the center at half a tile.
  It is at full opacity when `interactPreview` names an action for the tile, and
  at `CURSOR_ICON_DIM` when it returns null. `sees` is the local visibility
  (`scene.visibility`).
- There is no progress square. Mining progress shows only as the breaking decal
  on the mined tile, for every entity including the local one.
- The pickup grid's selector keeps its own look.

`cursorParams(held, preview)` in `src/client/cursor.js` is the pure function for
the draw parameters (color, opacity, icon frame, icon opacity), and
`localCursor(scene)` finds the tile. `render.js` draws what they return, and the
shared test driver exposes the same state to browser specs. The manual
`__od.cursor()` remains available for inspection.

Guest cursors use the reliable private held-item and inventory feeds, matching
the action button. Their preview uses a separate actor value because motion
snapshots omit private equipment. It does not copy that equipment into the
snapshot player.

Visible moving entities show neutral pixel chevrons. Local movement intent shows
a chevron even when blocked, and hides it at rest. Active local aiming adds a
gold chevron above movement at the same anchor. Both can be visible. Stationary
remote entities have no chevron. The renderer uses the same sight opacity as
each entity sprite, so hidden entities do not gain a marker.

## Potential improvements

The reach and controller map (#97) leaves a Dwarf Fortress style breaking decal
unspecified. That art change has no approved design and is not implemented. The
existing cracks satisfy the map's cracks-only progress rule.
