/// <reference lib="dom" />

import {
  CAMERA_KEYS,
  type ChatBubbleRecord,
  type InputLogEvent,
  PLAYER_KEYS,
  type ReplayDocument,
  type WebGlUiMode,
  type WebGlViewMode,
} from "./webgl-core.ts";

type Ref<T> = { current: T };

type SceneState = {
  camera: { x: number; y: number; zoom: number };
  player: { tileX: number; tileY: number; tileZ: number };
  viewMode: WebGlViewMode;
  uiMode: WebGlUiMode;
  chatBuffer: string;
  submittedChatMessages: string[];
};

type InputControllerArgs = {
  hostRef: Ref<HTMLDivElement | null>;
  canvasRef: Ref<HTMLCanvasElement | null>;
  sceneStateRef: Ref<SceneState>;
  uiModeRef: Ref<WebGlUiMode>;
  viewModeRef: Ref<WebGlViewMode>;
  activeTypingRef: Ref<boolean>;
  chatBubblesRef: Ref<ChatBubbleRecord[]>;
  playerKeysHeldRef: Ref<Set<string>>;
  playerKeysJustPressedRef: Ref<Set<string>>;
  cameraKeysHeldRef: Ref<Set<string>>;
  keysHeldRef: Ref<Set<string>>;
  uiOverlayVisibleRef: Ref<boolean>;
  layersRef: Ref<{
    floor: boolean;
    edgeShadow: boolean;
    ceilShadow: boolean;
    depthTint: boolean;
  }>;
  fovDirtyRef: Ref<boolean>;
  topmostCacheDirtyRef: Ref<boolean>;
  getViewZ: () => number;
  setViewZ: (next: number) => void;
  simTickRef: Ref<number>;
  setLayers: (next: {
    floor: boolean;
    edgeShadow: boolean;
    ceilShadow: boolean;
    depthTint: boolean;
  }) => void;
  setUiOverlayVisible: (next: boolean) => void;
  appendLog: (text: string) => void;
  recordInputEvent: (event: InputLogEvent) => void;
  importReplayDocument: (doc: ReplayDocument) => void;
  setFullscreenState: (next: boolean) => void;
};

function deleteLastWord(value: string) {
  const trimmed = value.trimEnd();
  if (trimmed.length === 0) return "";
  const splitIndex = Math.max(
    trimmed.lastIndexOf(" "),
    trimmed.lastIndexOf("\t"),
    trimmed.lastIndexOf("\n"),
  );
  if (splitIndex < 0) return "";
  let nextValue = trimmed.slice(0, splitIndex + 1);
  if (nextValue.length > 0 && !nextValue.endsWith(" ")) {
    nextValue += " ";
  }
  return nextValue;
}

