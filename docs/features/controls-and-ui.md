# Controls and UI

## Input

The code is hidden at the start of a world. Use the QR button on the host to
show it in the top right corner. On the host, F3 toggles a small FPS, payload
upload, queue, and join-failure panel. It starts with a `Build <sha7> (<label>)`
line from `build.js` (`Build local` for the working tree).

Q does what Escape does: it goes back one menu level (see
[Menu navigation](#menu-navigation)). While chat is open, Q types a "q". The
menu's root page shows the same build line in small text at the bottom.

In entity view, ESDF or the left movement stick sets the retained facing octant.
Releasing movement stops walking and keeps that target. Facing starts south.
IJKL and the gamepad right stick select temporary directional aim only while an
eligible item action is armed. In master view they pan the camera horizontally
in the world plane. Holding U/N smoothly zooms out/in; the mouse wheel and touch
pinch also zoom. There are no level-change keys or touch gestures.

Space, ZR (button 7), or the action button starts a press. Explicit NPC, pickup,
and panel interactions consume one press. Holding the control never repeats a
pickup or a panel confirmation. B, Y (button 2), or the bag button opens the
inventory. Movement keys are in [movement](movement.md); chat keys are in
[chat](chat.md).

The pickaxe mines immediately on press and stops on release. The client sends
`mine-hold` every four world ticks. Turning retargets immediately. Forward
motion keeps the current block pinned while it remains solid and reachable, then
acquires the next adjacent solid block as the player advances. It never mines a
distant block or automatically picks up the drops.

All placement happens once on release at the current crosshaired tile. A coin
tap does nothing. Coin and stone support directional aim: hold Space or ZR,
select an octant with IJKL or the right stick, and release the action control to
throw. Returning aim to neutral before release cancels. Once a gesture has
aimed, releasing at neutral never falls back to placement. Aim can leave neutral
again during the same press. Movement continues independently while aiming;
ending the gesture restores movement-facing targeting.

Touch action drags use the vector from the press origin and a 16 CSS pixel dead
zone. A drag can leave the button. The movement and action pointers coexist.
Pickaxe drags never aim or throw. Pointer cancellation, focus loss, a hidden
tab, menu or chat opening, held-item changes, and controller or network
disconnects cancel an armed action without executing release. A fresh press is
required. Reconnected or replacement controllers must first report ZR released
before another action can arm. The pointer event boundary and host action
intents are recorded in [the shared contracts](../single-plane-contracts.md).

The browser fullscreen button uses the API when available. On Safari, adding the
page to the Home Screen can hide browser controls. Pinch zoom remains a world
gesture; pointers starting on controls do not join it.

With a gamepad connected to the device, press a button while the page is
focused. The left stick or D-pad moves, and the right stick selects
eligible-item aim while ZR is held or pans in master view. In the world, ZR (7)
arms the action, ZL (6) toggles sprint, A (1) zooms in while held, B (0) zooms
out while held, Y (2) opens the bag, and X (3) opens the menu (the names are the
Nintendo Switch labels on the browser's standard indices). With a menu open, the
controls change as [Menu navigation](#menu-navigation) lists. In a menu a stick
steps once when it leaves center; a new direction steps only 200 ms after the
last step, so a sweep across a diagonal does not step twice; a held direction
repeats after 400 ms, then every 200 ms (`src/client/stick-step.js`, shared by
the menus). The D-pad and IJKL keep their own timing in the bag, the pickup
grid, and the shop. The browser can report a standard layout or the raw layout
of the Afterglow Wireless Deluxe Controller. The Afterglow Wireless Deluxe
Controller's USB connection charges it but does not send input. Pair that model
over Bluetooth to play.

## Menu navigation

Settings, the inventory panel, the pickup grid, and the trader conversation
share one navigation model (`src/client/menu-nav.js`, applied in `panels.js` and
`input.js`).

| Action             | Keyboard  | Controller         | Touch                  |
| ------------------ | --------- | ------------------ | ---------------------- |
| Move the selection | IJKL      | D-pad, right stick | tap a row or square    |
| Confirm            | Space     | ZR                 | interact button, a tap |
| Back one level     | Q, Escape | B                  | Back button            |
| Open the menu      | Escape, Q | X                  | ESC button             |
| Open the bag       | B         | Y                  | bag button             |

- In Settings, I and K select a row and J and L change its value. Confirm acts
  on the Back row only; value rows change with J and L.
- Back goes up one level. Settings goes back to the Escape menu with its row
  still selected, and every outermost menu (the Escape menu, the bag, the pickup
  grid, the trader conversation) goes back to the world. The item list inside
  the conversation goes back to the conversation first. With no menu open, Q or
  Escape closes the hearing log, and otherwise opens the Escape menu.
- X and Y keep their world meanings, and each replaces the open menu or panel: X
  shows the Escape menu, and Y shows the bag. A second press of the same button
  closes it.
- Scrolling keeps the selected row visible.
- A newly opened menu needs a fresh confirm press. While Space, ZR, or the
  interact button that opened it is still held, confirm does nothing.
- ESDF and the left stick keep moving the player while a menu is open, and the
  D-pad moves the player only with no menu open. Menu input never also aims,
  mines, or pans the camera. A and B do not zoom with a menu open, and a B that
  went back does not zoom out when the menu closes.
- Chat text entry keeps its typing controls.

On a touch screen a Back button shows at the top left while any menu is open and
goes back one level. It sits above the Escape menu's scrim.

The in-game keyboard has QWERTY letters, shift, a page of numbers and symbols,
space, backspace, send, and close.

## The Escape menu and bitmap font

The engine page gives the demo the VGA bitmap font and the Escape menu
structure: Open Dwarf, Resume, Settings, Leave Game, and UI Scale.

## The update notice

A world host whose page was served as `main` reads `/api/v1/status` every 2
minutes, and once when the tab becomes visible again
(`src/client/update-check.js`). When `main.commit` differs from the host's own
commit, the UI layer shows "A newer version is available. Reload to update;
guests will rejoin." under the status line. A tap or click on it reloads the
page. Guests never check, because they follow the host's build, and a branch or
commit preview never checks. A failed request is ignored.

## The UI layer

The page holds one canvas, a hidden live region that repeats the status text for
a screen reader, and the build config. Every part of the game UI is drawn by the
WebGL renderer in the bitmap font: the touch controls, chat line and keyboard,
hearing log, inventory and shop panels, host tools and join QR code,
diagnostics, status, loading screen, menu, and the `/host` world list. The admin
dashboard at `/admin` stays HTML because it is a shell page, not the game (see
[admin dashboard](admin-dashboard.md)).

Three client modules make the layer, and `render.js` keeps the one draw path:

- `src/client/ui.js` is pure. `layoutUi(view)` takes the canvas size, the
  safe-area insets, the UI scale, and a plain description of what is open, and
  returns every element as a rectangle in CSS pixels, in draw order. Text scale
  snaps to a whole number of device pixels per font pixel. `hitTest` finds the
  last element under a point, and a panel hides what lies under it. The touch
  controls scale with the UI scale as far as the screen has room; panels sit in
  the space above them. `layoutUi` runs one function per section from the
  `ui-layout-*.js` files (controls, corner readouts, panels, chat, menu), in
  draw order. A new panel is a new function there and one call in `layoutUi`.
- `src/client/ui-pointer.js` routes pointer events over a layout. Each pointer
  is tracked on its own, so several fingers work at once. Buttons and keys act
  on pointer down, because iOS sends no click while another finger is down; rows
  in a scrolling list act on release without a drag; the fullscreen button acts
  on release, because the browser starts fullscreen only from one. Each stick
  follows one pointer. A pointer that starts on no element belongs to the world,
  and only those pointers join a pinch. The action button uses optional
  press/move/release/cancel events; other buttons keep their normal behavior.
- `src/client/ui-draw.js` draws a layout through a painter that `render.js`
  provides (rectangles, text, item icons, the QR texture).

`loop.js` builds the view from the scene each frame (`ui-view.js`), calls
`layoutUi`, hands the result to the renderer as `scene.ui`, and `input.js` turns
element actions into the same functions the keys call. `inventory-panel.js` and
`shop-panel.js` hold only the selection and scroll state. The in-game keyboard
types into `scene.chatDraft`; a physical keyboard types through `keydown`. No
element has focus, so the system keyboard never opens. The loading screen draws
as soon as the font loads, and `canvas[data-ready]` marks that the world's
textures are ready.

With `?harness`, `window.__od.ui` gives specs the current layout, so a spec taps
an element by its rectangle. `?safe=top,right,bottom,left` simulates safe-area
insets in CSS pixels.

The lower-left touch region starts a floating movement stick wherever the thumb
lands. Its origin stays fixed until release, and its knob clamps at maximum
travel even outside the region. The stick is hidden while idle. The broad
lower-right action panel uses its entire rectangle as the hit area and centers
the equipped item. Chat, sprint, and bag take priority over the regions behind
them. Portrait and landscape share these rules and respect safe areas. Opening
an inventory or shop reduces the lower regions to leave room for the panel. The
world pickup grid uses a compact action footer so its lower cells remain visible
and receive taps.

Aiming uses the world arrow as feedback. It does not draw a second joystick well
above the action panel. Drag dead zones, return-to-center cancellation, and
release-only placement or throwing retain the same action rules.

## Boot errors

The page cannot draw anything until its files load, so a failure there used to
leave a blank screen. An inline style and a classic inline script come first in
`public/index.html`, so they work even when the build's files never arrive. The
stylesheet loads without holding back painting. The script listens for a file
that cannot load, an uncaught error, and an unhandled rejection. Until
`public/js/app.js` sets `data-booted` on `<html>` after `startApp` resolves, it
writes each one onto a full-page panel with the build commit, the time since
load, and the browser's user agent. With no error and no boot after 15 seconds,
it lists the stylesheet and module files still pending, which names the host,
such as jsDelivr. After the boot it stays hidden. The text can be selected and
copied from a phone.

## Input validation

`action-gesture.js` owns the pure gesture transitions. `action-input.js` owns
capability gating, cancellation, target selection, mining renewal, and action
dispatch. `tests/client/action_gesture_test.ts` and `action_input_test.ts` cover
these rules with controlled world ticks and transport records. Explicit pickup,
NPC, and panel priority remain in `interact_test.ts`.

`tests/e2e/action-input.spec.ts` exercises keyboard placement and interruptions,
keyboard and gamepad aim cancellation, movement during aim, and simultaneous
touch movement and release placement. Host mining leases and throw flight need
the host-actions implementation. Pointer drag aiming needs the presentation
router callback. Combined delivery and rendering checks belong to integration
issue #134.
