import { assertEquals } from "@std/assert";
import { scrollList } from "../../src/client/ui-view.js";
import type { Context } from "../../src/client/client-context.js";

function scrollContext() {
  const calls: number[] = [];
  const fixture = {
    scene: { uiScale: 1, ui: { layout: { ts: 2 } } },
    ui: { logScroll: 2, scrollRemainder: { log: 0, shop: 0 } },
    shop: { scrollBy: (rows: number) => calls.push(rows) },
  };
  return { ctx: fixture as unknown as Context, fixture, calls };
}
Deno.test("log scrolling accumulates partial rows, preserves remainder and clamps at the newest line", () => {
  const { ctx, fixture } = scrollContext();
  scrollList(ctx, "log", 15);
  assertEquals(fixture.ui.logScroll, 2);
  assertEquals(fixture.ui.scrollRemainder.log, 15);
  scrollList(ctx, "log", 30);
  assertEquals(fixture.ui.logScroll, 1);
  assertEquals(fixture.ui.scrollRemainder.log, 5);
  scrollList(ctx, "log", 100);
  assertEquals(fixture.ui.logScroll, 0);
  scrollList(ctx, "log", -80);
  assertEquals(fixture.ui.logScroll, 1);
});
Deno.test("shop scrolling uses its row height and keeps the log remainder separate", () => {
  const { ctx, fixture, calls } = scrollContext();
  scrollList(ctx, "shop", 20);
  assertEquals(calls, []);
  scrollList(ctx, "shop", 80);
  assertEquals(calls, [2]);
  assertEquals(fixture.ui.scrollRemainder.shop, 4);
  assertEquals(fixture.ui.scrollRemainder.log, 0);
  scrollList(ctx, "shop", -52);
  assertEquals(calls, [2, -1]);
});
