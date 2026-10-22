import { assertEquals } from "@std/assert";
import {
  capturedInputs,
  createMenuNav,
  MENU_ROWS,
  parentLevel,
  SETTINGS_ROWS,
  settingsChanges,
  stepChoice,
  stepRow,
} from "../../src/client/menu-nav.js";
import {
  closeMenu,
  goBack,
  menuConfirm,
  menuRow,
  menuStep,
  replaceWithBag,
  toggleMenu,
} from "../../src/client/panels.js";
import { openLevel } from "../../src/client/input-values.js";
import { createInventoryPanel } from "../../src/client/inventory-panel.js";
import { createShopPanel } from "../../src/client/shop-panel.js";
import {
  createPickupGrid,
  openPickupGrid,
} from "../../src/client/pickup-grid.js";

/** The parts of the client context that menu navigation reads. */
function fakeContext() {
  return {
    scene: { menu: false, menuPage: "root", chatOpen: false, textSize: "m" },
    ui: { logOpen: false, logScroll: 0 },
    nav: createMenuNav(),
    bag: createInventoryPanel({ onHold: () => {}, onOpenChange: () => {} }),
    shop: createShopPanel({ sell: () => {}, flash: () => {} }),
    pickupGrid: createPickupGrid(),
    chatter: { level: "all" },
    music: { level: "50" },
    sfx: { level: "50" },
  } as unknown as Parameters<typeof goBack>[0];
}

Deno.test("Back goes up one level: Settings to the menu, then to the world", () => {
  assertEquals(parentLevel("settings"), "menu");
  assertEquals(parentLevel("menu"), null);
  assertEquals(parentLevel("bag"), null);
  assertEquals(parentLevel("shop"), null);
  assertEquals(parentLevel("grid"), null);
  assertEquals(parentLevel(null), null);

  const ctx = fakeContext();
  toggleMenu(ctx);
  ctx.scene.menuPage = "settings";
  assertEquals(openLevel(ctx), "settings");
  goBack(ctx);
  assertEquals([ctx.scene.menu, openLevel(ctx)], [true, "menu"]);
  goBack(ctx);
  assertEquals([ctx.scene.menu, openLevel(ctx)], [false, null]);
});

Deno.test("Back from the bag, the shop, and the pickup grid returns to the world", () => {
  const ctx = fakeContext();
  ctx.bag.toggle(true);
  assertEquals(openLevel(ctx), "bag");
  goBack(ctx);
  assertEquals(openLevel(ctx), null);
  ctx.shop.open();
  assertEquals(openLevel(ctx), "shop");
  goBack(ctx);
  assertEquals(openLevel(ctx), null);
  openPickupGrid(ctx.pickupGrid, { x: 1, y: 1, z: 0 }, 0);
  assertEquals(openLevel(ctx), "grid");
  goBack(ctx);
  assertEquals(openLevel(ctx), null);
});

Deno.test("with no menu open, Back closes the hearing log, then opens the menu", () => {
  const ctx = fakeContext();
  ctx.ui.logOpen = true;
  goBack(ctx);
  assertEquals([ctx.ui.logOpen, ctx.scene.menu], [false, false]);
  goBack(ctx);
  assertEquals(ctx.scene.menu, true);
});

Deno.test("Back restores the parent menu's selection", () => {
  const ctx = fakeContext();
  const press = (id: string) => {
    if (id === "btn:settings") ctx.scene.menuPage = "settings";
  };
  toggleMenu(ctx);
  menuStep(ctx, 0, 1, press);
  assertEquals(menuRow(ctx), "settings");
  menuConfirm(ctx, press);
  assertEquals(ctx.scene.menuPage, "settings");
  menuStep(ctx, 0, 1, press);
  menuStep(ctx, 0, 1, press);
  assertEquals(menuRow(ctx), "voices");
  goBack(ctx);
  assertEquals(menuRow(ctx), "settings");
  // Opening the menu again starts from the first row.
  closeMenu(ctx);
  toggleMenu(ctx);
  assertEquals(menuRow(ctx), "resume");
});

