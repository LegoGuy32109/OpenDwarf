import { assert, assertEquals } from "@std/assert";
import { encodeIncoming } from "../../src/shared/signal-frame.js";
import { PROTOCOL_VERSION } from "../../src/shared/wire.js";
import type { joinWorld as JoinWorld } from "../../src/client/network-guest.js";

type Scene = Parameters<typeof JoinWorld>[0];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(_url: string) {
    sockets.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
type Step = "remote" | "answer" | "local";
class FakePeer {
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: unknown }) => void) | null = null;
  closed = false;
  calls: Step[] = [];
  gate = peerGates.shift();
  constructor(_config: RTCConfiguration) {
    peers.push(this);
  }
  async step(step: Step) {
    this.calls.push(step);
    if (this.gate?.step === step) await this.gate.wait.promise;
  }
  async setRemoteDescription(_description: RTCSessionDescriptionInit) {
    await this.step("remote");
  }
  async createAnswer() {
    await this.step("answer");
    return { type: "answer" as const, sdp: "answer" };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    await this.step("local");
    this.localDescription = description;
  }
  close() {
    this.closed = true;
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }
}
const sockets: FakeSocket[] = [];
const peers: FakePeer[] = [];
const peerGates: { step: Step; wait: ReturnType<typeof deferred<void>> }[] = [];
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "location", {
  configurable: true,
  value: {
    href: "http://guest.test/?harness=1",
    origin: "http://guest.test",
    search: "?harness=1",
  },
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});
Object.assign(globalThis, {
  WebSocket: FakeSocket,
  RTCPeerConnection: FakePeer,
});
const { joinWorld } = await import("../../src/client/network-guest.js");

/** Drain promise work without advancing the retry/watchdog timers. */
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await Promise.resolve();
  }
  assert(check(), "pending promise work did not settle");
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
async function fixture() {
  sockets.length = peers.length = peerGates.length = 0;
  storage.clear();
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  const fetchBefore = globalThis.fetch, errorBefore = console.error;
  const errors: unknown[] = [];
  console.error = (error) => errors.push(error);
  globalThis.fetch = (_input) => {
    if (String(_input).endsWith("/ice")) {
      const request = deferred<Response>();
      requests.push(request);
      return request.promise;
    }
    return Promise.resolve(
      Response.json({ signalUrl: "ws://signal.test", channel: "channel" }),
    );
  };
  let cancellations = 0;
  const scene = {
    world: { tick: 0, players: {}, chunks: new Map() },
    status: "",
    cancelAction: () => cancellations++,
  } as unknown as Scene;
  const guest = joinWorld(scene, "session-test");
  await until(() => sockets.length === 1);
  const socket = sockets[0];
  socket.open();
  await flush();
  const attempt = () =>
    JSON.parse(
      socket.sent.filter((s) => JSON.parse(s).p.kind === "join").at(-1)!,
    ).p.data.attempt as string;
  const offer = (value = attempt()) =>
    socket.onmessage?.({
      data: encodeIncoming("channel", "host", null, {
        id: crypto.randomUUID(),
        kind: "offer",
        data: {
          attempt: value,
          version: PROTOCOL_VERSION,
          description: { type: "offer", sdp: "offer" },
        },
      }),
    });
  const accept = (index: number) =>
    requests[index].resolve(Response.json({ iceServers: [] }));
  return {
    scene,
    guest,
    socket,
    requests,
    attempt,
    offer,
    accept,
    errors,
    cancellations: () => cancellations,
    close() {
      guest.close();
      globalThis.fetch = fetchBefore;
      console.error = errorBefore;
    },
  };
}

