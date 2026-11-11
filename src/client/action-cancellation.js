// @ts-check
// Features can interrupt input without importing the input coordinator.
/** @type {WeakMap<object,()=>void>} */
const cancellations = new WeakMap();

/** @param {object} context @param {()=>void} cancel */
export function registerActionCancellation(context, cancel) {
  cancellations.set(context, cancel);
}

/** @param {object} context */
export function cancelPendingAction(context) {
  cancellations.get(context)?.();
}
