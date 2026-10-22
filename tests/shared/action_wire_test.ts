import { assertEquals } from "@std/assert";
import { decodeActionResult } from "../../src/shared/action-wire.js";

const accepted = {
  type: "action-result",
  attempt: "current",
  action: "pickup",
  x: 3,
  y: -4,
  z: 1,
};

Deno.test("accepted action results validate their attempt, action and integer tile", () => {
  for (const action of ["pickup", "place", "sell"]) {
    const packet = { ...accepted, action };
    assertEquals(decodeActionResult(packet, "current"), packet);
  }
  assertEquals(decodeActionResult(accepted, "replacement"), null);
  for (
    const change of [
      { attempt: "" },
      { attempt: "__proto__" },
      { attempt: "x".repeat(129) },
      { action: "mine" },
      { action: { toString: () => "pickup" } },
      { type: "pickup-result" },
      { x: 1.5 },
      { x: Infinity },
      { y: NaN },
      { y: "4" },
      { z: -1 },
      { z: 8 },
      { z: 0.5 },
      { x: 2 ** 24 + 1 },
    ]
  ) {
    assertEquals(
      decodeActionResult({ ...accepted, ...change }, "current"),
      null,
    );
  }
  for (const value of [null, [], "action-result", 1]) {
    assertEquals(decodeActionResult(value, "current"), null);
  }
  assertEquals(
    decodeActionResult(
      { ...accepted, tags: ["untrusted"], extra: 42 },
      "current",
    ),
    accepted,
  );
});
