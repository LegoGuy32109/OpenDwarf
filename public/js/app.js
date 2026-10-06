// @ts-check
import { startApp } from "../../src/client/app.js";

/** The boot-error screen in index.html reports a failure until this mark. */
startApp().then(() => {
  document.documentElement.dataset.booted = "true";
}).catch((error) => {
  /** @type {{__odBootError?:(error:unknown)=>void}} */ (globalThis)
    .__odBootError?.(error);
  console.error(error);
});
