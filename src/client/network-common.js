// @ts-check

// What the host and the guest share: test-only delivery conditions, the shell's
// signaling calls, and the types of a scene.

import { build } from "./build.js";

// Test-only game-message delivery conditions; ICE and physical packets are unchanged.
export const harnessParams = new URL(location.href).searchParams;
const harnessDelay = harnessParams.has("harness")
  ? Math.max(0, Math.min(500, Number(harnessParams.get("delay")) || 0))
  : 0;
const harnessJitter = harnessParams.has("harness")
  ? Math.max(0, Math.min(200, Number(harnessParams.get("jitter")) || 0))
  : 0;
const harnessLoss = harnessParams.has("harness")
  ? Math.max(0, Math.min(0.2, Number(harnessParams.get("loss")) || 0))
  : 0;
export const motionHz =
  harnessParams.has("harness") && harnessParams.get("motionHz") === "20"
    ? 20
    : 10;
let randomState = (Number(harnessParams.get("seed")) || 1) >>> 0;
function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

/** @param {()=>void} receive @param {boolean} [replaceable] */
export function deliver(receive, replaceable = false) {
  if (replaceable && harnessLoss && random() < harnessLoss) return;
  const delay = harnessDelay +
    (harnessJitter ? (random() * 2 - 1) * harnessJitter : 0);
  if (delay > 0) setTimeout(receive, delay);
  else receive();
}

/** @typedef {import('../shared/world.js').World} World */
/** @typedef {{at:number,entries:import('../shared/mining.js').MiningEntry[]}} MineFeed */
/** @typedef {import('../shared/items.js').DroppedEntry} DroppedEntry */
/** @typedef {import('../shared/items.js').Stack} Stack */
/** @typedef {{world:World,localId:string,layout?:"room"|"test",status:string,mineFeed?:MineFeed,itemFeed?:DroppedEntry[],inventoryFeed?:Stack[],heldFeed?:string,notice?:{text:string,until:number},viewMode:"entity"|"master",visibility:import('../shared/visibility.js').Visibility,presentation:ReturnType<typeof import('./presentation.js').createPresentation>,chatFeed:import('../shared/chat.js').DisplayChatRecord[],systemLine?:(text:string)=>void,hearSounds?:(list:import('../shared/sound.js').HeardSound[])=>void,followMusic?:(cue:{key:string,hash:string},offsetSeconds:number)=>void,renderOffset:{x:number,y:number,z:number},metrics?:{joinMs:number|null,rttMs:number[],route:string},telemetry?:(kind:"connection"|"error",fields?:Record<string,unknown>)=>void}} Scene */
/** @typedef {import('../shared/signal-frame.js').Signal} Signal */

/**
 * Ask the shell for a credentials ticket: a signaling address with a fresh token.
 * A refusal throws an Error whose `reason` is the shell's error text.
 * @param {string} path @param {Record<string,unknown>} body
 * @returns {Promise<{signalUrl:string,channel:string,hostKey?:string,build?:unknown}>}
 */
export async function ticket(path, body) {
  // The shell supplies the HTTP(S) API origin through build configuration, not peer messages.
  // fallow-ignore-next-line security-sink
  const response = await fetch(build.apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // The shell names why it refused, such as "session ended".
    const reason = await response.json().then(
      (value) => typeof value?.error === "string" ? value.error : "",
      () => "",
    );
    const error = new Error(`Signaling unavailable: ${response.status}`);
    throw Object.assign(error, { reason });
  }
  return await response.json();
}

/** Fresh ICE servers for a session; TURN credentials expire quickly. @param {string} session */
export async function ice(session) {
  // The shell supplies the HTTP(S) API origin through build configuration, not peer messages.
  // fallow-ignore-next-line security-sink
  const response = await fetch(build.apiUrl(`sessions/${session}/ice`));
  if (!response.ok) throw new Error("ICE configuration unavailable");
  const data = await response.json();
  return /** @type {RTCIceServer[]} */ (data.iceServers);
}

/** Report ICE candidate types without exposing addresses. */
/** @param {RTCPeerConnection} peer */
export async function selectedRoute(peer) {
  const stats = await peer.getStats();
  const transport = [...stats.values()].find((stat) =>
    stat.type === "transport" && "selectedCandidatePairId" in stat
  );
  const pairId = transport && "selectedCandidatePairId" in transport
    ? String(transport.selectedCandidatePairId)
    : "";
  const pair = stats.get(pairId);
  if (
    !pair || !("localCandidateId" in pair) ||
    !("remoteCandidateId" in pair)
  ) return "connecting";
  const local = stats.get(String(pair.localCandidateId));
  const remote = stats.get(String(pair.remoteCandidateId));
  const localType = local && "candidateType" in local
    ? String(local.candidateType)
    : "?";
  const remoteType = remote && "candidateType" in remote
    ? String(remote.candidateType)
    : "?";
  return `${localType}/${remoteType}`;
}

/** @param {RTCPeerConnection} peer */
export function gathered(peer) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (peer.iceGatheringState === "complete") {
        peer.removeEventListener("icegatheringstatechange", done);
        resolve(undefined);
      }
    };
    peer.addEventListener("icegatheringstatechange", done);
    setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", done);
      resolve(undefined);
    }, 4000);
  });
}
