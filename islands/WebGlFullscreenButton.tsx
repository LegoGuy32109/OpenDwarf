import { useCallback } from "preact/hooks";

export default function WebGlFullscreenButton() {
  const toggle = useCallback(async () => {
    const shell = document.querySelector(
      ".webgl-experiment-shell",
    ) as HTMLElement | null;
    if (!shell) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await shell.requestFullscreen();
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      class="inline-flex items-center gap-2 bg-white/5 px-3 py-1 text-sm font-medium uppercase tracking-[0.18em] text-white/80 transition hover:bg-white/10 hover:text-white"
    >
      F11 for Fullscreen
    </button>
  );
}
