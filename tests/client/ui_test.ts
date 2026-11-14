import { assert, assertEquals } from "@std/assert";
import {
  ascii,
  CHAT_LIMIT,
  hitTest,
  layoutUi,
  stickVector,
  typeKey,
  type UiElement,
  type UiView,
  wrapText,
} from "../../src/client/ui.js";
import { createPointerRouter } from "../../src/client/ui-pointer.js";

const PORTRAIT = {
  width: 390,
  height: 844,
  safe: { top: 47, right: 0, bottom: 34, left: 0 },
};
const LANDSCAPE = {
  width: 844,
  height: 390,
  safe: { top: 0, right: 47, bottom: 21, left: 47 },
};
const WIDE = {
  width: 932,
  height: 430,
  safe: { top: 0, right: 59, bottom: 21, left: 59 },
};
const SCREENS = { PORTRAIT, LANDSCAPE, WIDE };

const STACKS = [
  { kind: "pickaxe", count: 1 },
  { kind: "stone", count: 12 },
  { kind: "coal", count: 3 },
  { kind: "iron ore", count: 4 },
  { kind: "gold ore", count: 2 },
  { kind: "lapis", count: 5 },
  { kind: "redstone", count: 6 },
  { kind: "diamond", count: 1 },
  { kind: "emerald", count: 1 },
  { kind: "coin", count: 99 },
];
/** The trader panel's fields besides its rows and selection. */
const ITEMS_PANEL = {
  open: true,
  level: "items" as const,
  title: "Ulgar",
  choices: [],
};
const ROWS = [
  { type: "all" as const, coins: 20, count: 5, enabled: true },
  ...STACKS.map((stack) => ({
    type: "stack" as const,
    kind: stack.kind,
    count: stack.count,
    price: 1,
    coins: stack.count,
    enabled: stack.kind !== "pickaxe",
  })),
];

function view(
  screen: { width: number; height: number; safe: UiView["safe"] },
  extra: Partial<UiView> = {},
): UiView {
  return { ...screen, touch: true, dpr: 1, scale: 1, ...extra };
}

/** The safe area as a rectangle. */
function inside(screen: typeof PORTRAIT, el: UiElement, label = el.id) {
  const { x, y, w, h } = el.rect;
  const eps = 0.01;
  assert(x >= screen.safe!.left - eps, `${label} left`);
  assert(y >= screen.safe!.top - eps, `${label} top`);
  assert(x + w <= screen.width - screen.safe!.right + eps, `${label} right`);
  assert(y + h <= screen.height - screen.safe!.bottom + eps, `${label} bottom`);
}

/** The distance from a circle's center to the nearest point of a box. */
function circleClearOfBox(circle: UiElement, box: UiElement) {
  const nearestX = Math.max(
    box.rect.x,
    Math.min(circle.cx!, box.rect.x + box.rect.w),
  );
  const nearestY = Math.max(
    box.rect.y,
    Math.min(circle.cy!, box.rect.y + box.rect.h),
  );
  return Math.hypot(nearestX - circle.cx!, nearestY - circle.cy!) > circle.r!;
}

/** Every touch control is clear of the others at a UI scale. */
function controlsApart(screen: typeof PORTRAIT, scale: number) {
  const layout = layoutUi(view(screen, { scale }));
  const move = layout.byId.get("stick:move")!;
  const controls = [
    "stick:move",
    "btn:interact",
    "btn:sprint",
    "btn:chat",
    "btn:menu",
    "btn:bag",
  ].map((id) => layout.byId.get(id)!);
  assertEquals(layout.byId.has("stick:look"), false);
  assertEquals(layout.byId.has("btn:log"), false);
  for (const [i, a] of controls.entries()) {
    for (const b of controls.slice(i + 1)) {
      // Chat deliberately overlays the floating movement region.
      if (
        [a.id, b.id].includes("stick:move") && [a.id, b.id].includes("btn:chat")
      ) continue;
      assert(
        a.rect.x + a.rect.w <= b.rect.x || b.rect.x + b.rect.w <= a.rect.x ||
          a.rect.y + a.rect.h <= b.rect.y || b.rect.y + b.rect.h <= a.rect.y,
        `${a.id} overlaps ${b.id}`,
      );
    }
  }
  assert(circleClearOfBox(move, layout.byId.get("btn:interact")!));
}

