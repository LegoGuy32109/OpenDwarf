# Single-plane implementation contracts

Read [the agreed design](single-plane-portrait-design.md) first. Josh authorized
parallel implementation and GitHub tracking on November 11, 2026. These
contracts are committed before worker launch so every branch starts with the
same shapes.

## Tracking

- [World and planar caves](https://github.com/LegoGuy32109/OpenDwarf/issues/130)
- [Held mining and throws](https://github.com/LegoGuy32109/OpenDwarf/issues/131)
- [Cross-device input](https://github.com/LegoGuy32109/OpenDwarf/issues/132)
- [Portrait presentation](https://github.com/LegoGuy32109/OpenDwarf/issues/133)
- [Integration and release validation](https://github.com/LegoGuy32109/OpenDwarf/issues/134)

## Ownership

| Ticket area  | Owned production files                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World        | `src/shared/world.js`, `locomotion.js`, `generation.js`, `world-recipes.js`, `spawn-room.js`, `world-builder.js`, `terrain.js`, `reach.js`, `target.js`, `src/shared/authored-terrain.js` (approved legacy unit-test helper), world/terrain feature docs                        |
| Host actions | `src/shared/mining.js`, `placing.js`, `items.js`, `simulation.js`, `wire.js`, `control-wire.js`, `action-wire.js`, new `throws.js` and item-action modules, `src/client/network-host.js`, `network-guest.js`, host action/network adapters, mining/placing/network feature docs |
| Client input | `src/client/input.js`, `input-values.js`, `interact.js`, `loop.js`, `client-context.js`, `client-actions.js`, gesture modules, input/interaction feature docs                                                                                                                   |
| Presentation | `src/client/ui-*`, `scene-types.js`, `cursor.js`, `render.js`, `terrain-mesh.js`, `src/shared/surface.js`, texture build scripts and terrain art, portrait/cursor/render feature docs                                                                                           |

Each worker owns its feature tests. Do not edit shared fixtures, README,
CONTEXT, these contracts, or `single-plane.js` without coordinating. Ask the
coordinator about overlap instead of changing another worker's files. All four
branches target main. A final integration ticket owns cross-feature wiring,
shared-fixture updates, README links, full validation, and merging.

## Shared state

`src/shared/single-plane.js` exports `PLAY_Z=1`, `FLOOR_Z=0`, `THROW_RANGE=4`,
`THROW_SPEED=10`, `ACTION_DEADZONE_PX=16`, `MINING_LEASE_TICKS=10`, and
`MINING_REFRESH_TICKS=4`. It also exports `facingOf(player)` and
`createActionGesture()`, plus JSDoc shapes.

- `world.planeZ?:number`: world worker sets 1 on every built-in playable recipe.
  Host actions validates this field in snapshots. Explicit low-level legacy
  fixtures without it may retain their 3D engine behavior.
- `player.facing?:{x:number,y:number}`: nonzero octant from intended movement.
  World worker owns updates and spawn defaults. Host actions carries it in
  snapshots and motion, and validates octants. Do not change `facingLeft` usage.
- `world.throws?:ThrownItem[]`: host actions owns creation, advancement,
  collisions, snapshots, and guest merging. Presentation renders visible entries
  using the existing item atlas. Never expose hidden throws to guests.
- `scene.actionGesture?:ActionGesture`: client input owns its state.
  Presentation passes it through optional `UiView.actionGesture` and draws its
  aiming well. Existing fixtures without it behave as an idle gesture.

The coordinator seeds optional JSDoc fields before launch. The client input
worker initializes the gesture in `createContext`.

## Pointer boundary

Presentation adds an optional `createPointerRouter` callback:

```js
onInteract(event); // ActionPointerEvent from single-plane.js
```

It is exclusively for `btn:interact`. Coordinates and origin are CSS pixels.
Each pointer retains its origin from down. Emit press, move, release, and cancel
even when the pointer leaves the button. Do not also emit ordinary onAction or
onRelease for that button when this callback is supplied. Keep existing button
behavior as a fallback when it is absent. Multitouch move and action pointers
must coexist. Pointer cancellation is distinct from release.

Client input supplies the callback and owns dead-zone selection, item gating,
gesture history, cancellation, keyboard/gamepad equivalence, and action
dispatch. Presentation owns pointer tracking and drawing only. Pickaxe dragging
never aims.

## Gameplay message boundary

Host actions adds these control intents and corresponding simulation handlers:

```js
{
  type: "mine-hold", x, y, z;
} // refresh/start the held mining lease
{
  type: "mine-cancel";
} // existing cancellation
{
  type: "throw", dx, dy;
} // octant, never client-supplied origin or item count
{
  type: "place", x, y, z;
} // existing placement, sent once on release
```

Refresh the same mining tile without resetting progress. Expire after ten world
ticks without renewal. Client input refreshes every four ticks while held. A
turn cancels/retargets immediately. Releasing cancels immediately. Host actions
retains legacy `mine` for explicit fixtures, but public input uses `mine-hold`.

Host actions owns the protocol bump from 7 to 8, validators, refusal messages,
and transport. Hosts compute throw origin, equipped item, inventory consumption,
flight and landing. `itemInfo(kind).tags` and `hasItemTag(kind, tag)` describe
capabilities. Initial stone tags are `placeable` and `throwable`. Coin is
`throwable`. Pickaxe is `mineable-tool` and never throwable/aimable. Do not add
a bow, ammunition, or combat. Client input can use the capability helper once
integrated. To stay independently type-checkable, it may initially gate the
existing stone/coin constants behind a local adapter and replace it at
integration.

## Coordination amendments

The world worker also owns `src/shared/authored-terrain.js`. Its
`createAuthoredWorld` helper is imported by unit tests, not production code.
Keep it as an explicit legacy 3D fixture built with the world builder and no
`planeZ`. Every built-in playable/browser recipe, including `authoredRecipe`,
still uses the playable plane. Add tests that prove this distinction.

Add optional `scene.cancelAction?:()=>void` for immediate transport-related
cancellation. Client input initializes and binds an idempotent callback that
clears local held mining and armed gestures without performing release. Host
actions calls it on guest transport/channel closure, guest stop, and
join-attempt replacement. Guard late callbacks so an obsolete connection cannot
cancel a newer session. Presentation owns adding the optional `Scene` type.

Integration replaces any temporary local item-capability adapter with
`hasItemTag` and owns README links. Workers should report integration-only
coverage gaps rather than modifying another worker's files.

## Merge and validation

Independent branches must pass `deno task verify`. Test the owned behavior in
unit tests. Use ports 8151 (world), 8153 (host actions), 8155 (client input),
and 8157 (presentation). New or modified e2e specs must pass five repetitions.
UI and input workers can stub the other side of the pointer boundary for focused
tests. Report any combined test requiring an unmerged branch explicitly. Never
silently skip it. The coordinator owns running the complete integrated journeys.

Do not copy another branch's implementation just to pass a check. Coordinate
shared changes. Capture and inspect portrait screenshots and interaction video.
GitHub issue/PR creation and own-branch pushes are authorized. Do not merge,
promote production, deploy the shell, or edit another worker's branch.

## Integrated implementation

The release candidate combines the four worker heads without changing the
interview decisions or defaults. `action-input.js` now reads `hasItemTag` for
mining, placement, and directional eligibility. Real pointer events flow through
`ui-pointer.js` into the shared gesture and host intent paths.

Playable visibility casts rays only at Z=1. Supporting-floor visibility inherits
the playable cell, so lower rays cannot disclose caves or dropped items behind
walls. Explicit legacy fixtures retain three-axis sight. Reconnected and
replacement controllers must report ZR released before arming another action.

Shared browser fixtures use Z=1 offsets and explicit retained facing. They do
not inject gestures or flight in integrated interaction journeys. Presentation
unit fixtures seed the supporting floor before enabling its permanent edit
guard. See [release validation](features/single-plane-release.md) for coverage
and results.
