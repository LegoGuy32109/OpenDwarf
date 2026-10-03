// @ts-check

/**
 * The in-game chat: opening and closing it, typing from the in-game keyboard or
 * a physical keyboard, and submitting a message or a slash command (`/nick`,
 * `/entity`, `/master`). The chat draft lives on the `scene`; `ui.js` owns the
 * key layout and `typeKey`.
 */

import { setNickname, submitMessage } from "../shared/world.js";
import { CHAT_LIMIT, typeKey } from "./ui.js";
import { notify, setViewMode, typing } from "./context.js";

/** @typedef {import('./context.js').Context} Context */

/** @param {Context} ctx @param {string} [prefill] */
export function openChat(ctx, prefill = "") {
  const { scene, ui } = ctx;
  ctx.bag.toggle(false);
  ctx.shop.close();
  scene.menu = false;
  scene.menuPage = "root";
  scene.chatOpen = true;
  scene.chatDraft = prefill.slice(0, CHAT_LIMIT);
  ui.chatPage = "letters";
  ui.chatShift = false;
  typing(ctx);
}

/** @param {Context} ctx */
export function closeChat(ctx) {
  stopBackspaceRepeat(ctx);
  ctx.scene.chatOpen = false;
  ctx.scene.chatDraft = "";
  typing(ctx);
}

/** @param {string} before @param {string} name */
function nameChangeLine(before, name) {
  return `${before || "A visitor"} is now ${name}`;
}

/** @param {Context} ctx */
function submitChat(ctx) {
  const { scene } = ctx;
  const text = scene.chatDraft.trim();
  closeChat(ctx);
  if (!text) return;
  if (text.toLowerCase().startsWith("/nick ")) {
    const name = text.slice(6);
    if (ctx.isAdmin) ctx.guest?.send({ type: "nick", name });
    else {
      const before = scene.world.players[scene.localId]?.name ?? "";
      const result = setNickname(scene.world, scene.localId, name);
      if (result.ok && result.name && result.name !== before) {
        ctx.host?.announce(
          nameChangeLine(before, result.name),
          scene.localId,
        );
      }
      notify(
        ctx,
        result.ok
          ? `Name set to ${result.name}`
          : result.reason ?? "Name rejected",
      );
      ctx.host?.publish();
    }
    return;
  }
  if (text.toLowerCase() === "/entity" || text.toLowerCase() === "/master") {
    setViewMode(
      ctx,
      /** @type {"entity"|"master"} */ (text.slice(1).toLowerCase()),
    );
    return;
  }
  if (text.startsWith("/")) {
    notify(ctx, "Unknown command");
    return;
  }
  submitMessage(scene.world, scene.localId, text);
  if (ctx.isAdmin) ctx.guest?.send({ type: "message", text });
  else ctx.host?.publish();
}

/** @param {Context} ctx */
export function stopBackspaceRepeat(ctx) {
  clearTimeout(ctx.backspaceTimer);
  clearInterval(ctx.backspaceTimer);
  ctx.backspaceTimer = undefined;
}

/** @param {Context} ctx @param {string} key a character, "space", or "backspace" */
function typeIntoChat(ctx, key) {
  const next = typeKey(ctx.scene.chatDraft, key, ctx.ui.chatShift);
  ctx.scene.chatDraft = next.draft;
  ctx.ui.chatShift = next.shift;
  typing(ctx);
}

/** A tap on an in-game keyboard key. @param {Context} ctx @param {import('./ui.js').UiElement} element */
export function pressKey(ctx, element) {
  const { ui } = ctx;
  switch (element.key) {
    case "send":
      submitChat(ctx);
      break;
    case "close":
      closeChat(ctx);
      break;
    case "page":
      ui.chatPage = ui.chatPage === "letters" ? "symbols" : "letters";
      break;
    case "shift":
      ui.chatShift = !ui.chatShift;
      break;
    case "backspace":
      typeIntoChat(ctx, "backspace");
      stopBackspaceRepeat(ctx);
      ctx.backspaceTimer = setTimeout(() => {
        ctx.backspaceTimer = setInterval(
          () => typeIntoChat(ctx, "backspace"),
          70,
        );
      }, 400);
      break;
    default:
      if (element.key) typeIntoChat(ctx, element.key);
  }
}

/** A key on a physical keyboard while chat is open. @param {Context} ctx @param {KeyboardEvent} event */
export function chatKey(ctx, event) {
  // Browser shortcuts such as Ctrl+R keep working.
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Enter") submitChat(ctx);
  else if (event.key === "Escape") closeChat(ctx);
  else if (event.key === "Backspace") typeIntoChat(ctx, "backspace");
  else if (event.key.length === 1) typeIntoChat(ctx, event.key);
  else return;
  event.preventDefault();
}