Deno.test("X and Y replace the open menu or panel", () => {
  const ctx = fakeContext();
  ctx.shop.open();
  toggleMenu(ctx);
  assertEquals([ctx.shop.isOpen(), openLevel(ctx)], [false, "menu"]);
  replaceWithBag(ctx);
  assertEquals([ctx.scene.menu, openLevel(ctx)], [false, "bag"]);
  replaceWithBag(ctx);
  assertEquals(openLevel(ctx), null);
});

Deno.test("in Settings, I and K choose a row and J and L change its value", () => {
  const ctx = fakeContext();
  const pressed: string[] = [];
  const press = (id: string) => pressed.push(id);
  toggleMenu(ctx);
  ctx.scene.menuPage = "settings";
  menuStep(ctx, 1, 0, press);
  assertEquals(pressed, ["btn:scale-up"]);
  menuStep(ctx, -1, 0, press);
  assertEquals(pressed.at(-1), "btn:scale-down");
  // Up from the first row wraps to the last, which has no value to change.
  menuStep(ctx, 0, -1, press);
  assertEquals(menuRow(ctx), "back");
  menuStep(ctx, 1, 0, press);
  assertEquals(pressed.length, 2);
  menuConfirm(ctx, press);
  assertEquals(pressed.at(-1), "btn:back");
  // Confirm does nothing on a value row.
  menuStep(ctx, 0, -1, press);
  menuConfirm(ctx, press);
  assertEquals(pressed.length, 3);
});

Deno.test("rows wrap, and a choice list stops at its ends", () => {
  assertEquals(stepRow(0, 3, -1), 2);
  assertEquals(stepRow(2, 3, 1), 0);
  assertEquals(stepRow(1, 3, 1), 2);
  assertEquals(stepRow(0, 0, 1), 0);
  assertEquals(stepChoice(["off", "50", "100"], "50", 1), "100");
  assertEquals(stepChoice(["off", "50", "100"], "100", 1), null);
  assertEquals(stepChoice(["off", "50", "100"], "off", -1), null);
  assertEquals(stepChoice(["off", "50", "100"], undefined, 1), "off");
  assertEquals(MENU_ROWS, ["resume", "settings", "leave"]);
  assertEquals(SETTINGS_ROWS.at(-1), "back");
});

Deno.test("settings changes name the button a value step presses", () => {
  const change = settingsChanges(
    {
      sizes: ["s", "m", "l"],
      voices: ["off", "all"],
      music: ["off", "50"],
      effects: ["off", "50"],
    },
    { size: "m", voices: "all", music: "off", effects: undefined },
  );
  assertEquals(change.size(1), "btn:size:l");
  assertEquals(change.size(-1), "btn:size:s");
  assertEquals(change.voices(1), null);
  assertEquals(change.music(1), "btn:music:50");
  assertEquals(change.effects(1), "btn:effects:off");
});

Deno.test("an open menu captures the look, confirm, and back inputs but never movement", () => {
  for (const level of ["menu", "settings", "bag", "grid", "shop"] as const) {
    assertEquals(capturedInputs(level), {
      look: true,
      confirm: true,
      back: true,
      move: false,
    });
  }
  assertEquals(capturedInputs(null), {
    look: false,
    confirm: false,
    back: false,
    move: false,
  });
});

Deno.test("a newly opened menu ignores the confirm press that is still held", () => {
  const nav = createMenuNav();
  nav.update(null, true);
  assertEquals(nav.armed, true);
  // The held button opened the shop: it cannot also choose a row.
  nav.update("shop", true);
  assertEquals(nav.armed, false);
  nav.update("shop", true);
  assertEquals(nav.armed, false);
  // A release arms it, and a later press confirms.
  nav.update("shop", false);
  assertEquals(nav.armed, true);
  nav.update("shop", true);
  assertEquals(nav.armed, true);
});

Deno.test("a child menu opened by a confirm needs its own fresh press", () => {
  const nav = createMenuNav();
  nav.update("menu", false);
  assertEquals(nav.armed, true);
  nav.update("settings", true);
  assertEquals(nav.armed, false);
  nav.update("settings", false);
  assertEquals(nav.armed, true);
  // A menu opened with nothing held is ready at once.
  nav.update("bag", false);
  assertEquals(nav.armed, true);
});
