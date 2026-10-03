import { assertEquals, assertThrows } from "@std/assert";
import { createRelay, type RelaySocket } from "../../src/server/relay.ts";
import {
  encodeSignal,
  MAX_FRAME_BYTES,
  readOutgoing,
  readPeerConnected,
  readSignal,
} from "../../src/shared/signal-frame.js";

const GUEST = `peer-${crypto.randomUUID()}`;
const OTHER = `peer-${crypto.randomUUID()}`;

function socket() {
  const sent: string[] = [];
  let closed = false;
  const fake: RelaySocket = {
    send: (data) => void sent.push(data),
    close: () => void (closed = true),
  };
  return { fake, sent, isClosed: () => closed };
}

function signals(sent: string[]) {
  return sent.map(readSignal).filter((signal) => signal !== null);
}

function setup() {
  const relay = createRelay();
  relay.createChannel("local/s1");
  const host = socket();
  const guest = socket();
  const other = socket();
  const hostConn = relay.connect(
    relay.issueToken("local/s1", "host"),
    host.fake,
  )!;
  const guestConn = relay.connect(
    relay.issueToken("local/s1", GUEST),
    guest.fake,
  )!;
  const otherConn = relay.connect(
    relay.issueToken("local/s1", OTHER),
    other.fake,
  )!;
  return { relay, host, guest, other, hostConn, guestConn, otherConn };
}

Deno.test("a directed message reaches only its target, stamped with the sender", () => {
  const { host, guest, other, guestConn } = setup();
  const sent = encodeSignal("x", GUEST, "host", {
    id: "1",
    from: "host", // a spoofed sender is ignored
    kind: "join",
    data: { n: 1 },
  });
  assertEquals(guestConn.receive(sent), 1);
  assertEquals(signals(host.sent), [
    { id: "1", from: GUEST, kind: "join", data: { n: 1 } },
  ]);
  assertEquals(signals(guest.sent), []);
  assertEquals(signals(other.sent), []);
});

Deno.test("a message without a target reaches every other peer, not the sender", () => {
  const { host, guest, other, hostConn } = setup();
  const frame = JSON.stringify({
    t: "u",
    m: { o: "message" },
    p: { id: "2", from: "host", kind: "leave", data: {} },
  });
  assertEquals(hostConn.receive(frame), 2);
  assertEquals(signals(guest.sent).length, 1);
  assertEquals(signals(other.sent).length, 1);
  assertEquals(signals(host.sent), []);
});

Deno.test("a peer receives the peers frames when it connects", () => {
  const { host } = setup();
  const kinds = host.sent.map((raw) => JSON.parse(raw).m.o);
  // Its own arrival, the peer list, then each peer that connected after it.
  assertEquals(kinds, [
    "peer_connected",
    "peers",
    "peer_connected",
    "peer_connected",
  ]);
  assertEquals(
    host.sent.slice(2).map((raw) => readPeerConnected(raw)),
    [GUEST, OTHER],
  );
  assertEquals(signals(host.sent), []);
});

Deno.test("frames that are not messages, too large, or malformed are dropped", () => {
  const { guestConn } = setup();
  assertEquals(guestConn.receive("not json"), 0);
  assertEquals(guestConn.receive(JSON.stringify({ t: "x" })), 0);
  assertEquals(
    guestConn.receive(JSON.stringify({ t: "u", m: { o: "peers" }, p: {} })),
    0,
  );
  assertEquals(
    guestConn.receive(
      JSON.stringify({ t: "u", m: { o: "message", t: "nobody" }, p: {} }),
    ),
    0,
  );
  const huge = encodeSignal("x", GUEST, "host", {
    id: "3",
    from: GUEST,
    kind: "offer",
    data: "x".repeat(MAX_FRAME_BYTES),
  });
  assertEquals(readOutgoing(huge), null);
  assertEquals(guestConn.receive(huge), 0);
  assertEquals(guestConn.receive(new Uint8Array(4)), 0);
});

Deno.test("a message to an absent peer is dropped", () => {
  const relay = createRelay();
  relay.createChannel("local/s2");
  const only = socket();
  const conn = relay.connect(relay.issueToken("local/s2", GUEST), only.fake)!;
  assertEquals(
    conn.receive(encodeSignal("x", GUEST, "host", {
      id: "4",
      from: GUEST,
      kind: "join",
      data: {},
    })),
    0,
  );
});

Deno.test("an unknown or expired token cannot connect", () => {
  let time = 1000;
  const relay = createRelay({ now: () => time, tokenTtlMs: 60_000 });
  relay.createChannel("local/s3");
  assertEquals(relay.connect("missing", socket().fake), null);
  const token = relay.issueToken("local/s3", GUEST);
  time += 60_001;
  assertEquals(relay.connect(token, socket().fake), null);
  const fresh = relay.issueToken("local/s3", GUEST);
  assertEquals(relay.connect(fresh, socket().fake) !== null, true);
});

Deno.test("a token cannot be issued for an invalid peer", () => {
  const relay = createRelay();
  relay.createChannel("local/s4");
  assertThrows(() => relay.issueToken("local/s4", "someone"));
});

Deno.test("a reconnect replaces the old socket and the old close changes nothing", () => {
  const { relay, host, guest, guestConn } = setup();
  const replacement = socket();
  relay.connect(relay.issueToken("local/s1", GUEST), replacement.fake);
  assertEquals(guest.isClosed(), true);
  guestConn.disconnect(); // the replaced socket closing
  const hostSend = encodeSignal("x", "host", GUEST, {
    id: "5",
    from: "host",
    kind: "offer",
    data: {},
  });
  const hostConn = relay.connect(
    relay.issueToken("local/s1", "host"),
    socket().fake,
  )!;
  assertEquals(hostConn.receive(hostSend), 1);
  assertEquals(signals(replacement.sent).length, 1);
  assertEquals(host.isClosed(), true);
});

Deno.test("deleting a channel closes its sockets and voids its tokens", () => {
  const { relay, host, guest } = setup();
  const token = relay.issueToken("local/s1", GUEST);
  relay.deleteChannel("local/s1");
  assertEquals(host.isClosed() && guest.isClosed(), true);
  assertEquals(relay.hasChannel("local/s1"), false);
  assertEquals(relay.connect(token, socket().fake), null);
});
