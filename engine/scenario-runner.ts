/**
 * Browser Scenario runner — lowers Session/Shell/Input/World to harness APIs.
 * Engine steps remain fail-closed in browser.
 */

import {
  type InputActionJson,
  type KeymapProfile,
  resolveKeymapProfile,
  type RunScenarioResult,
  type ScenarioDocument,
  type ScenarioStep,
  type SessionIntentJson,
  type ShellActionJson,
} from "./scenario-types.ts";

export type ScenarioHarnessApi = {
  input: {
    keyDown(code: string, modifiers?: number): Promise<void>;
    keyUp(code: string, modifiers?: number): Promise<void>;
    press(code: string, modifiers?: number): Promise<void>;
    typeText(text: string): Promise<void>;
  };
  stepFrame(n?: number): Promise<void>;
  stepSimTick(n?: number): Promise<void>;
  snapshot(): Record<string, unknown>;
  captureCheckpoint(
    name: string,
    options?: { screenshot?: boolean },
  ): Promise<{
    name: string;
    drawHash: string;
    snapshot: Record<string, unknown>;
  }>;
};

export class ScenarioBrowserError extends Error {
  readonly code: string;
  readonly stepIndex?: number;

  constructor(code: string, message: string, stepIndex?: number) {
    super(message);
    this.name = "ScenarioBrowserError";
    this.code = code;
    this.stepIndex = stepIndex;
  }
}

function shellFromSnapshot(snapshot: Record<string, unknown>) {
  const shell = (snapshot.shell as Record<string, unknown> | undefined) ?? {};
  return {
    open: Boolean(shell.open),
    page: String(shell.page ?? "root"),
  };
}

async function pressAndFrame(
  api: ScenarioHarnessApi,
  code: string,
) {
  await api.input.press(code);
  await api.stepFrame(1);
}

