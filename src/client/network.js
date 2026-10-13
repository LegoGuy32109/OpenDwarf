// @ts-check
// The network entry the client imports. The host and the guest live in their
// own files so a change to one does not touch the other.

export { startHost } from "./network-host.js";
export { joinWorld } from "./network-guest.js";

/** @typedef {import('./network-common.js').Scene} Scene */
/** @typedef {import('./network-common.js').MineFeed} MineFeed */
