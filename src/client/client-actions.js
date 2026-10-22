// @ts-check
// Actions shared by client features and the startup adapters.

import { setTyping } from "../shared/world.js";
import { setHeldItem } from "../shared/held-item.js";
/** @typedef {import("./client-context.js").Context} Context */

/** @param {Context} ctx @param {string} text */
export function notify(ctx, text) {
  ctx.scene.status = text;
}

/** A short message that shows over the status line. @param {Context} ctx @param {string} text */
export function flash(ctx, text) {
  ctx.scene.notice = { text, until: performance.now() + 2500 };
}

/** Tell the world whether the local player is typing: the chat draft or the open bag. @param {Context} ctx */
export function typing(ctx) {
  const { scene } = ctx;
  const value = scene.chatDraft.trim();
  const next = ctx.bag.isOpen || ctx.shop.isOpen() ||
    scene.chatOpen && value.length > 0 && !value.startsWith("/");
  if (next === ctx.lastTyping) return;
  ctx.lastTyping = next;
  if (ctx.simulation) {
    ctx.simulation.enqueue(scene.localId, { type: "typing", typing: next });
  } else setTyping(scene.world, scene.localId, next);
  if (ctx.isAdmin) ctx.guest?.send({ type: "typing", typing: next });
  else ctx.host?.publish();
}

/** @param {Context} ctx @param {"entity"|"master"} mode */
export function setViewMode(ctx, mode) {
  if (ctx.isAdmin) {
    if (ctx.guest?.setMode(mode)) notify(ctx, `Switching to ${mode} view…`);
    return;
  }
  ctx.scene.viewMode = mode;
  notify(ctx, `${mode === "master" ? "Master" : "Entity"} view`);
}

/** Choose the held item. The host checks the inventory and cancels mining. @param {Context} ctx @param {string} kind */
export function holdItem(ctx, kind) {
  const { scene } = ctx;
  if (ctx.isAdmin) {
    ctx.guest?.send({ type: "hold", kind });
    return;
  }
  if (ctx.simulation) {
    ctx.simulation.enqueue(scene.localId, { type: "hold", kind }, (result) => {
      if (!result.ok) flash(ctx, `Cannot hold: ${result.reason}`);
      else ctx.host?.publish();
    });
    return;
  }
  const result = setHeldItem(scene.world, scene.localId, kind);
  if (!result.ok) flash(ctx, `Cannot hold: ${result.reason}`);
  else ctx.host?.publish();
}

/**
 * Ask an NPC to be spoken to: the world host speaks the player's line and
 * queues the NPC's reply. The host checks the NPC, the range, and that no
 * earlier request still waits. A sale choice names the ore to sell; the host
 * sells at once, and an accepted sale returns the seller's private line.
 * @param {Context} ctx @param {string} npc @param {string} choice
 * @param {import('../shared/shop.js').SpokenSale} [sale]
 */
export function talkRequest(ctx, npc, choice, sale) {
  const { scene } = ctx;
  const message = { type: "talk", npc, choice, ...(sale ? { sale } : {}) };
  if (ctx.isAdmin) {
    ctx.guest?.send(message);
    return;
  }
  ctx.simulation?.enqueue(scene.localId, message, (result) => {
    if (!result.ok) flash(ctx, String(result.reason));
    else if (typeof result.line === "string") {
      scene.systemLine(result.line);
      ctx.sfx.play(["sell"]);
    }
  });
}