for (const [name, screen] of Object.entries(SCREENS)) {
  Deno.test(`touch controls fit the safe area in ${name}`, () => {
    for (const scale of [1, 1.5, 2]) {
      const layout = layoutUi(view(screen, { scale }));
      for (
        const id of [
          "stick:move",
          "btn:interact",
          "btn:sprint",
          "btn:chat",
          "btn:menu",
          "btn:bag",
        ]
      ) {
        const el = layout.byId.get(id);
        assert(el, `${id} exists at scale ${scale}`);
        inside(screen as typeof PORTRAIT, el, `${id}@${scale}`);
      }
    }
  });

  Deno.test(`touch controls do not overlap in ${name}`, () => {
    for (const scale of [1, 1.5, 2]) controlsApart(screen, scale);
  });

  Deno.test(`a larger UI scale never shrinks the buttons in ${name}`, () => {
    const small = layoutUi(view(screen, { scale: 1 }));
    const large = layoutUi(view(screen, { scale: 2 }));
    for (const id of ["btn:interact", "btn:sprint", "btn:chat", "btn:bag"]) {
      assert(
        large.byId.get(id)!.rect.w >= small.byId.get(id)!.rect.w - 0.01,
        id,
      );
    }
  });

  Deno.test(`the inventory and shop panels sit above the controls in ${name}`, () => {
    const layout = layoutUi(view(screen, {
      bag: { open: true, stacks: STACKS, selected: 1, held: "pickaxe" },
    }));
    const panel = layout.byId.get("panel:bag")!;
    inside(screen as typeof PORTRAIT, panel);
    for (const id of ["btn:bag", "btn:interact", "btn:sprint", "stick:move"]) {
      const control = layout.byId.get(id)!;
      // Controls under the panel's columns must not be covered.
      const overlapsX = control.rect.x < panel.rect.x + panel.rect.w &&
        control.rect.x + control.rect.w > panel.rect.x;
      if (overlapsX) {
        assert(panel.rect.y + panel.rect.h <= control.rect.y + 0.01, id);
      }
    }
    for (const stack of STACKS) {
      inside(screen as typeof PORTRAIT, layout.byId.get(`slot:${stack.kind}`)!);
    }
    const shop = layoutUi(view(screen, {
      shop: { ...ITEMS_PANEL, rows: ROWS, selected: "coal", scroll: 0 },
    }));
    const shopPanel = shop.byId.get("panel:shop")!;
    inside(screen as typeof PORTRAIT, shopPanel);
    for (
      const id of ["btn:interact", "btn:sprint", "stick:move"]
    ) {
      const control = shop.byId.get(id)!;
      const overlapsX = control.rect.x < shopPanel.rect.x + shopPanel.rect.w &&
        control.rect.x + control.rect.w > shopPanel.rect.x;
      if (overlapsX) {
        assert(
          shopPanel.rect.y + shopPanel.rect.h <= control.rect.y + 0.01,
          id,
        );
      }
    }
    assert(shop.shopList!.capacity >= 1);
    const talk = layoutUi(view(screen, {
      shop: {
        ...ITEMS_PANEL,
        level: "conversation",
        choices: [
          { name: "talk:sell", text: "I have ore to trade", on: true },
          { name: "talk:buys", text: "What do you buy?", on: false },
        ],
        rows: [],
        selected: "talk:sell",
        scroll: 0,
      },
    }));
    inside(screen as typeof PORTRAIT, talk.byId.get("panel:shop")!);
    assertEquals(talk.byId.get("text:shop-context-0")!.text?.length! > 0, true);
    // A short screen scrolls the list, so only the first line is certain.
    assertEquals(talk.byId.get("row:talk:sell")!.text, "I have ore to trade");
    assertEquals(talk.byId.get("row:talk:sell")!.on, true);
  });

  Deno.test(`the in-game keyboard fits in ${name}`, () => {
    const layout = layoutUi(view(screen, {
      chat: { open: true, draft: "hello", page: "letters", shift: false },
    }));
    const keys = layout.elements.filter((el) => el.kind === "key");
    // Ten letters in the top row, nine below, seven and two edges, and four at the bottom.
    assertEquals(keys.length, 10 + 9 + 7 + 2 + 4);
    for (const key of keys) {
      inside(screen as typeof PORTRAIT, key);
      assert(key.rect.h >= 36, `${key.id} is ${key.rect.h} tall`);
      assert(key.rect.w >= 20, `${key.id} is ${key.rect.w} wide`);
    }
    // No two keys overlap.
    for (const [index, a] of keys.entries()) {
      for (const b of keys.slice(index + 1)) {
        const apart = a.rect.x + a.rect.w <= b.rect.x ||
          b.rect.x + b.rect.w <= a.rect.x ||
          a.rect.y + a.rect.h <= b.rect.y || b.rect.y + b.rect.h <= a.rect.y;
        assert(apart, `${a.id} and ${b.id} overlap`);
      }
    }
    const bar = layout.byId.get("chatbar")!;
    const top = Math.min(...keys.map((key) => key.rect.y));
    assert(bar.rect.y + bar.rect.h <= top);
    inside(screen as typeof PORTRAIT, bar);
    // The keyboard replaces the touch controls while chat is open.
    assertEquals(layout.byId.has("stick:move"), false);
  });
}

