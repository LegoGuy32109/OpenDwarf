# WebGL Test Artifact Spec

## Purpose

Define a concrete, human-readable artifact model for the WebGL experiment. This
spec is the contract for replay-driven UI review bundles.

The goal is:

- deterministic replays
- named visual checkpoints
- screenshots at meaningful checkpoints
- optional deterministic frame-dump review bundles for motion and flow
- optional stitched review video for fast human inspection
- artifacts that remain understandable without a custom viewer

## Scope

This spec applies to the `/webgl` experiment route and future WebGL renderer
flows.

It does not define:

- game simulation rules
- chunk generation details
- production multiplayer state
- binary optimization formats

## Core Principle

Use one canonical replay and derive the visual artifacts from it.

Order of truth:

1. replay JSON
2. checkpoint manifest JSON
3. screenshot PNGs
4. review frame-dump PNGs
5. optional stitched review video WebM

If the replay changes, all derived artifacts must be regenerable.

## Bundle Layout

Each run exports a single bundle directory:

```text
artifacts/
  <flow_name>/
    <run_id>/
      replay.json
      manifest.json
      frames/
        000_boot.png
        010_texture_loaded.png
      video.webm
      screenshots/
        000_boot.png
        010_texture_loaded.png
        020_camera_entered_chunk_0_0.png
      state/
        000_boot.json
        010_texture_loaded.json
        020_camera_entered_chunk_0_0.json
      notes.md
```

### Naming Rules

- `flow_name` is stable and semantic, for example `webgl-step1-single-rock`.
- `run_id` should be sortable and unique, for example
  `2026-05-11T15-34-12Z__a1b2c3d4`.
- checkpoint file names should include an ordinal and a semantic label.
- filenames must not depend on wall clock order beyond the run id.

## Replay JSON

`replay.json` is the canonical input log and execution recipe.

Example shape:

```json
{
  "version": 1,
  "flow": "webgl-step3-camera-aabb",
  "scene": "webgl-step1-single-rock",
  "seed": "rocks-aabb-v1",
  "viewport": {
    "width": 1920,
    "height": 1080,
    "devicePixelRatio": 2
  },
  "capture": {
    "fullscreenRequired": true,
    "video": true,
    "screenshots": true
  },
  "events": [
    { "tick": 0, "type": "boot" },
    { "tick": 1, "type": "fullscreen", "active": true },
    { "tick": 2, "type": "resize", "width": 1920, "height": 1080, "dpr": 2 },
    {
      "tick": 4,
      "type": "key_down",
      "code": "KeyE",
      "key": "e",
      "repeat": false
    },
    { "tick": 12, "type": "key_up", "code": "KeyE", "key": "e" }
  ],
  "checkpoints": [
    { "tick": 1, "name": "fullscreen_entered", "screenshot": true },
    { "tick": 10, "name": "texture_loaded", "screenshot": true }
  ]
}
```

### Event Rules

- `key_down` and `key_up` are physical browser key events normalized at record
  time.
- `resize` records CSS size and device pixel ratio.
- `fullscreen` records fullscreen entry/exit as a test event.
- `boot` is the first semantic event of a run.
- additional event types can be added later, but existing fields should remain
  stable.

## Checkpoint Manifest

`manifest.json` is the human-readable index of all derived artifacts in the run.

Example shape:

```json
{
  "version": 1,
  "flow": "webgl-step3-camera-aabb",
  "runId": "2026-05-11T15-34-12Z__a1b2c3d4",
  "createdAt": "2026-05-11T15:34:12.000Z",
  "browser": {
    "name": "Chrome",
    "version": "unknown",
    "userAgent": "..."
  },
  "renderer": {
    "webgl2": true,
    "vendor": "Google Inc.",
    "renderer": "ANGLE ..."
  },
  "checkpoints": [
    {
      "name": "boot",
      "tick": 0,
      "frame": 0,
      "stateHash": "sha256:...",
      "screenshot": "screenshots/000_boot.png",
      "state": "state/000_boot.json"
    }
  ]
}
```

### Checkpoint Rules

- checkpoint names are semantic, not frame numbers
- checkpoints can be screenshot-only, state-only, or both
- screenshot checkpoints should be tied to a stable frame after state settling
- the manifest should point at every exported artifact

## State Snapshots

`state/<checkpoint>.json` is a compact, human-readable snapshot of the
render-relevant state.

Required fields:

- `tick`
- `camera`
- `fullscreen`
- `viewport`
- `visibleChunks`
- `streamingChunks`
- `residentChunks`
- `assetsLoaded`
- `uiMode`
- `sceneHash`

Example:

```json
{
  "tick": 10,
  "camera": { "x": 512, "y": 384, "zoom": 1 },
  "fullscreen": true,
  "viewport": { "width": 1920, "height": 1080, "dpr": 2 },
  "visibleChunks": ["0,0", "1,0", "0,1", "1,1"],
  "streamingChunks": ["-1,0", "0,0", "1,0", "-1,1", "0,1", "1,1"],
  "residentChunks": 6,
  "assetsLoaded": ["SingleRock.png"],
  "uiMode": "world",
  "sceneHash": "sha256:..."
}
```

