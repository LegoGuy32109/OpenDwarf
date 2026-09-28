import { assertEquals } from "@std/assert";
import { createSnapshotSender } from "../../src/client/snapshot-sender.js";

class Channel extends EventTarget {
  readyState = "open";
  bufferedAmount = 20_000;
  bufferedAmountLowThreshold = 0;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }
}

Deno.test("backed-up snapshots coalesce to the newest state", () => {
  const channel = new Channel();
  let tick = 0;
  const sender = createSnapshotSender(
    channel as unknown as RTCDataChannel,
    () => ({ tick }),
  );
  assertEquals(channel.bufferedAmountLowThreshold, 4096);
  for (tick = 1; tick <= 3; tick++) sender.publish();
  assertEquals(channel.sent, []);

  channel.bufferedAmount = 4096;
  channel.dispatchEvent(new Event("bufferedamountlow"));
  assertEquals(channel.sent, ['{"tick":4}']);
  channel.dispatchEvent(new Event("bufferedamountlow"));
  assertEquals(channel.sent.length, 1);

  sender.close();
  sender.publish();
  assertEquals(channel.sent.length, 1);
  channel.bufferedAmount = 20_000;
  sender.publish();
  channel.bufferedAmount = 0;
  channel.dispatchEvent(new Event("bufferedamountlow"));
  assertEquals(channel.sent.length, 1);
});
