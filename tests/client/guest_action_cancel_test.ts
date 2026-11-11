import { assertEquals } from "@std/assert";
import { bindActionCancellation } from "../../src/client/guest-action-cancel.js";
Deno.test("transport cancellation uses the current callback and ignores obsolete sessions", () => {
  let calls = 0;
  const scene = { cancelAction: () => calls++ };
  const old = bindActionCancellation(scene);
  old();
  assertEquals(calls, 1);
  const current = bindActionCancellation(scene);
  old();
  assertEquals(calls, 1);
  scene.cancelAction = () => calls += 10;
  current();
  assertEquals(calls, 11);
  bindActionCancellation({})();
});
