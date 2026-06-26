/// <reference lib="dom" />

export type ViewMode = "entity" | "free";

type InputControllerArgs = {
  viewModeRef: { current: ViewMode };
  onViewModeChange?: (mode: ViewMode) => void;
};

export function createInputController(args: InputControllerArgs) {
  const handleKeyDown = (event: KeyboardEvent) => {
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
