// @ts-check
/** @type {WeakMap<object,symbol>} */
const owners = new WeakMap();

/** Bind transport cancellation to this guest session; obsolete callbacks do nothing.
 * @param {object} scene
 */
export function bindActionCancellation(scene) {
  const owner = Symbol("guest actions");
  owners.set(scene, owner);
  return () => {
    if (owners.get(scene) !== owner) return;
    /** @type {{cancelAction?:()=>void}} */ (scene).cancelAction?.();
  };
}