The state snapshot is intended for human debugging and diff review. It is not a
full simulation dump.

## Screenshots

Screenshots are the primary human review artifact.

Rules:

- capture screenshots at semantic checkpoints
- use PNG format
- name screenshots by checkpoint ordinal and semantic label
- screenshots should always be paired with a replay and checkpoint manifest
- pixel diffs are optional and deferred for later automation work

## Optional Baseline Source

The repository does not need a checked-in screenshot source of truth for the
current step1 experiment.

Recommended baseline shape:

```json
{
  "version": 1,
  "flow": "webgl-step1-single-rock",
  "screenshots": {
    "boot": {
      "path": "baselines/webgl-step1-single-rock/boot.png",
      "sha256": "sha256:..."
    },
    "single_rock_loaded": {
      "path": "baselines/webgl-step1-single-rock/single_rock_loaded.png"
    }
  }
}
```

Rules:

- baselines are optional for local runs
- capture/export should still work when no baseline manifest is configured
- when a baseline is configured, the harness may report whether a checkpoint has
  a matching reference
- the baseline manifest should stay human-readable and flow-specific

## Review Frames

The review flow may use a deterministic frame-dump sequence for fast human
inspection.

Rules:

- frame dumps are generated from the same replay used for screenshots
- frame dumps should be PNG files
- frame dumps should be deterministic enough for human review, not
  pixel-equality
- frame dumps are optional when the flow is being used only for quick visual
  sanity checks

## Review Video

Video is a convenience artifact for human review.

Rules:

- video is optional
- if present, it should be derived from the same replay or frame-dump sequence
- missing video should not fail a review run
- video should help a human confirm that a batch of scenario steps still looks
  plausible without running the entire game
- prefer a fixed capture cadence or stable semantic checkpoints
- the frame dump does not replace screenshot diffs

Optional derived artifact:

- a review video can be stitched from the frame dump after the run
- that stitch step may happen in CI or locally, but it is not the canonical
  source of truth
- if a review video exists, it should be treated as convenience output only

Recommended capture method:

- browser-side PNG capture from the renderer or checkpoint screenshots
- fallback to a browser-side video stitch only when the frame-dump path is not
  available

If a flow has only a few checkpoints, the frame dump should still capture the
full sequence from boot to completion so motion regressions are visible.

## Browser Capture API

The browser route should expose a test harness object on `window`.

Suggested shape:

```ts
interface WebGlTestHarness {
  loadFlow(flow: ReplayFlow): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<ReplayBundle>;
  captureCheckpoint(name: string): Promise<void>;
  exportReplay(): ReplayDocument;
  importReplay(doc: ReplayDocument): Promise<void>;
  exportScreenshot(name: string): Promise<Blob>;
  exportVideo(): Promise<Blob>;
}
```

This object should be stable enough for scripted browser automation and manual
debug use.

## Run Lifecycle

1. load the flow
2. initialize the scene
3. record the replay
4. step the deterministic simulation
5. emit checkpoints
6. capture screenshots
7. record a review frame dump
8. export the bundle

The exported bundle should be usable both in CI and from a local browser run.

## CLI Review Contract

The review flow should be callable from a command line runner that drives a
headless browser and writes a deterministic artifact bundle.

Suggested invocation:

```text
deno task webgl:review -- --flow webgl-step1-single-rock-review --out-dir exports/webgl-step1-single-rock-review
```

Expected outputs:

- `replay.json`
- `manifest.json`
- `screenshots/*.png`
- `state/*.json`
- `frames/*.png`
- optional `review.webm` if a stitching step is enabled

The review runner may use checkpoint screenshots as the frame-dump sequence.
That is sufficient for step1 and keeps the review path deterministic even when
browser video encoding is not.

For CI and headless command-line runs, the review browser should use a fixed
viewport instead of relying on fullscreen APIs. Fullscreen remains the
interactive-user contract for the live `/webgl` route.

## Human Readability Rules

- keep JSON pretty-printed
- keep checkpoint names semantic
- keep state snapshots short
- keep notes in plain text or markdown
- avoid opaque binary as the primary debug format
- if a reviewer cannot infer what happened from filenames and JSON, the artifact
  is too dense

## Future Binary Layer

Binary formats are allowed later, but only as an optimization layer under the
human-readable contract.

Recommended split:

- JSON for replay metadata and checkpoint manifests
- PNG for screenshots
- PNG for review frames
- WebM only as a derived review convenience artifact
- compact binary for heavy payloads only when the JSON workflow is stable

## CI Expectations

A CI run should be able to:

1. execute a replay flow
2. export the replay bundle
3. compare screenshots against baselines
4. fail on screenshot diff or replay-state mismatch
5. attach the frame dump as a review artifact
6. optionally attach a stitched video if one was generated

CI should not require a human to reconstruct the run from logs alone.

## First Flow Targets

The first stable flows should be:

- `webgl-step1-single-rock`
- `webgl-step1-single-rock-review`
- `webgl-step2-stacked-atlas`
- `webgl-step3-camera-aabb`

These flows should cover:

- fullscreen
- DPR-native sizing
- texture loading
- screenshot baselines
- replay export/import
- frame-dump review export
- viewport AABB correctness