Deno.test("the keyboard keys are at least 36 CSS pixels tall in portrait at every scale", () => {
  for (const scale of [1, 1.5, 2]) {
    const layout = layoutUi(view(PORTRAIT, {
      scale,
      chat: { open: true, draft: "", page: "symbols", shift: false },
    }));
    for (const key of layout.elements.filter((el) => el.kind === "key")) {
      assert(key.rect.h >= 36, `${key.id}@${scale}`);
    }
  }
});

Deno.test("hit testing finds the topmost element and honors round shapes", () => {
  const layout = layoutUi(view(PORTRAIT, {
    bag: { open: true, stacks: STACKS, selected: 0, held: "pickaxe" },
  }));
  const slot = layout.byId.get("slot:coal")!;
  const hit = hitTest(layout, slot.rect.x + 5, slot.rect.y + 5);
  assertEquals(hit?.id, "slot:coal");
  // The panel background takes a pointer without acting, so nothing under it fires.
  const panel = layout.byId.get("panel:bag")!;
  assertEquals(
    hitTest(layout, panel.rect.x + 2, panel.rect.y + panel.rect.h - 2)?.kind,
    "panel",
  );
  const plain = layoutUi(view(PORTRAIT));
  const interact = plain.byId.get("btn:interact")!;
  assertEquals(hitTest(plain, interact.cx!, interact.cy!)?.id, "btn:interact");
  // The square action button takes corner presses too.
  assertEquals(
    hitTest(plain, interact.rect.x + 1, interact.rect.y + 1)?.id,
    "btn:interact",
  );
  const move = plain.byId.get("stick:move")!;
  assertEquals(hitTest(plain, move.cx!, move.cy!)?.id, "stick:move");
  assertEquals(hitTest(plain, 195, 300), null);
});

Deno.test("a menu or loading screen takes every pointer", () => {
  const menu = layoutUi(view(PORTRAIT, {
    menu: {
      open: true,
      page: "root",
      scale: 1,
      textSize: "medium",
      sizes: ["small", "medium", "large"],
      mode: "touch",
    },
  }));
  assertEquals(hitTest(menu, 20, 400)?.id, "scrim:menu");
  const resume = menu.byId.get("btn:resume")!;
  assertEquals(
    hitTest(menu, resume.rect.x + 4, resume.rect.y + 4)?.id,
    "btn:resume",
  );
  const loading = layoutUi(
    view(PORTRAIT, { loading: "Connecting to world..." }),
  );
  const interact = loading.byId.get("btn:interact")!;
  assertEquals(hitTest(loading, interact.cx!, interact.cy!)?.id, "loading");
});