export function createInputController(args: InputControllerArgs) {
  const {
    hostRef,
    canvasRef,
    sceneStateRef,
    uiModeRef,
    viewModeRef,
    activeTypingRef,
    chatBubblesRef,
    playerKeysHeldRef,
    playerKeysJustPressedRef,
    cameraKeysHeldRef,
    keysHeldRef,
    uiOverlayVisibleRef,
    layersRef,
    fovDirtyRef,
    topmostCacheDirtyRef,
    getViewZ,
    setViewZ,
    simTickRef,
    setLayers,
    setUiOverlayVisible,
    appendLog,
    recordInputEvent,
    importReplayDocument,
    setFullscreenState,
  } = args;

  const openChat = (initialValue: string) => {
    uiModeRef.current = "chat";
    activeTypingRef.current = true;
    sceneStateRef.current.uiMode = "chat";
    sceneStateRef.current.chatBuffer = initialValue;
    if (initialValue.length > 0) {
      recordInputEvent({
        type: "text",
        value: initialValue,
        tick: simTickRef.current,
      });
    }
    appendLog(`chat open ${JSON.stringify(initialValue)}`);
  };

  const updateChatBuffer = (value: string) => {
    sceneStateRef.current.chatBuffer = value;
  };

  const handleChatSubmission = (input: string) => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return;

    if (trimmed.startsWith("/")) {
      const command = trimmed.slice(1).toLowerCase();
      if (command === "master") {
        viewModeRef.current = "master";
        sceneStateRef.current.viewMode = "master";
        fovDirtyRef.current = true;
        topmostCacheDirtyRef.current = true;
        appendLog("chat command /master");
      } else if (command === "entity") {
        viewModeRef.current = "entity";
        sceneStateRef.current.viewMode = "entity";
        fovDirtyRef.current = true;
        topmostCacheDirtyRef.current = true;
        appendLog("chat command /entity");
      } else {
        appendLog(`chat command ignored /${command}`);
      }
      return;
    }

    const bubble: ChatBubbleRecord = {
      message: trimmed,
      target: { ...sceneStateRef.current.player },
      tick: simTickRef.current,
    };
    chatBubblesRef.current = [...chatBubblesRef.current, bubble].slice(-6);
    sceneStateRef.current.submittedChatMessages = [
      ...sceneStateRef.current.submittedChatMessages,
      trimmed,
    ].slice(-20);
    appendLog(`chat message ${JSON.stringify(trimmed)}`);
  };

  const closeChat = () => {
    uiModeRef.current = "world";
    activeTypingRef.current = false;
    sceneStateRef.current.uiMode = "world";
    sceneStateRef.current.chatBuffer = "";
    appendLog("chat close");
  };

  const submitChat = () => {
    const current = sceneStateRef.current.chatBuffer;
    handleChatSubmission(current);
    closeChat();
  };

  const handleFullScreenToggle = () => {
    const host = hostRef.current;
    if (!host) return;
    if (document.fullscreenElement === host) {
      void document.exitFullscreen();
    } else {
      void host.requestFullscreen();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "F11") {
      event.preventDefault();
      handleFullScreenToggle();
    }
    if (
      event.key === "Escape" && document.fullscreenElement === hostRef.current
    ) {
      event.preventDefault();
      void document.exitFullscreen();
    }
    if (uiModeRef.current === "chat") {
      event.preventDefault();
      recordInputEvent({
        type: "key_down",
        code: event.code,
        key: event.key,
        repeat: event.repeat,
        tick: simTickRef.current,
      });
      if (event.key === "Escape") {
        closeChat();
      } else if (event.key === "Enter") {
        submitChat();
      } else if (event.key === "Backspace") {
        const current = sceneStateRef.current.chatBuffer;
        const next = event.ctrlKey || event.shiftKey
          ? deleteLastWord(current)
          : current.slice(0, -1);
        updateChatBuffer(next);
      } else if (event.key.length === 1) {
        const next = `${sceneStateRef.current.chatBuffer}${event.key}`;
        updateChatBuffer(next);
        recordInputEvent({
          type: "text",
          value: event.key,
          tick: simTickRef.current,
        });
      }
      return;
    }

    if (event.key === "/" || event.code === "Slash") {
      event.preventDefault();
      recordInputEvent({
        type: "key_down",
        code: event.code,
        key: event.key,
        repeat: event.repeat,
        tick: simTickRef.current,
      });
      openChat("/");
      return;
    }

    if (event.code === "KeyT") {
      event.preventDefault();
      recordInputEvent({
        type: "key_down",
        code: event.code,
        key: event.key,
        repeat: event.repeat,
        tick: simTickRef.current,
      });
      openChat("");
      return;
    }

    recordInputEvent({
      type: "key_down",
      code: event.code,
      key: event.key,
      repeat: event.repeat,
      tick: simTickRef.current,
    });

    if (PLAYER_KEYS.has(event.code)) {
      event.preventDefault();
      playerKeysHeldRef.current.add(event.code);
      if (!event.repeat) {
        playerKeysJustPressedRef.current.add(event.code);
      }
    }
    if (CAMERA_KEYS.has(event.code)) {
      event.preventDefault();
      cameraKeysHeldRef.current.add(event.code);
    }
    if (event.code === "Digit1") {
      event.preventDefault();
      uiOverlayVisibleRef.current = !uiOverlayVisibleRef.current;
      setUiOverlayVisible(uiOverlayVisibleRef.current);
      appendLog(`ui: ${uiOverlayVisibleRef.current ? "on" : "off"}`);
    }
    if (event.code === "KeyR") {
      event.preventDefault();
      const next = getViewZ() + 1;
      setViewZ(next);
      appendLog(`z-level: ${next}`);
    }
    if (event.code === "KeyV") {
      event.preventDefault();
      const next = getViewZ() - 1;
      setViewZ(next);
      appendLog(`z-level: ${next}`);
    }
    if (event.code === "KeyU" || event.code === "KeyM") {
      event.preventDefault();
      const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
      const cur = sceneStateRef.current.camera.zoom;
      const idx = ZOOM_LEVELS.reduce(
        (best, z, i) =>
          Math.abs(z - cur) < Math.abs(ZOOM_LEVELS[best] - cur) ? i : best,
        0,
      );
      const next = event.code === "KeyU"
        ? ZOOM_LEVELS[Math.max(0, idx - 1)]
        : ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, idx + 1)];
      sceneStateRef.current.camera = {
        ...sceneStateRef.current.camera,
        zoom: next,
      };
      appendLog(`zoom: ${next}`);
    }
    if (event.code === "Digit6") {
      event.preventDefault();
      layersRef.current = {
        ...layersRef.current,
        floor: !layersRef.current.floor,
      };
      setLayers({ ...layersRef.current });
      appendLog(`floor: ${layersRef.current.floor ? "on" : "off"}`);
    }
    if (event.code === "Digit7") {
      event.preventDefault();
      layersRef.current = {
        ...layersRef.current,
        edgeShadow: !layersRef.current.edgeShadow,
      };
      setLayers({ ...layersRef.current });
      appendLog(`edgeShadow: ${layersRef.current.edgeShadow ? "on" : "off"}`);
    }
    if (event.code === "Digit8") {
      event.preventDefault();
      layersRef.current = {
        ...layersRef.current,
        ceilShadow: !layersRef.current.ceilShadow,
      };
      setLayers({ ...layersRef.current });
      appendLog(`ceilShadow: ${layersRef.current.ceilShadow ? "on" : "off"}`);
    }
    if (event.code === "Digit9") {
      event.preventDefault();
      layersRef.current = {
        ...layersRef.current,
        depthTint: !layersRef.current.depthTint,
      };
      setLayers({ ...layersRef.current });
      appendLog(`depthTint: ${layersRef.current.depthTint ? "on" : "off"}`);
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    recordInputEvent({
      type: "key_up",
      code: event.code,
      key: event.key,
      tick: simTickRef.current,
    });
    keysHeldRef.current.delete(event.code);
    cameraKeysHeldRef.current.delete(event.code);
    playerKeysHeldRef.current.delete(event.code);
  };

  const handleBlur = () => {
    keysHeldRef.current.clear();
    cameraKeysHeldRef.current.clear();
    playerKeysHeldRef.current.clear();
  };

  const handlePointerDown = () => {
    canvasRef.current?.focus();
  };

  const handleFullscreenChange = () => {
    keysHeldRef.current.clear();
    cameraKeysHeldRef.current.clear();
    playerKeysHeldRef.current.clear();
    const host = hostRef.current;
    const isFullscreen = !!host && document.fullscreenElement === host;
    setFullscreenState(isFullscreen);
  };

  const handleReplayFileInputChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ReplayDocument;
      if (parsed.version !== 1 || parsed.flow !== "webgl-step1-single-rock") {
        throw new Error("Unsupported replay document");
      }
      importReplayDocument(parsed);
    } catch (error) {
      console.error(error);
    } finally {
      if (input) input.value = "";
    }
  };

  return {
    handleKeyDown,
    handleKeyUp,
    handleBlur,
    handlePointerDown,
    handleFullscreenChange,
    handleReplayFileInputChange,
  };
}
