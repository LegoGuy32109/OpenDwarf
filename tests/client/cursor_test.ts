import { assertEquals, assertNotEquals } from "@std/assert";
import { cursorParams } from "../../src/client/cursor.js";
import {
  CURSOR_COLOR,
  CURSOR_ICON_DIM,
  CURSOR_OPACITY,
} from "../../src/shared/reach.js";
import { ITEM_KINDS } from "../../src/shared/items.js";

Deno.test("the cursor outline uses the shared color and opacity", () => {
  const params = cursorParams("pickaxe", "mine");
  assertEquals(params.color, CURSOR_COLOR);
  assertEquals(params.opacity, CURSOR_OPACITY);
});

Deno.test("the icon is the held item's sheet frame", () => {
  for (const { kind, frame } of ITEM_KINDS) {
    assertEquals(cursorParams(kind, "place").iconFrame, frame);
  }
  assertNotEquals(
    cursorParams("pickaxe", "mine").iconFrame,
    cursorParams("stone", "mine").iconFrame,
  );
});

Deno.test("the icon is full when interact would act and dim when it would not", () => {
  for (const action of ["mine", "place", "pickup", "shop"] as const) {
    assertEquals(cursorParams("stone", action).iconOpacity, 1);
  }
  assertEquals(cursorParams("stone", null).iconOpacity, CURSOR_ICON_DIM);
});

Deno.test("an unknown held kind has no icon", () => {
  assertEquals(cursorParams("nothing", null).iconFrame, null);
});
