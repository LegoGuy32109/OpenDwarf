// @ts-check
// What the host does with each message a guest sends: one handler per message
// type. A new guest message adds a handler here and a decoder in the shared
// wire module, and leaves the host's connection code alone.

import { pickUp, pickupLine } from "../shared/items.js";
import { setHeldItem } from "../shared/held-item.js";
import { cancelMining, startMining } from "../shared/mining.js";
import { placeStone } from "../shared/placing.js";
import { setNickname, setTyping, submitMessage } from "../shared/world.js";

/**
 * What a handler may do for one guest. The host's `createPeer` builds it, so a
 * handler reads and changes that guest's state only through these.
 * @typedef {{
 *   scene: import('./network-common.js').Scene,
 *   playerId: string,
 *   lastSequence: number,
 *   mode: "entity"|"master",
 *   sees: () => (tile:{x:number,y:number,z:number}) => boolean,
 *   tell: (id:string, text:string) => void,
 *   announce: (text:string, exceptId?:string) => void,
 *   reply: (message:Record<string,unknown>) => void,
 *   confirmAction: (message:Record<string,unknown>,result:Record<string,unknown>,requestAttempt?:string) => void,
 *   channel: () => RTCDataChannel|null,
 *   resync: () => void,
 *   setInput: (dx:number, dy:number, sequence:number, sprint:boolean) => void,
 *   queueMove: (move:{dx:number,dy:number,sequence:number}) => void,
 *   cancelMoves: (sequence:number) => void,
 *   setMode: (mode:"entity"|"master") => void,
 *   publishToPeer: () => void,
 * }} HostPeer
 */

/** The tile a message names. @param {Record<string,unknown>} message */
function tileOf(message) {
  return {
    x: Number(message.x),
    y: Number(message.y),
    z: Number(message.z),
  };
}

/**
 * A handler returns true when it needs no world publish afterward, and nothing
 * when the host should publish.
 * @type {Map<string,(peer:HostPeer, message:Record<string,unknown>) => boolean|void>}
 */
export const hostMessages = new Map([
  ["resync", (peer) => {
    // A rejected packet may have held a reveal; send the whole copy again.
    peer.resync();
    return true;
  }],
  ["ping", (peer, message) => {
    peer.reply({ type: "pong", id: message.id });
    return true;
  }],
  ["input", (peer, message) => {
    const dx = Number(message.dx);
    const dy = Number(message.dy);
    const sequence = Number(message.sequence);
    if (
      Number.isSafeInteger(sequence) && sequence >= peer.lastSequence &&
      Number.isInteger(dx) && Number.isInteger(dy) &&
      Math.abs(dx) <= 1 && Math.abs(dy) <= 1
    ) {
      peer.setInput(dx, dy, sequence, message.sprint === true);
    }
    return true;
  }],
  ["mine", (peer, message) => {
    const result = startMining(
      peer.scene.world,
      peer.playerId,
      tileOf(message),
      peer.sees(),
    );
    if (!result.ok) peer.reply({ type: "mine-result", reason: result.reason });
    return true;
  }],
  ["place", (peer, message) => {
    const result = placeStone(
      peer.scene.world,
      peer.playerId,
      tileOf(message),
      peer.sees(),
    );
    peer.confirmAction(message, result);
    if (!result.ok) {
      peer.reply({ type: "place-result", reason: result.reason });
    }
    return true;
  }],
  ["mine-cancel", (peer) => {
    cancelMining(peer.scene.world, peer.playerId);
    return true;
  }],
  ["hold", (peer, message) => {
    // The host checks the inventory; a refused choice changes nothing.
    setHeldItem(peer.scene.world, peer.playerId, String(message.kind));
    return true;
  }],
  ["pickup", (peer, message) => {
    const result = pickUp(
      peer.scene.world,
      peer.playerId,
      tileOf(message),
      message.kind,
    );
    peer.confirmAction(message, result);
    if (result.ok) {
      peer.tell(peer.playerId, pickupLine(result.kind, result.count));
    } else peer.reply({ type: "pickup-result", reason: result.reason });
    return true;
  }],
  ["move", (peer, message) => {
    // Only the latest direction is useful while a previous step is finishing.
    // A queued step must not run after the visitor has turned elsewhere.
    peer.queueMove({
      dx: Number(message.dx),
      dy: Number(message.dy),
      sequence: Number(message.sequence),
    });
    return true;
  }],
  ["cancel", (peer, message) => {
    const sequence = Number(message.sequence);
    if (Number.isSafeInteger(sequence) && sequence >= peer.lastSequence) {
      peer.cancelMoves(sequence);
    }
    return true;
  }],
  ["mode", (peer, message) => {
    if (message.mode === "entity" || message.mode === "master") {
      if (peer.mode !== message.mode) peer.setMode(message.mode);
      peer.publishToPeer();
    }
    return true;
  }],
  ["typing", (peer, message) => {
    setTyping(peer.scene.world, peer.playerId, message.typing === true);
  }],
  ["message", (peer, message) => {
    submitMessage(peer.scene.world, peer.playerId, String(message.text));
  }],
  ["nick", (peer, message) => {
    const before = peer.scene.world.players[peer.playerId]?.name ?? "";
    const result = setNickname(
      peer.scene.world,
      peer.playerId,
      String(message.name),
    );
    if (result.ok && result.name !== before) {
      peer.announce(`${before || "A visitor"} is now ${result.name}`);
    }
    peer.channel()?.send(JSON.stringify({ type: "nick-result", result }));
  }],
]);
