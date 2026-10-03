import { assertEquals, assertRejects } from "@std/assert";
import { createSignaling } from "../../src/client/signaling.js";
import { encodeIncoming, readSignal } from "../../src/shared/signal-frame.js";

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) {}
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
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function setup(onPeer?: (peer: string) => void) {
  const sockets: FakeSocket[] = [];
  let tokens = 0;
  const received: unknown[] = [];
  const signaling = createSignaling({
    self: "host",
    credentials: () =>
      Promise.resolve({
        channel: "c/s",
        signalUrl: `ws://shell/v2/token-${++tokens}`,
      }),
    receive: (signal) => received.push(signal),
    onPeer,
    socket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { signaling, sockets, received, tokens: () => tokens };
}

Deno.test("a signal sent before the socket opens goes out when it does", async () => {
  const { signaling, sockets } = setup();
  await tick();
  const sent = signaling.send("peer-x", "offer", { a: 1 });
  sockets[0].open();
  await sent;
  assertEquals(sockets[0].sent.length, 1);
  assertEquals(JSON.parse(sockets[0].sent[0]).m, {
    f: "c/s/host",
    o: "message",
    t: "peer-x",
  });
  signaling.close();
});

Deno.test("a lost socket reconnects with a new token", async () => {
  const { signaling, sockets, tokens } = setup();
  await tick();
  sockets[0].open();
  sockets[0].close();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assertEquals(sockets.length, 2);
  assertEquals(sockets[0].url, "ws://shell/v2/token-1");
  assertEquals(sockets[1].url, "ws://shell/v2/token-2");
  assertEquals(tokens(), 2);
  sockets[1].open();
  await signaling.send("peer-x", "answer", {});
  assertEquals(sockets[1].sent.length, 1);
  signaling.close();
});

Deno.test("received signals are read once and other frames are ignored", async () => {
  const { signaling, sockets, received } = setup();
  await tick();
  sockets[0].open();
  const peer = `peer-${crypto.randomUUID()}`;
  const frame = encodeIncoming("c/s", peer, "host", {
    id: "1",
    from: "nobody",
    kind: "join",
    data: {},
  });
  sockets[0].onmessage?.({ data: frame });
  sockets[0].onmessage?.({ data: frame });
  sockets[0].onmessage?.({
    data: JSON.stringify({ t: "u", m: { o: "peers" }, p: { users: [] } }),
  });
  assertEquals(received, [{ id: "1", from: peer, kind: "join", data: {} }]);
  assertEquals(readSignal("garbage"), null);
  signaling.close();
});

Deno.test("send rejects after close", async () => {
  const { signaling } = setup();
  signaling.close();
  await assertRejects(() => signaling.send("host", "x", {}));
});

Deno.test("a peer_connected frame reaches onPeer and is not a signal", async () => {
  const peers: string[] = [];
  const { signaling, sockets, received } = setup((peer) => peers.push(peer));
  await tick();
  sockets[0].open();
  sockets[0].onmessage?.({
    data: JSON.stringify({ t: "u", m: { o: "peer_connected" }, p: "host" }),
  });
  assertEquals(peers, ["host"]);
  assertEquals(received, []);
  signaling.close();
});
