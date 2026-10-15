// @ts-check

/** @typedef {"world"|"graphics"|"frame"} StartupStage */
/** @typedef {{report:(stage:StartupStage,detail?:string)=>void,complete:()=>void}} LoadingScreen */

/** The HTML screen exists before the application's module graph loads. */
function screen() {
  return /** @type {{__odLoading?:LoadingScreen}} */ (globalThis).__odLoading;
}

/** @param {StartupStage} stage @param {string} [detail] */
export function reportStartup(stage, detail) {
  screen()?.report(stage, detail);
}

/** Called after the first world frame has been submitted to WebGL. */
export function completeStartup() {
  screen()?.complete();
}

/** Asset failures must reach the HTML screen even after the frame loop starts.
 * @param {unknown} error
 */
export function failStartup(error) {
  /** @type {{__odBootError?:(error:unknown)=>void}} */ (globalThis)
    .__odBootError?.(error);
}