Deno.test("the layout scales with the UI scale setting", () => {
  const one = layoutUi(view(LANDSCAPE, { scale: 1, held: "pickaxe" }));
  const two = layoutUi(view(LANDSCAPE, { scale: 2, held: "pickaxe" }));
  assert(
    two.byId.get("icon:held")!.rect.w > one.byId.get("icon:held")!.rect.w,
  );
  assert(two.ts > one.ts);
  // Controls grow as far as the screen has room, and no further.
  assert(
    two.byId.get("btn:interact")!.rect.w >=
      one.byId.get("btn:interact")!.rect.w,
  );
});

Deno.test("text uses a whole number of device pixels per font pixel", () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    const layout = layoutUi(view(PORTRAIT, { dpr, scale: 1.25 }));
    const device = layout.ts * dpr;
    assertEquals(
      Math.abs(device - Math.round(device)) < 1e-9,
      true,
      `dpr ${dpr}`,
    );
  }
});

Deno.test("a stick snaps to eight directions with a dead zone", () => {
  assertEquals(stickVector(3, 3, 140).x, 0);
  assertEquals(stickVector(3, 3, 140).y, 0);
  const east = stickVector(40, 0, 140);
  assertEquals([east.x, east.y], [1, 0]);
  const north = stickVector(0, -50, 140);
  assertEquals([north.x, north.y], [0, -1]);
  const southWest = stickVector(-40, 40, 140);
  assertEquals([southWest.x, southWest.y], [-1, 1]);
  // The knob stays inside 30% of the diameter.
  const far = stickVector(200, 0, 140);
  assertEquals(far.knobX, 42);
});

Deno.test("typing stops at the chat limit, and shift is one-shot", () => {
  let state = { draft: "", shift: false };
  state = typeKey(state.draft, "h", true);
  assertEquals(state, { draft: "H", shift: false });
  state = typeKey(state.draft, "i", state.shift);
  assertEquals(state.draft, "Hi");
  state = typeKey(state.draft, "space", false);
  state = typeKey(state.draft, "1", false);
  assertEquals(state.draft, "Hi 1");
  state = typeKey(state.draft, "backspace", false);
  assertEquals(state.draft, "Hi ");
  // A digit keeps shift for the next letter.
  assertEquals(typeKey("", "1", true).shift, true);
  const full = "x".repeat(CHAT_LIMIT);
  assertEquals(typeKey(full, "y", false).draft, full);
  assertEquals(typeKey(full, "backspace", false).draft.length, CHAT_LIMIT - 1);
  assertEquals(typeKey("", "backspace", false).draft, "");
  // A named key that is not a character adds nothing.
  assertEquals(typeKey("a", "send", false).draft, "a");
});