async function lowerShell(
  api: ScenarioHarnessApi,
  profile: KeymapProfile,
  action: ShellActionJson,
) {
  const snap = () => shellFromSnapshot(api.snapshot());
  switch (action.type) {
    case "open_shell": {
      if (!snap().open) {
        await pressAndFrame(api, profile.openShell);
      }
      break;
    }
    case "close_shell": {
      let guard = 0;
      while (snap().open && guard < 8) {
        await pressAndFrame(api, profile.closeShell);
        guard += 1;
      }
      break;
    }
    case "open_settings": {
      if (!snap().open) {
        await pressAndFrame(api, profile.openShell);
      }
      if (snap().page === "settings") {
        break;
      }
      // From root: FocusNext (KeyK) then Activate (Enter) — matches Increment 1 golden.
      for (const code of profile.openSettings) {
        await pressAndFrame(api, code);
      }
      break;
    }
    default: {
      const _exhaustive: never = action;
      throw new ScenarioBrowserError(
        "unknown_shell_action",
        `unknown shell action: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

async function lowerSession(
  api: ScenarioHarnessApi,
  intent: SessionIntentJson,
) {
  if (intent === "SubmitChat") {
    await pressAndFrame(api, "Enter");
    return;
  }
  if (intent === "CancelChat") {
    await pressAndFrame(api, "Escape");
    return;
  }
  if ("OpenChat" in intent) {
    await pressAndFrame(api, "KeyT");
    const prefill = intent.OpenChat.prefill ?? "";
    if (prefill.length > 0) {
      await api.input.typeText(prefill);
      await api.stepFrame(1);
    }
    return;
  }
  if ("EditChat" in intent) {
    const edit = intent.EditChat;
    if (typeof edit === "object" && edit !== null && "InsertText" in edit) {
      await api.input.typeText(String(edit.InsertText));
      await api.stepFrame(1);
      return;
    }
    const map: Record<string, string> = {
      DeleteBack: "Backspace",
      DeleteFwd: "Delete",
      CaretLeft: "ArrowLeft",
      CaretRight: "ArrowRight",
      CaretHome: "Home",
      CaretEnd: "End",
    };
    if (typeof edit === "string" && map[edit]) {
      await pressAndFrame(api, map[edit]!);
      return;
    }
    if (edit === "DeleteWordBack") {
      await api.input.keyDown("Backspace", 2); // INPUT_MODIFIER_CTRL
      await api.input.keyUp("Backspace", 2);
      await api.stepFrame(1);
      return;
    }
    throw new ScenarioBrowserError(
      "unsupported_edit_chat",
      `unsupported EditChat: ${JSON.stringify(edit)}`,
    );
  }
  throw new ScenarioBrowserError(
    "unknown_session_intent",
    `unknown session intent: ${JSON.stringify(intent)}`,
  );
}

async function lowerInput(api: ScenarioHarnessApi, action: InputActionJson) {
  switch (action.type) {
    case "key_down":
      await api.input.keyDown(action.code);
      break;
    case "key_up":
      await api.input.keyUp(action.code);
      break;
    case "press":
      await pressAndFrame(api, action.code);
      return;
    case "type_text":
      await api.input.typeText(action.text);
      break;
    default: {
      const _exhaustive: never = action;
      throw new ScenarioBrowserError(
        "unknown_input_action",
        `unknown input action: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
  await api.stepFrame(1);
}

function worldFromSnapshot(snapshot: Record<string, unknown>) {
  return (snapshot.world as Record<string, unknown> | undefined) ?? {};
}

function primaryEntityFromSnapshot(snapshot: Record<string, unknown>) {
  return (worldFromSnapshot(snapshot).primaryEntity as
    | Record<string, unknown>
    | null
    | undefined) ?? null;
}

function primaryEntityMoving(snapshot: Record<string, unknown>) {
  const entity = primaryEntityFromSnapshot(snapshot);
  return Boolean(entity?.movement);
}

function positionKey(position: unknown) {
  const pos = (position as Record<string, unknown> | undefined) ?? {};
  return `${Number(pos.x)},${Number(pos.y)},${Number(pos.z)}`;
}

function directionCodes(profile: KeymapProfile, direction: unknown) {
  switch (String(direction).toLowerCase()) {
    case "n":
      return [profile.north];
    case "ne":
      return [profile.north, profile.east];
    case "e":
      return [profile.east];
    case "se":
      return [profile.south, profile.east];
    case "s":
      return [profile.south];
    case "sw":
      return [profile.south, profile.west];
    case "w":
      return [profile.west];
    case "nw":
      return [profile.north, profile.west];
    default:
      throw new ScenarioBrowserError(
        "unknown_world_direction",
        `unknown world direction ${JSON.stringify(direction)}`,
      );
  }
}

async function keyTapSimTick(
  api: ScenarioHarnessApi,
  codes: string[],
) {
  for (const code of codes) {
    await api.input.keyDown(code);
  }
  await api.stepSimTick(1);
  for (const code of [...codes].reverse()) {
    await api.input.keyUp(code);
  }
}

async function lowerWorldIntent(
  api: ScenarioHarnessApi,
  profile: KeymapProfile,
  intent: unknown,
  stepIndex: number,
) {
  const typed = intent as Record<string, unknown>;
  if (typed.type === "move_player") {
    const codes = directionCodes(profile, typed.direction);
    await keyTapSimTick(api, codes);
    return;
  }
  if (typed.type === "wait_ticks") {
    await api.stepSimTick(Math.max(0, Math.trunc(Number(typed.ticks ?? 0))));
    return;
  }
  throw new ScenarioBrowserError(
    "unknown_world_intent",
    `unknown WorldIntent at index ${stepIndex}: ${JSON.stringify(intent)}`,
    stepIndex,
  );
}

async function waitUntilIdle(
  api: ScenarioHarnessApi,
  maxTicks: number,
  stepIndex: number,
) {
  const limit = Math.max(0, Math.trunc(maxTicks));
  for (let tick = 0; tick < limit; tick++) {
    if (!primaryEntityMoving(api.snapshot())) {
      return;
    }
    await api.stepSimTick(1);
  }
  if (primaryEntityMoving(api.snapshot())) {
    throw new ScenarioBrowserError(
      "wait_until_idle_timeout",
      `primary entity still moving after ${limit} ticks at index ${stepIndex}`,
      stepIndex,
    );
  }
}

async function lowerMovePlayerExact(
  api: ScenarioHarnessApi,
  profile: KeymapProfile,
  direction: unknown,
  maxTicks: number,
  stepIndex: number,
) {
  const codes = directionCodes(profile, direction);
  await keyTapSimTick(api, codes);
  await waitUntilIdle(api, maxTicks, stepIndex);
}

function applyAssert(
  api: ScenarioHarnessApi,
  assertion: unknown,
  stepIndex: number,
) {
  const typed = assertion as Record<string, unknown>;
  const snapshot = api.snapshot();
  if (typed.type === "world_state_hash_eq") {
    const actual = String(worldFromSnapshot(snapshot).world_state_hash ?? "");
    const expected = String(typed.expected ?? "");
    if (actual !== expected) {
      throw new ScenarioBrowserError(
        "assert_world_state_hash",
        `world_state_hash mismatch at index ${stepIndex}: expected ${expected}, got ${actual}`,
        stepIndex,
      );
    }
    return;
  }
  if (typed.type === "entity_position") {
    const id = Number(typed.id);
    const entity = primaryEntityFromSnapshot(snapshot);
    const actualId = Number(entity?.id);
    const actual = positionKey(entity?.position);
    const expected = positionKey(typed.position);
    if (actualId !== id || actual !== expected) {
      throw new ScenarioBrowserError(
        "assert_entity_position",
        `entity ${id} position mismatch at index ${stepIndex}: expected ${expected}, got ${actual}`,
        stepIndex,
      );
    }
    return;
  }
  throw new ScenarioBrowserError(
    "unknown_assert",
    `unknown Assert at index ${stepIndex}: ${JSON.stringify(assertion)}`,
    stepIndex,
  );
}

function rejectEngine(step: ScenarioStep, stepIndex: number): void {
  switch (step.kind) {
    case "engine":
      throw new ScenarioBrowserError(
        "engine_not_allowed",
        `browser runScenario fail-closed on Engine step at index ${stepIndex}`,
        stepIndex,
      );
    default:
      break;
  }
}

/**
 * Run a Scenario document against the browser harness API.
 *
 * Rejects up front if any Engine step is present (fail-closed, no partial run).
 */
export async function runScenarioBrowser(
  api: ScenarioHarnessApi,
  scenario: ScenarioDocument,
): Promise<RunScenarioResult> {
  if (scenario.format_version !== 1) {
    throw new ScenarioBrowserError(
      "unsupported_format",
      `unsupported scenario format_version ${scenario.format_version}`,
    );
  }
  const profile = resolveKeymapProfile(scenario.keymap_profile);
  if (!profile) {
    throw new ScenarioBrowserError(
      "unknown_keymap",
      `unknown keymap profile ${JSON.stringify(scenario.keymap_profile)}`,
    );
  }

  // Fail-closed up front on Engine — no partial success.
  for (let i = 0; i < scenario.steps.length; i++) {
    if (scenario.steps[i]!.kind === "engine") {
      rejectEngine(scenario.steps[i]!, i);
    }
  }

  const checkpoints: RunScenarioResult["checkpoints"] = [];

  for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex++) {
    const step = scenario.steps[stepIndex]!;
    switch (step.kind) {
      case "shell":
        await lowerShell(api, profile, step.action);
        break;
      case "session":
        await lowerSession(api, step.intent);
        break;
      case "input":
        await lowerInput(api, step.action);
        break;
      case "world":
        await lowerWorldIntent(api, profile, step.intent, stepIndex);
        break;
      case "move_player_exact":
        await lowerMovePlayerExact(
          api,
          profile,
          step.direction,
          step.max_ticks,
          stepIndex,
        );
        break;
      case "wait_until_idle":
        await waitUntilIdle(api, step.max_ticks, stepIndex);
        break;
      case "assert":
        applyAssert(api, step.assertion, stepIndex);
        break;
      case "record_checkpoint": {
        const cp = await api.captureCheckpoint(step.name);
        checkpoints.push({
          name: cp.name,
          drawHash: cp.drawHash,
          snapshot: cp.snapshot,
        });
        break;
      }
      case "engine":
        rejectEngine(step, stepIndex);
        break;
      default: {
        const _exhaustive: never = step;
        throw new ScenarioBrowserError(
          "unknown_step",
          `unknown step: ${JSON.stringify(_exhaustive)}`,
          stepIndex,
        );
      }
    }
  }

  return {
    name: scenario.name,
    checkpoints,
    finalSnapshot: api.snapshot(),
  };
}
