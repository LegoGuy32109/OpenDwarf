/**
 * Scenario document types (JSON schema aligned with `od_scenario`).
 * See `docs/design/scenario.md`.
 */

export type ScenarioDocument = {
  format_version: number;
  name: string;
  world_config: unknown;
  spawn_default_player: boolean;
  keymap_profile: string;
  steps: ScenarioStep[];
};

export type ScenarioStep =
  | { kind: "session"; intent: SessionIntentJson }
  | { kind: "world"; intent: unknown }
  | { kind: "move_player_exact"; direction: string; max_ticks: number }
  | { kind: "wait_until_idle"; max_ticks: number }
  | { kind: "engine"; action: unknown }
  | { kind: "assert"; assertion: unknown }
  | { kind: "shell"; action: ShellActionJson }
  | { kind: "input"; action: InputActionJson }
  | { kind: "record_checkpoint"; name: string };

export type SessionIntentJson =
  | { OpenChat: { prefill: string } }
  | { EditChat: TextEditJson }
  | "SubmitChat"
  | "CancelChat";

/** Serde externally-tagged SessionIntent — also accept snake tagged forms. */
export type TextEditJson =
  | { InsertText: string }
  | "DeleteBack"
  | "DeleteFwd"
  | "DeleteWordBack"
  | "CaretLeft"
  | "CaretRight"
  | "CaretHome"
  | "CaretEnd";

export type ShellActionJson =
  | { type: "open_shell" }
  | { type: "open_settings" }
  | { type: "close_shell" };

export type InputActionJson =
  | { type: "key_down"; code: string }
  | { type: "key_up"; code: string }
  | { type: "press"; code: string }
  | { type: "type_text"; text: string };

export type RunScenarioResult = {
  name: string;
  checkpoints: {
    name: string;
    drawHash: string;
    snapshot: Record<string, unknown>;
  }[];
  finalSnapshot: Record<string, unknown>;
};

export type KeymapProfile = {
  id: string;
  north: string;
  south: string;
  east: string;
  west: string;
  openShell: string;
  /** Keys after shell is open at root (FocusNext + Activate → Settings). */
  openSettings: string[];
  closeShell: string;
};

export const ESDF_KEYMAP: KeymapProfile = {
  id: "esdf",
  north: "KeyE",
  south: "KeyD",
  east: "KeyF",
  west: "KeyS",
  openShell: "Escape",
  openSettings: ["KeyK", "Enter"],
  closeShell: "Escape",
};

export function resolveKeymapProfile(id: string): KeymapProfile | null {
  if (id === "esdf" || id === "default") {
    return ESDF_KEYMAP;
  }
  return null;
}
