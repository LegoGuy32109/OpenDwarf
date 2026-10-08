---
status: accepted
---

# Reach, a free cursor, and the controller layout

Mining locks the cursor to its target, the orange cursor and its growing fill
cover much of the screen, and a dwarf can mine rock it cannot see, including a
diagonal blocked on both sides. Mining works only on the dwarf's own level. On a
controller the triggers zoom and the stick moves too fast through panels.

## Decisions

Settled with Josh on 2026-10-08.

**Reach.** A dwarf reaches the 3×3×3 tiles around its center tile `C`. The
cursor's level is the view level (R/V, or the L and R bumpers). A target `T` is
in reach when the dwarf sees `T` now and an open path leads to it:

- Same level: an orthogonal neighbor always; a diagonal only when at least one
  of the two tiles between `C` and `T` on that level is open.
- Level above: the tile directly above `C` always. Any other tile only when the
  tile directly above `C` is open, and then by the same-level rule at that
  level.
- Level below: never the tile directly under `C` (the dwarf's floor). Any other
  tile only when the tile on the dwarf's level directly above `T` is open.
- `C` itself, on the dwarf's level, is in reach (for a pickup).

"Sees" is the dwarf's current sight: the tile is in its visible set
(`sight.visible` on the host for a guest, `scene.visibility` for the host's own
player). Mining and placing both use this rule, and the world host checks it for
its own player and every guest. `src/shared/reach.js` holds it: `pathReach` (the
path rule alone) and `inReach` (path and sight).

**Free cursor.** Starting an action no longer locks the cursor. Mining goes on
while its target stays in reach, the held item is unchanged and the tile is
unchanged; the cursor can move anywhere. Clients stop sending `mine-cancel` when
the aim moves. Interact on another tile cancels the current mining and does the
new action there; interact on the tile being mined cancels it.

**Cursor.** A 2 px outline in `#ffb833` at 60% opacity, with no fill. The held
item's icon sits in its center at half a tile: full opacity when interact would
act on that tile, 35% when it would not. `interactPreview` in `reach.js` names
the action interact would take (`mine`, `place`, `pickup`, `shop`, or null), so
the cursor and the host agree. The growing progress square is gone: mining
progress shows only as cracks on the mined tile, which a later change redraws in
a Dwarf Fortress style.

**Dropped items.** A peer sees a dropped item when the item's tile or the floor
under it (one level down) is in its visible set. Mining around a corner shows
the floor before the open tile above it.

**Controller.** In the world, using the Nintendo Switch labels and the browser's
standard indices:

| Button     | Index | Action               |
| ---------- | ----- | -------------------- |
| ZR         | 7     | interact             |
| ZL         | 6     | toggle sprint        |
| A (right)  | 1     | zoom in while held   |
| B (bottom) | 0     | zoom out while held  |
| Y (left)   | 2     | bag                  |
| X (top)    | 3     | menu                 |
| L / R      | 4 / 5 | view level down / up |

With a panel open (bag, pickup grid, shop), ZR selects, Y or X closes it, and A
and B do nothing. A stick in a panel steps once when it leaves center; a new
direction steps only 200 ms after the last step, so sweeping across a diagonal
does not step twice; a held direction repeats after 400 ms, then every 200 ms.
The D-pad and IJKL keep their current speed.

**Shared music.** For now every player hears the same music at once. The world
host's music player is the conductor: it picks tracks for the mood as before
(ADR 0007), and it keeps picking even when its own Music setting is Off, using
each track's `duration` from the index to know when the next one starts. Each
time a track starts, the host sends every guest a **music cue**,
`{type:"music", key, hash, startTick}`, on the reliable `world` channel, and it
sends the current cue to a guest when it joins. A guest stops picking its own
tracks and plays the cued track from `(now - startTick)` on the host's tick
clock, downloading it first if needed (the device cache still applies), and
crossfades from the previous cue. Every 4 s the host sends a heartbeat, the cue
plus its own position in the track on a tick; a guest more than 0.25 s off skips
to it instead of playing the wrong offset for the rest of the track. A guest
whose Music is Off downloads and plays nothing. Offline and single-player play
keep picking locally. Later, places and events may give players different music;
the cue leaves room for that.

## Consequences

- Mining at other levels opens digging up and down. Falling into a hole one dug
  under oneself is ruled out by "never the tile directly under `C`".
- The client cursor uses the same `interactPreview` as the host, so a dimmed
  icon means the host would refuse.
- Music becomes shared for now: the host picks it, so a guest's mood or shuffle
  no longer matters.
