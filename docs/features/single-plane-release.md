# Single-plane release validation

Issue [#134](https://github.com/LegoGuy32109/OpenDwarf/issues/134) integrates
world #130, host actions #131, presentation #133, and input #132 on one
candidate branch. The candidate preserves their commit ancestry. Main,
production promotion, and shell deployment remain the coordinator's release
decisions.

The [design interview](../single-plane-portrait-design.md),
[contracts](../single-plane-contracts.md), and
[ADR 0011](../adr/0011-single-plane-gameplay-with-3d-chunks.md) remain the
source of behavior and defaults.

## Acceptance coverage

| Requirement                                                                                                            | Evidence                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Play plane, ore caves, permanent support, legacy fixtures, chunk seams and edit replay                                 | `single_plane_world_test.ts`, `single-plane-world.spec.ts`, `chunk-unload.spec.ts`, `terrain-sync.spec.ts`, `planar-streaming.spec.ts` |
| No floor-ray leaks, hidden caves, remembered terrain                                                                   | `planar_visibility_test.ts`, `visibility_view_test.ts`, `reach.spec.ts`, `network-motion.spec.ts`                                      |
| Deterministic variants, dynamic/cached parity, exact remembered tint, no depth passes                                  | `planar_render_test.ts`, `portrait-presentation.spec.ts`, `mesh-cache.spec.ts`                                                         |
| Real keyboard hold, stationary mining, turns, forward tunneling, guest updates, release and pointer cancellation       | `mining.spec.ts`, `held-actions.spec.ts`, `action_input_test.ts`                                                                       |
| Real two-finger aim, independent movement, host-authoritative throw, neutral cancellation and release placement        | `integrated-portrait.spec.ts`, `action-input.spec.ts`, `placing.spec.ts`, `planar-streaming.spec.ts`                                   |
| Four-tile normalized range, sweeps against walls/players/NPCs, collectible landing, inventory conservation and refusal | `held_actions_test.ts`, `held-actions.spec.ts`                                                                                         |
| Join during flight and transport interruption                                                                          | `held-actions.spec.ts`                                                                                                                 |
| Controller reconnect/replacement requires released ZR, physical keys, landscape touch and panel priority               | `action-input.spec.ts`, `gamepad-layout.spec.ts`, `game.spec.ts`, `menu-navigation.spec.ts`                                            |
| Safe areas, single stick, low square action, Escape and no touch log button                                            | `portrait-presentation.spec.ts`, `ui-layer.spec.ts`, inspected portrait evidence                                                       |

## Validation status

The candidate has passed `deno task verify` with 757 passed, zero failed, and 19
existing ignored tests. `PORT=8159 E2E_WORKERS=4 deno task e2e:smoke` passed all
13 checks. The five-repeat run of 27 changed/new browser specs passed 435
checks. The additional streaming/stone-throw spec and full browser suite remain
pending. Do not close #134 before all final checks pass.

The first combined unit run found three fixture failures, corrected by making
retained facing explicit and seeding support before enabling its edit guard. The
first diagnostic full browser run reported 43 failed, 96 passed, and one
credential-dependent skip. Its failures exposed old level, free-look, mining
toggle, texture-count, and touch-log expectations. These scenarios now use the
playable plane and current controls.

## Nightly issue 129

The original October 25 run
[40187688167](https://github.com/LegoGuy32109/OpenDwarf/actions/runs/40187688167)
failed in the muffled-source test while waiting for two sounds behind rock. The
latest November 11 run
[43033952927](https://github.com/LegoGuy32109/OpenDwarf/actions/runs/43033952927)
failed to install browser dependencies because Ubuntu package hosts did not
resolve. It did not run browser tests.

The integrated sound fixture builds its occluding wall on Z=1. The step test
keeps moving until both local prediction and authoritative remote playback have
produced steps, avoiding a stop based only on predicted distance corrections.
Both sound-event checks passed all five repetitions and the final full suite.
The original sound failure did not reproduce in the integrated candidate. This
does not establish the original intermittent failure's root cause, and #129
remains open. Its latest infrastructure failure is separate from the local
browser results.

## Reviewed evidence

The final portrait gesture recording uses the real guest pointer router,
movement, inventory and host flight. Its 390×844 viewport reserves 47 pixels at
the top and 34 at the bottom. Images and video frames were inspected, including
small-screen inventory, landscape controls, the in-game keyboard, held mining,
and guest terrain after unload/replay.

- [Real portrait aim](https://raw.githubusercontent.com/LegoGuy32109/OpenDwarf/evidence/134-integrated-release/134-portrait-real-aim.png)
- [Gesture video](https://raw.githubusercontent.com/LegoGuy32109/OpenDwarf/evidence/134-integrated-release/134-portrait-gesture.webm)
- [Held mining video](https://raw.githubusercontent.com/LegoGuy32109/OpenDwarf/evidence/134-integrated-release/134-held-tunnel.webm)
- [Guest replayed edits](https://raw.githubusercontent.com/LegoGuy32109/OpenDwarf/evidence/134-integrated-release/134-guest-replayed-edits.png)
- [Small-screen inventory fixture](https://raw.githubusercontent.com/LegoGuy32109/OpenDwarf/evidence/134-integrated-release/134-small-bag.png)
- [Landscape fixture](https://raw.githubusercontent.com/LegoGuy32109/OpenDwarf/evidence/134-integrated-release/134-landscape.png)
- [Keyboard fixture](https://raw.githubusercontent.com/LegoGuy32109/OpenDwarf/evidence/134-integrated-release/134-portrait-keyboard.png)

These are Chromium phone emulation and browser gamepad reports, with keyboard
events. No physical iPhone or controller hardware test is claimed.
