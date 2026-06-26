/// <reference lib="dom" />

export type ViewMode = "entity" | "free";

type InputControllerArgs = {
  viewModeRef: { current: ViewMode };
  fullscreenTarget?: HTMLElement | null;
  onViewModeChange?: (mode: ViewMode) => void;
};

export function createInputController(args: InputControllerArgs) {
  const toggleFullscreen = async () => {
    const shell = args.fullscreenTarget;
    if (!shell) {
      return;
    }
    if (document.fullscreenElement === shell) {
      await document.exitFullscreen();
    } else {
      await shell.requestFullscreen();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "F11") {
      event.preventDefault();
      void toggleFullscreen();
      return;
    }
    if (
      event.key === "Escape" &&
      document.fullscreenElement === args.fullscreenTarget
    ) {
      event.preventDefault();
      void document.exitFullscreen();
      return;
    }
    if (event.code !== "KeyM") {
      return;
    }
    if (event.repeat) {
      return;
    }
    event.preventDefault();
    const next = args.viewModeRef.current === "entity" ? "free" : "entity";
    args.viewModeRef.current = next;
    args.onViewModeChange?.(next);
    console.info(`[webgl2] view mode: ${next}`);
  };

  window.addEventListener("keydown", handleKeyDown, { passive: false });
  return () => {
    window.removeEventListener("keydown", handleKeyDown);
  };
}
