# Sight-boundary opacity and chat range

Status: implemented. This records decisions from the sight-boundary grilling
session and the behavior in the current client and host protocol.

## Agreed behavior

- A visible entity's opacity depends on its center position near a sight
  boundary. It is fully opaque at the center of the last visible tile and fades
  to zero at the hidden edge. Stopping does not change that opacity.
- The host includes an entity only while its center tile is visible. The fade
  finishes on the visible side of the boundary.
- The local character stays fully opaque. Other players and NPCs use the
  boundary fade.
- When the viewer moves and sight changes around a stationary entity, the
  resulting opacity change animates over about 150 ms.
- Measure opacity from the entity center to the closest edge of the visible
  region, including corner boundaries. Equal distances give equal opacity.
- When an entity leaves sight, the guest may keep its last visible position for
  up to 150 ms to finish fading out. It receives no hidden position.
- A newly revealed entity fades from zero to its position-based opacity over 150
  ms.
- Field-of-view boundaries use this fade. Master view has no field of view and
  does not apply entity opacity.
- Master view keeps the existing depth range and blue depth tints. Entities
  behind solid floors or outside that range remain omitted; rendered entities
  are fully opaque.
- Spatial opacity follows entity position each frame. The 150 ms transition
  applies only when sight changes or an entity joins or leaves a guest's visible
  set.
- An entity uses the sight boundary at its current logical z level. A 150 ms
  sight transition covers a z change.
- Name labels share their entity's opacity. Chat bubbles follow a separate
  distance rule.

## Chat range requested

- Measure Euclidean distance between continuous x/y entity centers. The range is
  a flat circle. Show message text at horizontal distance 5 or less.
- Apply a separate vertical cutoff: a speaker up to four z levels from the
  listener can be heard. A greater z difference suppresses both text and the
  talking indicator. Z does not add to horizontal distance.
- From more than 5 through 12 blocks, show `:0` in the same place as the text
  bubble. It snaps to the active text when the listener enters hearing range.
- Beyond 12 blocks, show neither message text nor a talking indicator. The
  entity itself may remain visible.
- Speech passes through walls within range. A bubble is attached only to a
  speaker within range, even if the speaker is outside field of view.
- The world host sends a guest message text only within 5 blocks. From more than
  5 through 12 blocks, it sends an activity flag without text. Beyond 12 blocks,
  it sends neither.
- Master view measures chat distance from the client's entity, independent of
  camera position.
- Show a typing indicator only within 5 blocks. Its text is `...`. Typing alone
  does not produce `:0` at a greater distance. Typing ignores field of view like
  message bubbles.
- An active text bubble snaps to `:0` when its listener moves beyond hearing
  range, and disappears beyond talking-indicator range. The reverse changes
  occur when the listener moves closer.
- The host sends the new range-filtered chat state on the next motion update,
  about 100 ms after a range threshold is crossed.
- Chat bubbles keep their normal UI opacity even if the speaker sprite is partly
  faded or omitted by sight. Field of view does not control chat visibility.
- `:0` uses the same bubble frame and position as message text, sized to its
  short content.
- Use a 0.1-block buffer at the 5- and 12-block thresholds to prevent rapid
  switching when positions change slightly. Initial range classification uses
  the exact thresholds. A later switch waits until the distance crosses 0.1
  block past the relevant threshold.
- A hidden speaker's bubble appears at the speaker's projected x/y position,
  which can reveal that position through a wall. The sprite and name stay hidden
  by sight.
- A speaker within chat range but outside the camera viewport gets a bubble at
  the screen edge with a small direction marker.
- An offscreen bubble shows full text within the text range and `:0` within the
  talking-indicator range.
- If several offscreen speakers share an edge, stack the three nearest bubbles
  and show `+N` for additional speakers.
- If bubbles overlap on screen, use the same stack of three nearest and `+N` for
  additional speakers.
- Hearing can show a bubble for a speaker outside the selected view depth. The
  bubble uses the same horizontal position while terrain and sprites follow
  their existing depth rules.
- A bubble from another z level shows a small `↑` or `↓` and the level
  difference. This applies to text, `:0`, and `...` bubbles.
- A message bubble and its `:0` indicator expire at the original five-second
  deadline, even if the message became visible only briefly. The guest removes
  the bubble at that deadline without waiting for another host update.
- Sight-range improvements while climbing stairs are a separate priority.

## Delivery shape

- The host sends recipient-specific chat data separately from field-of-view
  entity records. An unseen speaker can supply a bubble position without
  supplying a visible sprite or name.
- The recipient receives text only in hearing range, an activity flag only in
  the talking-indicator band, and no message content outside those bands.
- The host sends the original message expiry with the filtered chat data.
