# Portrait presentation

The canvas keeps its full viewport and camera framing. Touch controls sit low
inside the safe area: one movement stick at left, chat below it, a large square
equipped-item button at right, and sprint on the outer right above the bag.
Escape sits at the top center. There is no touch hearing-log button or look
stick. Landscape uses the same arrangement. The in-game keyboard replaces the
controls while typing; inventory and conversation panels fit above the lower
controls. Control sizes stop growing when the safe area has no more room.

`ui-pointer.js` owns each pointer independently. Its optional `onInteract`
callback receives press, move, release, and cancel for the action button, with
CSS coordinates and the original press coordinates. Moving or releasing outside
the button keeps that ownership. A second action pointer cannot take over. Focus
loss cancels rather than releases. With the callback installed, the button does
not also invoke ordinary action/release callbacks. Callers without it retain the
existing button behavior.

`ui-view.js` passes optional `scene.actionGesture` to the layout. Active aiming
shows a small eight-octant well above the action button, with the selected
direction highlighted in amber. The input feature owns item eligibility,
dead-zone selection, gesture history, cancellation, and dispatch. The
presentation does not infer a throw from a press.

Planar rendering and terrain variants are described in
[render performance](render-performance.md); facing and aiming markers are in
[cursor](cursor.md). The source art and atlas build procedure are recorded in
[Excalibur attribution](../../art/excalibur/README.md).

## Checks and integration boundary

`tests/client/ui_test.ts` covers simultaneous movement/action ownership, release
outside bounds, cancellation, fallback buttons, safe areas, panel space, and
equipped icons. `tests/client/planar_render_test.ts` checks planar surfaces,
remembered tint, patch continuity, cache invalidation, and matching mesh values.

`tests/e2e/portrait-presentation.spec.ts` checks 390×844 portrait, 320×568 with
safe-area insets, and 844×390 landscape. It compares terrain pixels between
dynamic and cached paths and captures screenshots and interaction video for
controls, the aim well, inventory, and keyboard. Its planar world, active aim,
and flight entries are explicit presentation fixtures. Integrated touch aiming,
throw simulation, cancellation, and host/guest journeys require the world,
action, and input branches and belong to integration issue #134.
