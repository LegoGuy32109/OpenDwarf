import { assertEquals } from "@std/assert";
import { visibleThrows } from "../../src/client/host-action-view.js";
import { createOpenField } from "../shared/fixtures.ts";
Deno.test("flight views include current visible tiles or floors and hide all other paths", () => {
  const world = createOpenField();
  world.throws = [
    {
      id: "visible",
      owner: "p",
      kind: "coin",
      x: 5.4,
      y: 5,
      z: 1,
      dx: 1,
      dy: 0,
      remaining: 2,
    },
    {
      id: "hidden",
      owner: "p",
      kind: "stone",
      x: 9,
      y: 9,
      z: 1,
      dx: 1,
      dy: 0,
      remaining: 2,
    },
  ];
  assertEquals(visibleThrows(world, new Set(["5,5,0"])).map((s) => s.id), [
    "visible",
  ]);
  assertEquals(visibleThrows(world, new Set(["5,5,1"])).map((s) => s.id), [
    "visible",
  ]);
  assertEquals(visibleThrows(world, new Set()), []);
  assertEquals(visibleThrows(world, new Set(), true), world.throws);
});
