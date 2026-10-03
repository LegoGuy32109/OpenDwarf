import { expect, type Page } from "@playwright/test";

/** A rectangle in CSS pixels, as the UI layer lays it out. */
export type UiRect = { x: number; y: number; w: number; h: number };

type UiHook = {
  __od: {
    ui: {
      rect(id: string): UiRect | null;
      ids(): string[];
      layout(): { ts: number; safeRect: UiRect };
      state: {
        logOpen: boolean;
        logScroll: number;
        joinOpen: boolean;
        qrReady: boolean;
        diagnosticsOpen: boolean;
        diagnostics: string;
        chatPage: string;
        chatShift: boolean;
        sticks: Record<
          "move" | "look",
          { active: boolean; x: number; y: number; dir: string }
        >;
        sessions: { status: string; stats: string; items: { id: string }[] };
      };
    };
    scene: Record<string, unknown>;
    openChat(prefill?: string): void;
  };
};

/** Wait until the game has loaded its textures and can draw the world. */
export async function ready(page: Page, timeout = 15_000) {
  await expect(page.locator("#world")).toHaveAttribute("data-ready", "true", {
    timeout,
  });
}

/** The rectangle of a UI element. It waits for the element to exist. */
export async function uiRect(page: Page, id: string): Promise<UiRect> {
  await expect.poll(
    () =>
      page.evaluate(
        (id) => (globalThis as unknown as UiHook).__od.ui.rect(id),
        id,
      ),
    { message: `UI element ${id}`, timeout: 15_000 },
  ).not.toBeNull();
  return (await page.evaluate(
    (id) => (globalThis as unknown as UiHook).__od.ui.rect(id),
    id,
  ))!;
}

/** Whether a UI element exists in the current layout. */
export function hasUi(page: Page, id: string) {
  return page.evaluate(
    (id) => (globalThis as unknown as UiHook).__od.ui.rect(id) !== null,
    id,
  );
}

/** The UI layer's state, as the harness exposes it. */
export function uiState(page: Page) {
  return page.evaluate(() => {
    const { state } = (globalThis as unknown as UiHook).__od.ui;
    return JSON.parse(JSON.stringify(state)) as UiHook["__od"]["ui"]["state"];
  });
}

/** The center of an element's rectangle. */
export async function uiCenter(page: Page, id: string, dy = 0) {
  const rect = await uiRect(page, id);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 + dy };
}

/** Tap an element with a finger. */
export async function tapUi(page: Page, id: string) {
  const { x, y } = await uiCenter(page, id);
  await page.touchscreen.tap(x, y);
}

/** Click an element with the mouse. */
export async function clickUi(page: Page, id: string) {
  const { x, y } = await uiCenter(page, id);
  await page.mouse.click(x, y);
}

/** Wait for the in-game keyboard or the chat line to show or hide. */
export async function expectChat(page: Page, open: boolean) {
  await expect.poll(() => hasUi(page, "chatbar")).toBe(open);
}

/** Open chat, type a line on a physical keyboard, and send it with Enter. */
export async function say(page: Page, text: string) {
  await page.keyboard.press("t");
  await expectChat(page, true);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expectChat(page, false);
}

/** The text of the chat line. */
export function chatDraft(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as UiHook).__od.scene.chatDraft as string
  );
}

/** The scene's status line and any notice. */
export function statusText(page: Page) {
  return page.evaluate(() => {
    const scene = (globalThis as unknown as UiHook).__od.scene as {
      status: string;
      displayStatus: string;
      notice?: { text: string };
    };
    return `${scene.notice?.text ?? ""}|${scene.status}|${scene.displayStatus}`;
  });
}

/** The direction a stick points: "center", or "x,y". */
export async function stickDirection(page: Page, stick: "move" | "look") {
  return (await uiState(page)).sticks[stick].dir;
}

/** Tap the keys of the in-game keyboard for lowercase letters and spaces. */
export async function tapKeys(page: Page, text: string) {
  for (const char of text) {
    await tapUi(page, char === " " ? "key:space" : `key:${char}`);
  }
}

/** The network line of the /host world list. */
export async function sessionStats(page: Page) {
  return (await uiState(page)).sessions.stats;
}

/** The address the host's join QR code loads from. */
export function qrUrl(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as {
      __od: { ui: { qrUrl(): string } };
    }).__od.ui.qrUrl()
  );
}

/** The hearing log lines the panel shows now, oldest first. */
export function logLines(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as {
      __od: {
        ui: { layout(): { elements: { kind: string; text?: string }[] } };
      };
    }).__od.ui.layout().elements.filter((el) => el.kind === "line").map((el) =>
      el.text ?? ""
    )
  );
}

/** The extra status text at the top right. */
export function displayStatus(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as {
      __od: { scene: { displayStatus: string } };
    }).__od.scene.displayStatus
  );
}

/** The inventory slots the panel shows, with the selected and held ones. */
export function slots(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as {
      __od: {
        ui: {
          layout(): {
            elements: {
              kind: string;
              item?: string;
              on?: boolean;
              held?: boolean;
            }[];
          };
        };
      };
    }).__od.ui.layout().elements.filter((el) => el.kind === "slot").map((
      el,
    ) => ({
      kind: el.item ?? "",
      selected: Boolean(el.on),
      held: Boolean(el.held),
    }))
  );
}

/** The kind of the selected inventory slot. */
export async function selectedSlot(page: Page) {
  return (await slots(page)).find((slot) => slot.selected)?.kind;
}

/** The kind of the held inventory slot. */
export async function heldSlot(page: Page) {
  return (await slots(page)).find((slot) => slot.held)?.kind;
}

/** A row of the shop panel, or null while the panel does not show it. */
export function shopRow(page: Page, name: string) {
  return page.evaluate((name) => {
    const element = (globalThis as unknown as {
      __od: {
        ui: {
          layout(): {
            byId: Map<
              string,
              {
                text?: string;
                sub?: string;
                sub2?: string;
                on?: boolean;
                dim?: boolean;
              }
            >;
          };
        };
      };
    }).__od.ui.layout().byId.get(`row:${name}`);
    return element
      ? {
        text: element.text ?? "",
        price: element.sub ?? "",
        count: element.sub2 ?? "",
        selected: Boolean(element.on),
        dim: Boolean(element.dim),
      }
      : null;
  }, name);
}

/** Whether the shop panel is on screen. */
export function shopOpen(page: Page) {
  return hasUi(page, "panel:shop");
}

/**
 * The sprint state: stamina from 0 to 1, pressed, and locked. On a touch
 * screen it reads the sprint button's look; elsewhere, the stamina itself.
 */
export function sprintState(page: Page) {
  return page.evaluate(() => {
    const od = (globalThis as unknown as {
      __od: {
        stamina: { value: number; sprint: boolean; locked: boolean };
        ui: {
          layout(): {
            byId: Map<
              string,
              { fill?: number; on?: boolean; locked?: boolean }
            >;
          };
        };
      };
    }).__od;
    const element = od.ui.layout().byId.get("btn:sprint");
    return element
      ? {
        stamina: element.fill ?? -1,
        on: Boolean(element.on),
        locked: Boolean(element.locked),
      }
      : {
        stamina: od.stamina.value,
        on: od.stamina.sprint,
        locked: od.stamina.locked,
      };
  });
}
