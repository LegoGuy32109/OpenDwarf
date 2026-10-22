import { assertEquals } from "@std/assert";
import {
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
import {
  cameraInput,
  inputDirection,
  openLevel,
} from "../../src/client/input-values.js";
import { createInventoryPanel } from "../../src/client/inventory-panel.js";
import { createShopPanel } from "../../src/client/shop-panel.js";
import {
  closePickupGrid,
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
    shop: createShopPanel({ sell: () => {}, talk: () => {}, flash: () => {} }),
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
  assertEquals(parentLevel("shop-items"), "shop");
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

Deno.test("an open menu takes the look keys but leaves ESDF walking", () => {
  const ctx = fakeContext() as unknown as Record<string, unknown> & {
    held: Set<string>;
  };
  Object.assign(ctx, {
    held: new Set(["KeyI", "KeyL", "KeyF"]),
    pressed: new Set<string>(),
    joystick: { x: 0, y: 0 },
    cameraStick: { x: 0, y: 0 },
    gamepadDirection: { x: 0, y: 0 },
    gamepadCamera: { x: 0, y: 0 },
  });
  const typed = ctx as unknown as Parameters<typeof cameraInput>[0];
  // With nothing open, IJKL aim.
  assertEquals(cameraInput(typed), { x: 1, y: -1 });
  const opens: [string, () => void][] = [
    ["menu", () => toggleMenu(typed)],
    ["bag", () => typed.bag.toggle(true)],
    ["shop", () => typed.shop.open()],
    [
      "grid",
      () => openPickupGrid(typed.pickupGrid, { x: 1, y: 1, z: 0 }, 0),
    ],
  ];
  for (const [level, open] of opens) {
    closeMenu(typed);
    typed.bag.toggle(false);
    typed.shop.close();
    closePickupGrid(typed.pickupGrid);
    open();
    assertEquals(openLevel(typed), level);
    assertEquals(cameraInput(typed), { x: 0, y: 0 }, `${level} aim`);
    assertEquals(inputDirection(typed), { x: 1, y: 0 }, `${level} walk`);
  }
});

Deno.test("with a menu open the left stick still walks", () => {
  const ctx = fakeContext() as unknown as Parameters<typeof inputDirection>[0];
  Object.assign(ctx, {
    held: new Set<string>(),
    pressed: new Set<string>(),
    joystick: { x: 0, y: 0 },
    gamepadDirection: { x: -1, y: 0 },
  });
  toggleMenu(ctx);
  assertEquals(inputDirection(ctx), { x: -1, y: 0 });
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

Deno.test("the trader conversation sits above the item list, and Back restores it", () => {
  const talked: string[][] = [];
  const ctx = fakeContext();
  ctx.shop = createShopPanel({
    sell: () => {},
    talk: (npc, choice) => talked.push([npc, choice]),
    flash: () => {},
  });
  ctx.shop.open(0, { id: "npc-ulgar", name: "Ulgar" });
  assertEquals([openLevel(ctx), ctx.shop.level], ["shop", "conversation"]);
  assertEquals(ctx.shop.choices.map((choice) => choice.text), [
    "I have ore to trade",
    "What do you buy?",
  ]);
  // Highlighting is silent: nothing is asked until a choice is confirmed.
  ctx.shop.move(1);
  assertEquals(talked, []);
  ctx.shop.move(-1);
  ctx.shop.confirm();
  assertEquals(talked, [["npc-ulgar", "sell"]]);
  assertEquals(openLevel(ctx), "shop-items");
  // Back returns to the conversation with the same choice selected.
  goBack(ctx);
  assertEquals([openLevel(ctx), ctx.shop.selected], ["shop", "talk:sell"]);
  ctx.shop.move(1);
  ctx.shop.confirm();
  assertEquals(talked.at(-1), ["npc-ulgar", "buys"]);
  assertEquals(openLevel(ctx), "shop", "a spoken question keeps the menu open");
  goBack(ctx);
  assertEquals(openLevel(ctx), null);
});

Deno.test("opening the conversation raises the thought icon through onOpenChange", () => {
  const changes: boolean[] = [];
  let open = false;
  const shop = createShopPanel({
    sell: () => {},
    talk: () => {},
    flash: () => {},
    onOpenChange: () => changes.push(open = shop.isOpen()),
  });
  shop.open(0, { id: "npc-ulgar", name: "Ulgar" });
  shop.open(0, { id: "npc-ulgar", name: "Ulgar" });
  shop.back();
  assertEquals(changes, [true, false]);
  assertEquals(open, false);
});
