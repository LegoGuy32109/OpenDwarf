# Cursor

The world **Cursor** is the outline on the highlighted tile (ADR 0009). It shows
in entity view when the pickup grid is closed, on the tile the look control aims
at, or at rest on the tile being mined.

- A 2 px outline in `CURSOR_COLOR` at `CURSOR_OPACITY` (`src/shared/reach.js`),
  with no fill.
- The held item's icon (its item sheet frame) sits in the center at half a tile.
  It is at full opacity when `interactPreview` names an action for the tile, and
  at `CURSOR_ICON_DIM` when it returns null. `sees` is the local visibility
  (`scene.visibility`). Until the reach rules fill `interactPreview`, it returns
  null and the icon is dimmed.
- There is no progress square. Mining progress shows only as the breaking decal
  on the mined tile, for every entity including the local one.
- The pickup grid's selector keeps its own look.

`cursorParams(held, preview)` in `src/client/cursor.js` is the pure function for
the draw parameters (color, opacity, icon frame, icon opacity), and
`localCursor(scene)` finds the tile. `render.js` draws what they return, and
`__od.cursor()` exposes the same state to the e2e specs.
