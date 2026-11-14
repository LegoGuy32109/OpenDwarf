# Floating touch controls and pixel indicators

Status: integrated for release. Josh authorized merging all work, pushing main,
and a full deployment on November 13. The user-edited arrow masters and opaque
gradient corners are now used by the renderer. Existing single-plane, action,
and throw rules remain in place.

## Requested changes

- Replace smooth world arrows with pixel-art indicators in a Dwarf Fortress
  style. Author cardinal and diagonal forms in Aseprite, with a distinct
  throwing color. Use quarter-turns and flips to cover eight directions.
- Show movement direction and throwing direction simultaneously while the entity
  is actively moving and aiming.
- Redesign the target's corner brackets as pixel art with lower opacity.
- Remove the small throwing/aiming joystick well that appears on touch.
- Expand the mobile action button to fill the annotated right-hand region.
- Make the movement joystick floating: a touch anywhere in the annotated
  left-hand region establishes its origin, then dragging chooses movement.
- Apply the region-based layout to portrait and landscape, respecting the two
  supplied screenshot annotations and safe areas.
- Use SPA/Aseprite CLI for asset authoring. Avoid UI automation and focus
  changes. Opening the resulting asset for Josh to edit is requested, but
  implementation and art details are still being discussed.

## Previous implementation

`directionMarker` in `src/client/cursor.js` returns the aiming direction in
place of movement-facing while aiming. The renderer draws that one marker.
Showing both requires separate marker states and draw passes.

`render.js` draws the current rounded target corners as geometry. The source is
not an editable Aseprite asset. Its current opacity is 0.5.

`ui-layout-controls.js` defines a fixed movement-stick circle and a separately
positioned action square. It also adds `action:well` while aiming. Its removal
does not require removing the aiming gesture or its cancellation history.

The enlarged zones must preserve independent movement/action pointers and give
chat, sprint, and bag buttons priority over a zone behind them.

## Settled in the first decision round

1. Region layout: the left annotation is a floating movement activation zone.
   The right annotation is the visible action panel and its full hit area, with
   the item centered. Chat/sprint/bag remain separate priority controls. Agreed.
   A movement touch fixes the origin until release, clamps at maximum travel,
   and stays owned outside its activation zone.
2. Removing the throwing well changes feedback only. Keep drag-to-aim, eight
   octants, the dead zone, release-to-throw, and returning to center to cancel.
   Use the colored world arrow as aiming feedback. Agreed.
3. Show a movement arrow while movement input is active, including when blocked
   by a wall. Show a distinct throwing arrow while aiming. Both arrows share the
   same anchor with no offset. Draw throwing in its distinct color above
   movement, so it takes priority where their pixels overlap. At rest, retain
   the tile brackets but hide the movement arrow.
4. Aseprite art: transparent 16×16 source cells, small cardinal and diagonal
   glyphs, white/gray movement and amber/gold throwing variants, and one
   pixel-stepped corner frame initially at 25% opacity. Agreed. Render with
   nearest-neighbor sampling and integral source-pixel edges.

Josh explicitly permitted opening the native draft files in Aseprite once the
draft is ready. Use the CLI for authoring and validation, then launch the files
once for review. Do not use UI automation for edits.

## Corner draft revision

Josh requested a gradient and fully opaque source pixels after reviewing the
first draft. The corner mask stays the same, with a stepped grayscale gradient
from darker bends to bright tips. All painted pixels have alpha 255, with a
transparent background. Overall cursor opacity belongs to the game engine. This
supersedes the first draft's baked-in 25% alpha.

## Arrow palette revision

Josh edited the arrow masters into chevrons and consolidated the source into one
layer. Preserve his exact silhouettes and positions. Normalize shading to four
roles: outline, shadow, body, and highlight. The gold reference uses `#482B0D`,
`#5A3C16`, `#F5B630`, and `#FFE589`, with opaque painted pixels.

Export two grayscale PNG role masks and choose colors from an interchangeable
four-color JSON palette. This replaces separate movement/throwing color layers
as the source of color variants. Both variants still use the shared anchor, and
throwing draws above movement. The loader caches recolored results and supports
arbitrary palettes, including optional per-color alpha.

See [the palette pipeline](features/arrow-palettes.md) for its working API and
browser validation. The renderer now uses these assets with floating touch
regions.

## Implementation choices

- Preserve the edited chevron silhouettes, with a dark outline and three inner
  shading roles. Movement and throwing retain their shared direction anchor.
- Keep the current held-item icon inside the target brackets.
- Show the movement well only during an active touch, centered at touchdown.
- Use a lower control band up to 240 CSS pixels, bounded by 48% of screen
  height. Bag and shop panels reduce that band to 28% to preserve panel space.
- Give chat, sprint, and bag buttons priority over their background regions.
- Keep the existing menu, keyboard, and gamepad navigation behavior.

## Validation needs

Test movement activation at several points in the left region, diagonal
selection, maximum-travel clamping, dragging outside, release/cancel, and two
independent thumbs. Test priority controls without accidentally moving or arming
an action. Keep existing cancellation and release-only placement rules. Inspect
portrait and landscape images with safe areas and actual gameplay. Review arrows
facing the same and opposite directions, blocked movement, stationary aiming,
and low-opacity corners on bright and dark terrain.
