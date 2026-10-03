# Multiplayer protocol improvement design

Status: implementation is complete for the confirmed scope. Ten final 20-peer
comparisons passed. Josh selected 10 Hz after reviewing the comparison. The
[15-minute group run](stress-runs/2026-09-30-protocol-sustained.md) passed with
20/20 peers moving in every minute. Josh reports that the build looks right
while testing phone and host/controller responsiveness.

See [the comparison report](stress-runs/2026-09-30-protocol-split.md). Source:
[GitHub issue #9](https://github.com/LegoGuy32109/OpenDwarf/issues/9).

## Settled decisions

- Deliver changes in measured stages. Start with unnecessary snapshot work,
  incomplete connection cleanup, and a current performance baseline.
- Incompatible protocol versions require a clear refresh instruction. Supporting
  multiple versions is deferred while the game changes quickly.
- Use short comparisons for each stage, covering both authored world sizes and
  entity/master views. Run the full group test after the selected changes,
  followed by a desktop and phone check.
- After each implementation push, comment on issue #9 with the change,
  verification results, and remaining work.
- Use a separate unordered motion channel with zero retransmissions for the
  first experiment. Measure loss and jitter behavior before adding retries.
- Each motion packet contains compact motion state for every currently visible
  entity. Packets are independent. Consider motion deltas after measuring size.
- Keep chat text, typing, hearing-range changes, expiry, and bubble positions
  reliable. Update active chat about every 100 ms. Reconsider replaceable bubble
  positions only if measurements justify the extra coordination.
- Defer input replay until stop, reversal, collision, and elevation tests show a
  correction problem. First improve snapshot delivery and measure corrections.
- Fence motion by connection, view, and sight revisions plus the authoritative
  tick. Reject older revisions. Retain only the newest motion packet awaiting
  its reliable sight update, then apply it when that update is available.
- When motion samples run out, hold the last known remote position. Resume with
  presentation smoothing rather than extrapolating through unknown collisions.
- Compare 10 and 20 motion updates per second during implementation with 20
  connected peers before selecting a rate. Keep 150 ms presentation delay for
  the initial comparison.
- Incomplete connection attempts expire after 10 seconds, independently of
  player creation. Replacement attempts close older attempt resources. Timeout
  callbacks cannot close a newer attempt. Preserve the existing one-minute
  reconnect reservation for established players.
- Defer terrain and visibility payload optimization. Preserve existing full
  payload behavior for this implementation, and revisit issue #9's terrain
  proposal after measuring the other changes.
- Keep JSON with explicit validated fields. Remove unnecessary simulation fields
  from motion records. Defer binary encoding and coordinate quantization until
  packet-size evidence supports a separate decision.
- Discard malformed motion. Validate complete reliable snapshots before scene
  mutation. Request a full resync for malformed snapshots or missing required
  revisions. Repeated recovery failures end the connection with a clear error.
- Require reliable and motion channels before completing a join. A failed
  channel triggers reconnect of both channels using the existing visitor token.
- Compare both authored world sizes with 20 connected peers. Use host plus four
  rendered guests for the primary rate comparison and host plus 19 rendered
  guests for rendering stress. Measure payload, host frame time, queued bytes,
  motion pauses, and corrections under delay and loss. Select the default rate
  from the implementation report before pushing it.
- Keep direction and stop commands on the reliable channel. Replaceable input
  delivery and repeated input commands require a separate future design.
- Track freshness separately for reliable state and entity motion. An older
  reliable snapshot can update valid terrain, sight, and chat without rewinding
  newer entity positions. A view change removes entities no longer visible.
- Continue sending settled motion state for 300 ms after movement stops. Keep
  reliable snapshots every 500 ms as recovery. Do not send motion continuously
  during idle periods once the settling interval ends.
- Retain only the newest pending motion state under backpressure. Generate it
  from current world state when the channel can send again. Measure queues and
  bytes across both data channels.

## Transport evidence

- [RFC 8831](https://www.rfc-editor.org/rfc/rfc8831.html) explicitly describes
  unreliable game position updates alongside reliable control and chat data.
  Channels in one SCTP association share congestion control.
- [Snapshot Interpolation](https://www.gafferongames.com/post/snapshot_interpolation/)
  describes discarding older snapshots and interpolating newer ones. Packet loss
  tolerance depends on update rate and presentation delay.
- [WebRTC](https://www.w3.org/TR/webrtc/) exposes ordering and retransmission
  limits separately. Unordered delivery alone still permits reliable delivery.

## Implementation stages

1. Establish current 20-peer measurements and extract entity filtering from
   terrain copying and visibility serialization. Preserve sight recomputation,
   last-observed terrain memory, and hidden movement endpoint rules.
2. Expire incomplete joins without changing established reconnect reservations.
3. Add a versioned validated JSON protocol and explicit motion fields. Decode
   complete reliable updates before applying them. Introduce the revisions
   needed to coordinate reliable sight updates with unordered motion.
4. Separate reliable state/chat/input and unordered motion. Preserve current
   chat ranges, expiry, sight fades, local prediction, and elevation behavior.
   Add stale-packet, missing-update, stop-state, and backpressure checks.
5. Compare 10 and 20 updates per second with 20 connected peers before selecting
   the default. Review the report with Josh. Run the final group stress test and
   document a desktop/phone check after the selected changes are complete.

Run the required verification and browser suites before each implementation
push. Verify CI and deployed files. Post an issue #9 progress comment after each
push with the commit, implemented scope, results, and remaining work.

## Measurement requirements

- Compare the current transport baseline, extracted filtering, and the split
  transport using matched workloads, durations, and random seeds.
- Cover 16×16 and 32×32 worlds, entity/master transitions, reconnects, and the
  two agreed rendering profiles at 20 connected peers.
- Measure per-peer and aggregate bytes, filtering/encoding/send time, host frame
  time, both send queues, remote motion pauses, and prediction corrections.
- Check delay, jitter, and motion loss. Treat application message loss as a
  controlled simulation rather than physical WebRTC packet-loss evidence.
  Exercise unreliable motion independently of reliable chat and state, and
  exercise ordering between channels explicitly.
- Check chat delivery, original expiry, hidden entity filtering, stationary
  partial opacity, stop/reversal behavior, collisions, and elevation steps.
- Keep content out of diagnostics. Record message IDs and timing where needed.

## Deferred work

- Terrain/visibility section revisions and cell/chunk deltas. Static terrain
  still has recipient-specific discovery and memory, so these need a separate
  synchronization design when measurements justify it.
- Motion deltas, binary encoding, and coordinate quantization.
- Input replay and replacement-input transport.

The first measurements are recorded in
[the stage 1 report](stress-runs/2026-09-30-protocol-stage1.md).