Deno.test("text wraps on spaces and splits long words", () => {
  assertEquals(wrapText("hello big world", 9), ["hello big", "world"]);
  assertEquals(wrapText("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assertEquals(wrapText("a\nb", 10), ["a", "b"]);
  assertEquals(ascii("Sold coal ×3 – 3 coins…"), "Sold coal x3 - 3 coins...");
});

Deno.test("the log keeps to its capacity and scrolls from the end", () => {
  const lines = Array.from({ length: 40 }, (_, index) => ({
    kind: "chat" as const,
    speaker: "Ada",
    text: `message number ${index}`,
  }));
  const bottom = layoutUi(
    view(PORTRAIT, { log: { open: true, lines, scroll: 0 } }),
  );
  const shown = bottom.elements.filter((el) => el.kind === "line");
  assertEquals(shown.length, bottom.logList!.capacity);
  assertEquals(shown.at(-1)!.text?.includes("39"), true);
  const scrolled = layoutUi(
    view(PORTRAIT, { log: { open: true, lines, scroll: 5 } }),
  );
  assertEquals(
    scrolled.elements.filter((el) => el.kind === "line").at(-1)!.text?.includes(
      "34",
    ),
    true,
  );
  const clamped = layoutUi(
    view(PORTRAIT, { log: { open: true, lines, scroll: 9999 } }),
  );
  assertEquals(
    clamped.logList!.scroll,
    clamped.logList!.total - clamped.logList!.capacity,
  );
});

/** A router over a layout, recording what it did. */
function router(v: UiView) {
  const events: string[] = [];
  const layout = layoutUi(v);
  const r = createPointerRouter({
    layout: () => layout,
    onAction: (el) => events.push(`act:${el.id}`),
    onRelease: (el) => events.push(`release:${el.id}`),
    onStick: (id, s) => events.push(`stick:${id}:${s.x},${s.y}:${s.active}`),
    onScroll: (list, pixels) => events.push(`scroll:${list}:${pixels}`),
  });
  return { r, layout, events };
}

Deno.test("buttons act on pointer down, and several fingers work at once", () => {
  const { r, layout, events } = router(view(PORTRAIT));
  const move = layout.byId.get("stick:move")!;
  const interact = layout.byId.get("btn:interact")!;
  // One finger holds the move stick; a second taps interact while it is down.
  assertEquals(r.down({ id: 1, x: move.cx! + 50, y: move.cy! }), "ui");
  assertEquals(r.down({ id: 2, x: interact.cx!, y: interact.cy! }), "ui");
  assertEquals(events, ["stick:stick:move:0,0:true", "act:btn:interact"]);
  assertEquals(r.pressed().has("btn:interact"), true);
  r.up({ id: 2, x: 0, y: 0 });
  r.up({ id: 1, x: 0, y: 0 });
  assertEquals(events.at(-1), "stick:stick:move:0,0:false");
  assertEquals(r.pressed().size, 0);
});

Deno.test("a stick follows one pointer", () => {
  const { r, layout, events } = router(view(PORTRAIT));
  const look = layout.byId.get("stick:move")!;
  r.down({ id: 1, x: look.cx!, y: look.cy! - 50 });
  r.down({ id: 2, x: look.cx! + 50, y: look.cy! });
  assertEquals(events.length, 1);
  r.move({ id: 1, x: look.cx! + 50, y: look.cy! - 50 });
  assertEquals(events.at(-1), "stick:stick:move:1,0:true");
  // The second pointer never moves the stick.
  r.move({ id: 2, x: look.cx! - 50, y: look.cy! });
  assertEquals(events.at(-1), "stick:stick:move:1,0:true");
});

Deno.test("a pointer on empty space belongs to the world", () => {
  const { r, layout } = router(view(PORTRAIT));
  assertEquals(r.down({ id: 1, x: 195, y: 300 }), "world");
  assertEquals(r.has(1), false);
  // A panel hides the world below it: a pinch cannot start there.
  const open = router(view(PORTRAIT, {
    bag: { open: true, stacks: STACKS, selected: 0, held: "pickaxe" },
  }));
  const panel = open.layout.byId.get("panel:bag")!;
  assertEquals(
    open.r.down({
      id: 1,
      x: panel.rect.x + 3,
      y: panel.rect.y + panel.rect.h - 3,
    }),
    "ui",
  );
  void layout;
});

Deno.test("a row in a scrolling list taps on release and scrolls on drag", () => {
  const { r, layout, events } = router(view(PORTRAIT, {
    shop: { ...ITEMS_PANEL, rows: ROWS, selected: "coal", scroll: 0 },
  }));
  const row = layout.byId.get("row:coal")!;
  const x = row.rect.x + 20;
  const y = row.rect.y + 10;
  r.down({ id: 1, x, y });
  assertEquals(events, []);
  r.up({ id: 1, x, y });
  assertEquals(events, ["act:row:coal"]);
  events.length = 0;
  r.down({ id: 2, x, y });
  r.move({ id: 2, x, y: y - 30 });
  r.up({ id: 2, x, y: y - 30 });
  assertEquals(events, ["scroll:shop:30"]);
  // A cancelled pointer never acts.
  events.length = 0;
  r.down({ id: 3, x, y });
  r.up({ id: 3, x, y }, true);
  assertEquals(events, []);
});

Deno.test("fullscreen acts on release, over the button", () => {
  const { r, layout, events } = router(view(PORTRAIT, { fullscreen: true }));
  const button = layout.byId.get("btn:fullscreen")!;
  r.down({ id: 1, x: button.cx!, y: button.cy! });
  assertEquals(events, []);
  r.up({ id: 1, x: button.cx!, y: button.cy! });
  assertEquals(events, ["act:btn:fullscreen"]);
});

Deno.test("keyboard keys act on pointer down and show pressed", () => {
  const { r, layout, events } = router(view(PORTRAIT, {
    chat: { open: true, draft: "", page: "letters", shift: false },
  }));
  const h = layout.byId.get("key:h")!;
  const e = layout.byId.get("key:e")!;
  r.down({ id: 1, x: h.rect.x + 4, y: h.rect.y + 4 });
  r.down({ id: 2, x: e.rect.x + 4, y: e.rect.y + 4 });
  assertEquals(events, ["act:key:h", "act:key:e"]);
  assertEquals([...r.pressed()].sort(), ["key:e", "key:h"]);
  r.up({ id: 1, x: 0, y: 0 });
  assertEquals(events.at(-1), "release:key:h");
});

Deno.test("the item list rows read Sell all [ore] with count and total coins", () => {
  const layout = layoutUi(view(PORTRAIT, {
    shop: { ...ITEMS_PANEL, rows: ROWS, selected: "coal", scroll: 0 },
  }));
  const coal = layout.byId.get("row:coal")!;
  assertEquals(coal.text, "Sell all coal");
  assertEquals([coal.sub2, coal.sub], [
    `x${STACKS[2].count}`,
    `${STACKS[2].count} coins`,
  ]);
  assertEquals(layout.byId.get("row:all")!.text, "Sell all ore");
});

Deno.test("the action pointer retains its origin outside bounds, independently of movement", () => {
  const layout = layoutUi(view(PORTRAIT));
  const events:
    import("../../src/shared/single-plane.js").ActionPointerEvent[] = [];
  const sticks: boolean[] = [];
  const ordinary: string[] = [];
  const r = createPointerRouter({
    layout: () => layout,
    onAction: (el) => ordinary.push(el.id),
    onRelease: (el) => ordinary.push(el.id),
    onInteract: (event) => events.push(event),
    onStick: (_id, state) => sticks.push(state.active),
    onScroll: () => {},
  });
  const move = layout.byId.get("stick:move")!;
  const action = layout.byId.get("btn:interact")!;
  const x = action.cx!, y = action.cy!;
  r.down({ id: 1, x: move.cx! + 40, y: move.cy! });
  r.down({ id: 2, x, y });
  r.down({ id: 3, x, y }); // A second finger cannot steal the action gesture.
  r.move({ id: 3, x: 0, y: 0 });
  r.up({ id: 3, x: 0, y: 0 });
  r.move({ id: 2, x: -50, y: -80 });
  r.up({ id: 2, x: -50, y: -80 });
  assertEquals(events, [
    { phase: "press", x, y, originX: x, originY: y },
    { phase: "move", x: -50, y: -80, originX: x, originY: y },
    { phase: "release", x: -50, y: -80, originX: x, originY: y },
  ]);
  assertEquals(sticks, [true]);
  assertEquals(ordinary, []);
  assert(r.pressed().has("stick:move"));
  r.down({ id: 4, x, y });
  r.releaseAll();
  assertEquals(events.at(-1)?.phase, "cancel");
  assertEquals(events.at(-1)?.originX, x);
  assertEquals(sticks, [true, false]);
});

Deno.test("small portrait regions stay low and use world arrows instead of an aim well", () => {
  const screen = {
    width: 320,
    height: 568,
    safe: { top: 24, right: 0, bottom: 24, left: 0 },
  };
  const gesture = {
    down: true,
    aiming: true,
    everAimed: true,
    x: 0,
    y: -1,
    originX: 0,
    originY: 0,
    knobX: 0,
    knobY: -20,
  };
  for (const scale of [1, 1.5, 2]) {
    const layout = layoutUi(
      view(screen, { scale, held: "coin", actionGesture: gesture }),
    );
    for (
      const id of [
        "stick:move",
        "btn:interact",
        "btn:chat",
        "btn:bag",
        "btn:sprint",
        "btn:menu",
      ]
    ) inside(screen, layout.byId.get(id)!);
    const action = layout.byId.get("btn:interact")!;
    assertEquals(action.item, "coin");
    assert(action.rect.w >= 72);
    assert(layout.byId.get("stick:move")!.rect.y > screen.height * 0.45);
    assertEquals(layout.byId.has("action:well"), false);
    assertEquals(layoutUi(view(screen)).byId.has("action:well"), false);
  }
});

Deno.test("floating movement keeps the touch origin, clamps outside, and resets on cancel", () => {
  const layout = layoutUi(view(PORTRAIT));
  const element = layout.byId.get("stick:move")!;
  const states: {
    x: number;
    y: number;
    knobX: number;
    knobY: number;
    active: boolean;
    originX?: number;
    originY?: number;
  }[] = [];
  const r = createPointerRouter({
    layout: () => layout,
    onAction: () => {},
    onStick: (_id, state) => states.push(state),
    onScroll: () => {},
  });
  const x = element.rect.x + 8, y = element.rect.y + 8;
  r.down({ id: 1, x, y });
  assertEquals(states.at(-1), {
    x: 0,
    y: 0,
    knobX: 0,
    knobY: 0,
    active: true,
    originX: x,
    originY: y,
  });
  r.move({ id: 1, x: x + 1000, y: y - 1000 });
  const moved = states.at(-1)!;
  assertEquals([moved.x, moved.y, moved.originX, moved.originY], [1, -1, x, y]);
  assert(
    Math.abs(Math.hypot(moved.knobX, moved.knobY) - element.r! * 0.6) < 0.001,
  );
  assert(r.has(1));
  r.releaseAll();
  assertEquals(states.at(-1)!.active, false);
  const x2 = element.rect.x + element.rect.w - 8;
  r.down({ id: 2, x: x2, y });
  assertEquals(states.at(-1)!.originX, x2);
  assertEquals(states.at(-1)!.x, 0);
});

Deno.test("priority buttons own touches over movement and the full action panel is active", () => {
  const { r, layout, events } = router(view(PORTRAIT));
  const chat = layout.byId.get("btn:chat")!;
  r.down({ id: 1, x: chat.cx!, y: chat.cy! });
  assertEquals(events, ["act:btn:chat"]);
  for (const id of ["btn:sprint", "btn:bag"]) {
    const button = layout.byId.get(id)!;
    assertEquals(hitTest(layout, button.cx!, button.cy!)?.id, id);
  }
  const action = layout.byId.get("btn:interact")!.rect;
  for (const x of [action.x + 1, action.x + action.w - 1]) {
    for (const y of [action.y + 1, action.y + action.h - 1]) {
      assertEquals(hitTest(layout, x, y)?.id, "btn:interact");
    }
  }
});

Deno.test("an open pickup grid keeps the touch regions below its world cells", () => {
  const screen = { width: 844, height: 390, safe: undefined };
  const ordinary = layoutUi(view(screen));
  const pickup = layoutUi(view(screen, { pickupOpen: true }));
  for (const id of ["stick:move", "btn:interact"]) {
    assert(pickup.byId.get(id)!.rect.y > ordinary.byId.get(id)!.rect.y);
    assert(pickup.byId.get(id)!.rect.y > screen.height / 2 + 120);
  }
  assertEquals(hitTest(pickup, screen.width / 2, screen.height / 2 + 64), null);
});
