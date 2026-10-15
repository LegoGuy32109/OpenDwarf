// @ts-check

// Dynamic import lets the HTML terminal describe the module-graph wait.
import("../../src/client/app.js").then(({ startApp }) => startApp()).catch(
  (error) => {
    /** @type {{__odBootError?:(error:unknown)=>void}} */ (globalThis)
      .__odBootError?.(error);
    console.error(error);
  },
);