Deno.test("obsolete attempt ICE rejection cannot cancel the new attempt", async () => {
  const f = await fixture();
  try {
    const attemptA = f.attempt();
    f.offer();
    f.socket.onmessage?.({
      data: JSON.stringify({ t: "u", m: { o: "peer_connected" }, p: "host" }),
    });
    assert(f.attempt() !== attemptA);
    f.offer();
    f.accept(1);
    await until(() => peers.length === 1);
    await flush();
    const before = f.cancellations(), status = f.scene.status;
    f.requests[0].reject(new Error("obsolete ICE failure"));
    await flush();
    assertEquals(f.cancellations(), before);
    assertEquals(f.scene.status, status);
    assertEquals(f.errors, []);
    assertEquals(peers[0].closed, false);
  } finally {
    f.close();
  }
});
Deno.test("obsolete ICE success cannot replace a newer peer, even for duplicate offers in one attempt", async () => {
  const f = await fixture();
  try {
    f.offer();
    f.offer();
    f.accept(1);
    await until(() => peers.length === 1);
    await flush();
    f.accept(0);
    await flush();
    assertEquals(peers.length, 1);
    assertEquals(peers[0].closed, false);
    assertEquals(
      f.socket.sent.filter((s) => JSON.parse(s).p.kind === "answer").length,
      1,
    );
  } finally {
    f.close();
  }
});
for (const step of ["remote", "answer", "local"] as const) {
  Deno.test(`superseded same-attempt ${step} failure cannot cancel the replacement peer`, async () => {
    const f = await fixture();
    try {
      const wait = deferred<void>();
      peerGates.push({ step, wait });
      f.offer();
      f.accept(0);
      await until(() => peers[0]?.calls.includes(step) ?? false);
      f.offer();
      f.accept(1);
      await until(() => peers.length === 2);
      await flush();
      const before = f.cancellations(), status = f.scene.status;
      wait.reject(new Error(`obsolete ${step} failure`));
      await flush();
      assertEquals(f.cancellations(), before);
      assertEquals(f.scene.status, status);
      assertEquals(f.errors, []);
      assertEquals(peers[1].closed, false);
      assertEquals(
        f.socket.sent.filter((s) => JSON.parse(s).p.kind === "answer").length,
        1,
      );
    } finally {
      f.close();
    }
  });
}
Deno.test("current ICE failure still cancels the action and schedules retry", async () => {
  const f = await fixture();
  try {
    f.offer();
    const before = f.cancellations();
    f.requests[0].reject(new Error("current ICE failure"));
    await flush();
    assertEquals(f.cancellations(), before + 1);
    assertEquals(f.scene.status, "Visitor disconnected; retrying…");
    assertEquals(f.errors.length, 1);
  } finally {
    f.close();
  }
});
Deno.test("closing the guest invalidates an unresolved offer failure", async () => {
  const f = await fixture();
  try {
    f.offer();
    f.guest.close();
    const before = f.cancellations(), status = f.scene.status;
    f.requests[0].reject(new Error("closed ICE failure"));
    await flush();
    assertEquals(f.cancellations(), before);
    assertEquals(f.scene.status, status);
    assertEquals(f.errors, []);
  } finally {
    f.close();
  }
});

Deno.test("current peer negotiation failure still cancels and retries", async () => {
  const f = await fixture();
  try {
    const wait = deferred<void>();
    peerGates.push({ step: "remote", wait });
    f.offer();
    f.accept(0);
    await until(() => peers[0]?.calls.includes("remote") ?? false);
    const before = f.cancellations();
    wait.reject(new Error("current peer failure"));
    await flush();
    assertEquals(f.cancellations(), before + 1);
    assertEquals(f.scene.status, "Visitor disconnected; retrying…");
    assertEquals(f.errors.length, 1);
  } finally {
    f.close();
  }
});
Deno.test("superseded peer success stops before later negotiation operations", async () => {
  const f = await fixture();
  try {
    const wait = deferred<void>();
    peerGates.push({ step: "remote", wait });
    f.offer();
    f.accept(0);
    await until(() => peers[0]?.calls.includes("remote") ?? false);
    f.offer();
    f.accept(1);
    await until(() => peers.length === 2);
    await flush();
    wait.resolve();
    await flush();
    assertEquals(peers[0].calls, ["remote"]);
    assertEquals(peers[1].closed, false);
    assertEquals(
      f.socket.sent.filter((s) => JSON.parse(s).p.kind === "answer").length,
      1,
    );
    assertEquals(f.errors, []);
  } finally {
    f.close();
  }
});
