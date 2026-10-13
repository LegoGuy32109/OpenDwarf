import type { TestWorld } from "./world.ts";
import { readWorld } from "./world.ts";
import { expect } from "./fixtures.ts";
import { type Page } from "@playwright/test";
/** A rectangle in CSS pixels, as the UI layer lays it out. */
export type UiRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};
/** Wait until the game has loaded its textures and can draw the world. */
export async function ready(page: Page) {
  await expect(page.locator("#world")).toHaveAttribute("data-ready", "true");
}
/** The rectangle of a UI element. It waits for the element to exist. */
export async function uiRect(page: Page, id: string): Promise<UiRect> {
  await expect.poll(
    () => readWorld(page, (__world, id) => __world.ui.rect(id), id),
    { message: `UI element ${id}` },
  ).not.toBeNull();
  return (await readWorld(page, (__world, id) => __world.ui.rect(id), id))!;
}
/** Whether a UI element exists in the current layout. */
export function hasUi(page: Page, id: string) {
  return readWorld(page, (__world, id) => __world.ui.rect(id) !== null, id);
}
/** The UI layer's state, as the harness exposes it. */
export function uiState(page: Page) {
  return readWorld(page, (__world) => {
    const { state } = __world.ui;
    return JSON.parse(JSON.stringify(state)) as TestWorld["ui"]["state"];
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
  return readWorld(page, (__world) => __world.scene.chatDraft as string);
}
/** The scene's status line and any notice. */
export function statusText(page: Page) {
  return readWorld(page, (__world) => {
    const scene = __world.scene as {
      status: string;
      displayStatus: string;
      notice?: {
        text: string;
      };
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
  return readWorld(page, (__world) => __world.ui.qrUrl());
}
/** The hearing log lines the panel shows now, oldest first. */
export function logLines(page: Page) {
  return readWorld(
    page,
    (__world) =>
      __world.ui.layout().elements.filter((el) => el.kind === "line").map((
        el,
      ) => el.text ?? ""),
  );
}
/** The extra status text at the top right. */
export function displayStatus(page: Page) {
  return readWorld(page, (__world) => __world.scene.displayStatus);
}
/** The inventory slots the panel shows, with the selected and held ones. */
export function slots(page: Page) {
  return readWorld(
    page,
    (__world) =>
      __world.ui.layout().elements.filter((el) => el.kind === "slot").map((
        el,
      ) => ({
        kind: el.item ?? "",
        selected: Boolean(el.on),
        held: Boolean(el.held),
      })),
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
  return readWorld(page, (__world, name) => {
    const element = __world.ui.layout().byId.get(`row:${name}`);
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
  return readWorld(page, (__world) => {
    const od = __world;
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
