// @ts-check

const HIGH_WATER = 16 * 1024;
const LOW_WATER = 4 * 1024;

/** Keep only the newest unsent snapshot while the data channel drains. */
/** @param {RTCDataChannel} channel @param {()=>unknown} snapshot @param {(sample:{bytes:number,encodeMs:number,sendMs:number})=>void} [onSend] */
export function createSnapshotSender(channel, snapshot, onSend) {
  let pending = false;
  let closed = false;
  channel.bufferedAmountLowThreshold = LOW_WATER;

  function publish() {
    if (closed || channel.readyState !== "open") return;
    if (channel.bufferedAmount > HIGH_WATER) {
      pending = true;
      return;
    }
    pending = false;
    const value = snapshot();
    const began = performance.now();
    const encoded = JSON.stringify(value);
    const encodedAt = performance.now();
    channel.send(encoded);
    onSend?.({
      bytes: encoded.length,
      encodeMs: encodedAt - began,
      sendMs: performance.now() - encodedAt,
    });
  }

  function onBufferedAmountLow() {
    if (pending) publish();
  }
  channel.addEventListener("bufferedamountlow", onBufferedAmountLow);
  return {
    publish,
    close() {
      closed = true;
      pending = false;
      channel.removeEventListener("bufferedamountlow", onBufferedAmountLow);
    },
  };
}
