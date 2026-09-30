import { assertEquals } from "@std/assert";
import { createRevisionOrder } from "../../src/client/revision-order.js";

Deno.test("future motion waits for sight and stale motion cannot restore old view", () => {
  const order = createRevisionOrder();
  const stamp = { viewRevision: 0, sightRevision: 0, tick: 5 };
  assertEquals(order.motion(stamp), "hold");
  assertEquals(order.reliable({ ...stamp, tick: 4 })?.preserveMotion, false);
  assertEquals(order.motion(stamp), "apply");
  assertEquals(order.motion({ ...stamp, sightRevision: 1, tick: 7 }), "hold");
  assertEquals(
    order.reliable({ ...stamp, sightRevision: 1, tick: 6 })?.sightChanged,
    true,
  );
  assertEquals(order.motion({ ...stamp, tick: 8 }), "drop");
  assertEquals(order.motion({ ...stamp, sightRevision: 1, tick: 7 }), "apply");
  order.reliable({ viewRevision: 1, sightRevision: 0, tick: 8 });
  assertEquals(order.motion({ ...stamp, sightRevision: 1, tick: 9 }), "drop");
});

Deno.test("older reliable snapshot preserves newer motion while applying state", () => {
  const order = createRevisionOrder();
  const stamp = { viewRevision: 0, sightRevision: 0, tick: 10 };
  order.reliable(stamp);
  assertEquals(order.motion({ ...stamp, tick: 15 }), "apply");
  assertEquals(order.reliable({ ...stamp, tick: 12 })?.preserveMotion, true);
  assertEquals(order.reliable({ ...stamp, tick: 11 }), null);
  assertEquals(order.motion({ ...stamp, tick: 14 }), "drop");
  order.reset();
  assertEquals(order.motion(stamp), "hold");
});
