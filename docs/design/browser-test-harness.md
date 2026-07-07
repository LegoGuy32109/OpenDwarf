# Browser Test Harness

**Status:** Draft design note — 2026-07-07  
**Parent:** `GAME_ENGINE_ARCHITECTURE.md` Phase 4+ browser validation

## Goal

The browser harness is a versioned, test-only seam around the `/engine` runtime.
It should validate browser-specific integration without becoming an arbitrary
debug backdoor into Rust internals.

The harness exists to:

- Drive the game through the same browser paths users exercise.
- Observe stable, intentional runtime snapshots.
- Produce replayable artifacts for regressions.

Deep game logic remains tested below this layer in native Rust or wasm
integration tests. Browser tests cover DOM input, hidden text input, focus,
canvas sizing, WebGL draw submission, persistence, workers, network glue, and
runtime orchestration.

## Activation

Expose the harness only when explicitly requested, for example:

```text
/engine?harness=1
```

The global entrypoint should be versioned:

```ts
globalThis.__openDwarfEngineHarness = {
  version: 1,
  // ...
};
```

Production route loads should not expose the harness.

## Ideal Complete Shape

```ts
type EngineHarness = {
  version: 1;

  boot(config?: unknown): Promise<void>;
  stepFrame(n?: number): Promise<void>;
  stepSimTick(n?: number): Promise<void>;
  flush(): Promise<void>;

  input: {
    keyDown(code: string, modifiers?: Modifiers): Promise<void>;
    keyUp(code: string, modifiers?: Modifiers): Promise<void>;
    press(code: string, modifiers?: Modifiers): Promise<void>;
    typeText(text: string): Promise<void>;
    paste(text: string): Promise<void>;
    blur(): Promise<void>;
    focus(): Promise<void>;
    pointerMove(x: number, y: number): Promise<void>;
    pointerDown(button?: number): Promise<void>;
    pointerUp(button?: number): Promise<void>;
    wheel(delta: number): Promise<void>;
  };

  snapshot(): EngineSnapshot;
  captureCheckpoint(name: string): Promise<EngineCheckpoint>;
  exportReplay(): EngineReplay;
  importReplay(replay: EngineReplay): Promise<void>;
  reset(config?: unknown): Promise<void>;
};
```

Input helpers should prefer dispatching real DOM events to the canvas or hidden
input, not directly mutating wasm memory. Otherwise browser tests can pass while
the actual browser input path is broken.

For Phase 4 chat, `typeText("abc")` should exercise the real path:

```text
KeyboardEvent / beforeinput
  -> hidden input
  -> Text arena events
  -> Rust text editor
  -> session model
```

## Snapshot Contract

Snapshots are structured, stable diagnostics. They should expose intentional
state useful to tests, not raw private Rust structures.

Phase 4 useful shape:

```ts
type EngineSnapshot = {
  frame: {
    number: number;
    drawCount: number;
    droppedRects: number;
    droppedGlyphs: number;
    droppedDrawCmds: number;
  };
  shell: {
    open: boolean;
    page: "root" | "settings";
  };
  session: {
    uiMode: "world" | "chat";
    chatDraft: string;
    chatCaret: number;
    chatMessages: string[];
  };
  input: {
    canvasFocused: boolean;
    textCaptureActive: boolean;
    hiddenInputFocused: boolean;
  };
  render: {
    framebufferWidth: number;
    framebufferHeight: number;
  };
};
```

Later, as the game matures, snapshots can grow to include:

- Scenario or map seed.
- Simulation tick.
- Camera position.
- Selected unit, tool, or order.
- Visible alerts, jobs, and announcements.
- Save/load status.
- Multiplayer connection state.
- Performance counters.
- Deterministic state hashes.

## Test Architecture

A complete browser Dwarf-Fortress-like game should use four complementary test
layers:

- **Native Rust tests:** world sim, pathfinding, jobs, inventory, combat,
  persistence, text editing, and router security.
- **Wasm/engine integration tests:** ABI layout, input arena decode, render
  command generation, and deterministic frame outputs.
- **Browser harness tests:** real DOM input, focus, text capture, WebGL draw
  loop, localStorage, worker startup, resize/DPR, and network mocks.
- **Golden/replay tests:** load scenario, replay input log, capture state hash,
  screenshots, and performance windows.

## Phase 4 Minimal Slice

For Phase 4, build only the smallest useful slice:

- Enable with `?harness=1`.
- Expose `version`.
- Expose `input.press`, `input.typeText`, and `input.paste`.
- Expose `stepFrame`.
- Expose `snapshot`.

Defer `captureCheckpoint`, replay import/export, pointer helpers, worker
controls, and golden artifact capture until the runtime has stable state worth
recording.
