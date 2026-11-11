import { assertEquals } from "@std/assert";
import { createActionGesture } from "../../src/shared/single-plane.js";
import {
  aimGesture,
  armGesture,
  cancelGesture,
  dragGesture,
  releaseGesture,
} from "../../src/client/action-gesture.js";

Deno.test("pointer aim uses its origin, all eight octants, and CSS pixel dead zone", () => {
  for (
    const [x, y] of [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [
      0,
      -1,
    ], [1, -1]]
  ) {
    const gesture = createActionGesture();
    armGesture(gesture, 200, 100);
    dragGesture(gesture, 200 + x * 30, 100 + y * 30);
    assertEquals(releaseGesture(gesture), {
      result: "throw",
      direction: { x, y },
    });
    assertEquals(releaseGesture(gesture).result, "none");
  }
  const gesture = createActionGesture();
  armGesture(gesture, 200, 100);
  dragGesture(gesture, 215, 100);
  assertEquals(releaseGesture(gesture).result, "tap");
  armGesture(gesture, 200, 100);
  dragGesture(gesture, 217, 100);
  assertEquals(releaseGesture(gesture).result, "throw");
});

Deno.test("aim history cancels at center and can re-enter aiming", () => {
  for (const reenter of [false, true]) {
    const gesture = createActionGesture();
    armGesture(gesture);
    aimGesture(gesture, { x: 0, y: -1 });
    aimGesture(gesture, { x: 0, y: 0 });
    assertEquals(gesture.everAimed, true);
    if (reenter) aimGesture(gesture, { x: -1, y: 1 });
    assertEquals(releaseGesture(gesture).result, reenter ? "throw" : "cancel");
  }
});

Deno.test("interrupting an aimed gesture never executes release", () => {
  const gesture = createActionGesture();
  armGesture(gesture);
  dragGesture(gesture, 30, 0);
  cancelGesture(gesture);
  assertEquals(releaseGesture(gesture).result, "none");
  aimGesture(gesture, { x: 1, y: 0 });
  assertEquals(gesture, createActionGesture());
});
