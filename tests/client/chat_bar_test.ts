import { assertEquals } from "@std/assert";
import { keyboardInset } from "../../src/client/chat-bar.js";

Deno.test("keyboard inset is the layout space the visual viewport lost", () => {
  assertEquals(keyboardInset(800, { height: 800, offsetTop: 0 }), 0);
  assertEquals(keyboardInset(800, { height: 480, offsetTop: 0 }), 320);
  // Safari scrolls the visual viewport down when it focuses the input.
  assertEquals(keyboardInset(800, { height: 480, offsetTop: 120 }), 200);
  assertEquals(keyboardInset(800, { height: 805, offsetTop: 0 }), 0);
  assertEquals(keyboardInset(800, { height: NaN, offsetTop: 0 }), 0);
});
