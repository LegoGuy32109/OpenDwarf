# Controls and UI

## Input

The code is hidden at the start of a world. Use the QR button on the host to
show it in the top right corner. On the host, F3 toggles a small FPS, payload
upload, queue, and join-failure panel. It starts with a `Build <sha7> (<label>)`
line from `build.js` (`Build local` for the working tree).

Q does what Escape does: it goes back one menu level (see
[Menu navigation](#menu-navigation)). While chat is open, Q types a "q". The
menu's root page shows the same build line in small text at the bottom.

In entity view, IJKL points the cursor (see [cursor](cursor.md)) at one of the
eight neighboring tiles. R/V selects the view level; the cursor appears at the
player's level or one level above or below. In master view, IJKL pans the camera
at the same screen speed at every zoom (see [sight](sight.md)). Holding U/N
smoothly zooms out/in. The mouse wheel also zooms. Space, the gamepad's ZR
(button 7), or the large round pickaxe button right of the move stick interacts
(see [mining and items](mining-and-items.md)). B, the gamepad's Y (button 2), or
the bag button opens the inventory (see
[inventory and shop](inventory-and-shop.md)). Movement keys are in
[movement](movement.md); chat keys are in [chat](chat.md).

A brief bitmap HUD shows the zoom and the view level during changes.

On a touch screen, the left stick moves the player and the right stick points at
a neighbor in entity view or pans in master view. Both sticks have a visible
center deadzone and eight direction guides. The fullscreen button uses the
browser API when available; on Safari, adding the page to the Home Screen can
hide browser controls. Pinch to zoom or drag two fingers vertically to change
view levels. The sprint button sits at the right stick's bottom right. The
sticks draw at 60% opacity; round buttons have a see-through face (white at 10%)
with a solid border and full-opacity icons. The on-screen ESC button opens the
menu, and the speech bubble button opens chat.

With a gamepad connected to the device, press a button while the page is
focused. The left stick or D-pad moves, and the right stick points at a neighbor
in entity view or pans in master view. In the world, ZR (7) interacts, ZL (6)
toggles sprint, A (1) zooms in while held, B (0) zooms out while held, Y (2)
opens the bag, X (3) opens the menu, and L/R (4/5) change the view level (the
names are the Nintendo Switch labels on the browser's standard indices). With a
menu open, the controls change as [Menu navigation](#menu-navigation) lists. In
a menu a stick steps once when it leaves center; a new direction steps only 200
ms after the last step, so a sweep across a diagonal does not step twice; a held
direction repeats after 400 ms, then every 200 ms (`src/client/stick-step.js`,
shared by the menus). The D-pad and IJKL keep their own timing in the bag, the
pickup grid, and the shop. The browser can report a standard layout or the raw
layout of the Afterglow Wireless Deluxe Controller. The Afterglow Wireless
Deluxe Controller's USB connection charges it but does not send input. Pair that
model over Bluetooth to play.

## Menu navigation

Settings, the inventory panel, the pickup grid, and the shop panel share one
navigation model (`src/client/menu-nav.js`, applied in `panels.js` and
`input.js`).

| Action             | Keyboard  | Controller         | Touch                  |
| ------------------ | --------- | ------------------ | ---------------------- |
| Move the selection | IJKL      | D-pad, right stick | right stick            |
| Confirm            | Space     | ZR                 | interact button, a tap |
| Back one level     | Q, Escape | B                  | Back button            |
| Open the menu      | Escape, Q | X                  | ESC button             |
| Open the bag       | B         | Y                  | bag button             |

- In Settings, I and K select a row and J and L change its value. Confirm acts
  on the Back row only; value rows change with J and L.
- Back goes up one level. Settings goes back to the Escape menu with its row
  still selected, and every outermost menu (the Escape menu, the bag, the pickup
  grid, the shop panel) goes back to the world. With no menu open, Q or Escape
  closes the hearing log, and otherwise opens the Escape menu.
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
  and only those pointers join a pinch or a two-finger level drag.
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
