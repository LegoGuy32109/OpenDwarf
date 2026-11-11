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

`deno task verify` passed with 757 passed, zero failed, and 19 existing ignored
tests. `PORT=8159 E2E_WORKERS=4 deno task e2e:smoke` passed all 13 checks.

The five-repeat run of 27 changed/new specs passed 435 checks. The added
streaming/stone-throw spec passed 10 checks. Screenshot review then found and
fixed the guest cursor's use of snapshot equipment instead of private feeds. The
seven affected journeys passed another 35 checks across five repetitions,
followed by another 13-pass smoke run. All 28 changed/new browser spec files
passed five repetitions, including the affected recheck after the cursor fix.

`PORT=8159 E2E_WORKERS=4 deno task e2e` passed 142 checks with one
credential-dependent real-Xirsys test skipped. There are no unresolved local
acceptance failures. The coordinator owns the final review and merge.

The public preview passed `deno task smoke /b/t134-integrated-release/ e1b9753`:
a host and guest joined code commit `e1b9753`, with no page or console errors.
No production promotion or shell deployment was performed.

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

## Async offer review follow-up

Review of PR139 found that an old offer's ICE lookup could reject after a new
join attempt had started. Its catch handler cancelled the new attempt's held
action and scheduled another reconnect. The session guard could not distinguish
offers within the same `joinWorld` call.

Each offer now captures ownership before ICE lookup. A new join attempt or
duplicate offer invalidates that ownership. Both successful and failed async
steps check it, as do peer and channel callbacks. An obsolete offer cannot
replace the current peer or cancel its action; a current failure still retries.

Nine controlled-promise tests exercise the real `joinWorld` handler. They cover
old-attempt ICE rejection, duplicate-offer ICE success, superseded remote,
answer and local-description failures, closed-session rejection, current ICE and
peer failures, and superseded negotiation success. Running the first seven
regressions against the previous implementation produced six failures and one
pass; all nine pass with the fix.

After the fix, `deno task verify` passed 766 tests with zero failures and 19
existing ignored tests. Smoke passed all 13 checks. The affected browser run
passed all 95 checks across five repetitions:

```sh
PORT=8159 E2E_WORKERS=4 deno task e2e signaling.spec.ts direct-join.spec.ts handshake.spec.ts live-sessions.spec.ts wire.spec.ts held-actions.spec.ts base-path.spec.ts network-motion.spec.ts --repeat-each=5
```

The subsequent final `PORT=8159 E2E_WORKERS=4 deno task e2e` run passed 142
checks with one credential-dependent real-Xirsys test skipped. Both sound-event
scenarios, including the muffled-source case from #129, passed again. No browser
failures remain in this follow-up run.
