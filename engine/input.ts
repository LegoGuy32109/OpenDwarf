/// <reference lib="dom" />

import { ABI } from "../lib/engine/abi.generated.ts";

type InputBuffer = DataView<ArrayBufferLike>;

const CODE_TO_KEYCODE: Record<string, number> = Object.freeze({
  Enter: ABI.KEYCODE_ENTER,
  Escape: ABI.KEYCODE_ESCAPE,
  Space: ABI.KEYCODE_SPACE,
  Backspace: ABI.KEYCODE_BACKSPACE,
  Delete: ABI.KEYCODE_DELETE,
  ArrowLeft: ABI.KEYCODE_ARROWLEFT,
  ArrowRight: ABI.KEYCODE_ARROWRIGHT,
  Home: ABI.KEYCODE_HOME,
  End: ABI.KEYCODE_END,
  Slash: ABI.KEYCODE_SLASH,
  KeyI: ABI.KEYCODE_KEYI,
  KeyJ: ABI.KEYCODE_KEYJ,
  KeyK: ABI.KEYCODE_KEYK,
  KeyL: ABI.KEYCODE_KEYL,
  KeyQ: ABI.KEYCODE_KEYQ,
  KeyE: ABI.KEYCODE_KEYE,
  KeyS: ABI.KEYCODE_KEYS,
  KeyD: ABI.KEYCODE_KEYD,
  KeyF: ABI.KEYCODE_KEYF,
  KeyT: ABI.KEYCODE_KEYT,
});

function modifiersFrom(event: KeyboardEvent): number {
  return (event.shiftKey ? ABI.INPUT_MODIFIER_SHIFT : 0) |
    (event.ctrlKey ? ABI.INPUT_MODIFIER_CTRL : 0) |
    (event.altKey ? ABI.INPUT_MODIFIER_ALT : 0) |
    (event.metaKey ? ABI.INPUT_MODIFIER_META : 0);
}

function isPrintableKey(code: string) {
  return (
    code === "Space" ||
    code === "Slash" ||
    code === "Minus" ||
    code === "Equal" ||
    code === "BracketLeft" ||
    code === "BracketRight" ||
    code === "Backslash" ||
    code === "Semicolon" ||
    code === "Quote" ||
    code === "Comma" ||
    code === "Period" ||
    code === "Backquote" ||
    code.startsWith("Key") ||
    code.startsWith("Digit")
  );
}

function writeSampled(
  input: InputBuffer,
  canvas: HTMLCanvasElement,
  focused: boolean,
) {
  if (input.byteLength === 0) {
    return;
  }
  const dpr = globalThis.devicePixelRatio || 1;
  input.setUint32(ABI.INPUT_SAMPLE_FRAMEBUFFER_W_OFFSET, canvas.width, true);
  input.setUint32(ABI.INPUT_SAMPLE_FRAMEBUFFER_H_OFFSET, canvas.height, true);
  input.setFloat32(ABI.INPUT_SAMPLE_DPR_OFFSET, dpr, true);
  input.setFloat32(ABI.INPUT_SAMPLE_POINTER_X_OFFSET, 0, true);
  input.setFloat32(ABI.INPUT_SAMPLE_POINTER_Y_OFFSET, 0, true);
  input.setUint32(ABI.INPUT_SAMPLE_BUTTONS_OFFSET, 0, true);
  input.setUint32(
    ABI.INPUT_SAMPLE_WINDOW_FOCUSED_OFFSET,
    focused ? 1 : 0,
    true,
  );
}

function appendEvent(
  input: InputBuffer,
  kind: number,
  code: number,
  modifiers: number,
  value = 0,
) {
  if (input.byteLength === 0) {
    return;
  }
  const queueBase = ABI.INPUT_ARENA_QUEUE_OFFSET;
  const count = input.getUint32(
    queueBase + ABI.INPUT_QUEUE_HEADER_COUNT_OFFSET,
    true,
  );
  if (count >= ABI.INPUT_QUEUE_CAPACITY) {
    input.setUint32(queueBase + ABI.INPUT_QUEUE_HEADER_OVERFLOW_OFFSET, 1, true);
    return;
  }
  const base = ABI.INPUT_ARENA_EVENTS_OFFSET +
    count * ABI.INPUT_EVENT_SIZE_BYTES;
  input.setUint8(base + ABI.INPUT_EVENT_KIND_OFFSET, kind);
  input.setUint8(base + ABI.INPUT_EVENT_MODIFIERS_OFFSET, modifiers);
  input.setUint16(base + ABI.INPUT_EVENT_CODE_OFFSET, code, true);
  input.setUint32(base + ABI.INPUT_EVENT_VALUE_OFFSET, value >>> 0, true);
  input.setUint32(queueBase + ABI.INPUT_QUEUE_HEADER_COUNT_OFFSET, count + 1, true);
}

function appendTextEvent(input: InputBuffer, codepoint: number) {
  appendEvent(input, ABI.INPUT_KIND_TEXT, 0, 0, codepoint);
}

function acceptsTextInputChar(ch: string) {
  const code = ch.codePointAt(0);
  return code !== undefined && (code === 32 || (code >= 33 && code <= 126));
}

export class InputCapture {
  private input: InputBuffer = new DataView(new ArrayBuffer(0));
  private lastFrameNow = 0;
  private captureActive = false;
  private shadowDraftLen = 0;
  private lastOpenCommand: "t" | "slash" | null = null;
  private readonly hiddenInput: HTMLInputElement;
  private suppressBlurEvent = false;
  private blurDispatched = false;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const code = CODE_TO_KEYCODE[event.code];
    if (this.captureActive && isPrintableKey(event.code)) {
      return;
    }
    if (!code) {
      return;
    }
    event.preventDefault();
    if (!this.captureActive) {
      if (event.code === "Slash") {
        this.lastOpenCommand = "slash";
      } else if (event.code === "KeyT") {
        this.lastOpenCommand = "t";
      }
    }
    appendEvent(
      this.input,
      ABI.INPUT_KIND_KEY_DOWN,
      code,
      modifiersFrom(event),
    );
    if (this.captureActive) {
      switch (event.code) {
        case "Backspace":
          if (this.shadowDraftLen > 0) this.shadowDraftLen -= 1;
          break;
        case "Delete":
          break;
        case "Enter":
          this.shadowDraftLen = 0;
          break;
        default:
          break;
      }
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (this.captureActive && isPrintableKey(event.code)) {
      return;
    }
    const code = CODE_TO_KEYCODE[event.code];
    if (!code) {
      return;
    }
    event.preventDefault();
    appendEvent(this.input, ABI.INPUT_KIND_KEY_UP, code, modifiersFrom(event));
  };

  private readonly onBeforeInput = (event: InputEvent) => {
    if (!this.captureActive) {
      return;
    }
    const data = event.data ?? "";
    if (event.inputType === "insertText" || event.inputType === "insertFromPaste") {
      const remaining = Math.max(0, this.maxLen - this.shadowDraftLen);
      let inserted = 0;
      for (const ch of data) {
        if (inserted >= remaining) {
          break;
        }
        if (!acceptsTextInputChar(ch)) {
          continue;
        }
        appendTextEvent(this.input, ch.codePointAt(0)!);
        inserted += 1;
      }
      this.shadowDraftLen += inserted;
      event.preventDefault();
      this.hiddenInput.value = "";
      return;
    }
  };

  private readonly onBlur = () => {
    writeSampled(this.input, this.canvas, false);
    this.dispatchBlur();
  };

  private readonly onFocus = () => {
    writeSampled(this.input, this.canvas, true);
    this.blurDispatched = false;
    this.syncCaptureFocus();
  };

  private readonly onResize = () => {
    writeSampled(this.input, this.canvas, document.hasFocus());
    this.syncCaptureFocus();
  };

  private readonly onPointerDown = () => {
    if (this.captureActive) {
      this.syncCaptureFocus();
    } else {
      this.canvas.focus();
    }
  };

  private maxLen = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.hiddenInput = document.createElement("input");
    this.hiddenInput.id = "od-text-capture";
    this.hiddenInput.setAttribute("autocomplete", "off");
    this.hiddenInput.setAttribute("autocorrect", "off");
    this.hiddenInput.setAttribute("autocapitalize", "off");
    this.hiddenInput.setAttribute("spellcheck", "false");
    this.hiddenInput.setAttribute("inputmode", "text");
    this.hiddenInput.tabIndex = -1;
    this.hiddenInput.setAttribute("aria-hidden", "true");
    this.hiddenInput.setAttribute("type", "text");
    this.hiddenInput.style.position = "fixed";
    this.hiddenInput.style.opacity = "0";
    this.hiddenInput.style.pointerEvents = "none";
    this.hiddenInput.style.caretColor = "transparent";
    this.hiddenInput.style.color = "transparent";
    this.hiddenInput.style.background = "transparent";
    this.hiddenInput.style.border = "0";
    this.hiddenInput.style.padding = "0";
    this.hiddenInput.style.margin = "0";
    this.hiddenInput.style.outline = "none";
    this.hiddenInput.style.zIndex = "2147483647";
    (canvas.parentElement ?? document.body).append(this.hiddenInput);
    globalThis.addEventListener("keydown", this.onKeyDown, { passive: false });
    globalThis.addEventListener("keyup", this.onKeyUp, { passive: false });
    globalThis.addEventListener("blur", this.onBlur);
    globalThis.addEventListener("focus", this.onFocus);
    globalThis.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onResize);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    this.hiddenInput.addEventListener("beforeinput", this.onBeforeInput);
    this.hiddenInput.addEventListener("blur", () => {
      if (this.suppressBlurEvent) {
        return;
      }
      this.dispatchBlur();
    });
  }

  private dispatchBlur() {
    if (this.captureActive && !this.blurDispatched) {
      appendEvent(this.input, ABI.INPUT_KIND_BLUR, 0, 0);
      this.blurDispatched = true;
    }
  }

  private syncCaptureFocus() {
    if (this.captureActive && document.activeElement !== this.hiddenInput) {
      this.hiddenInput.focus();
    }
  }

  setArena(input: DataView) {
    this.input = input;
    writeSampled(this.input, this.canvas, document.hasFocus());
  }

  beginFrame(now: number) {
    if (this.input.byteLength === 0) {
      return;
    }
    const dt = this.lastFrameNow === 0
      ? 16.0
      : Math.max(0, now - this.lastFrameNow);
    this.lastFrameNow = now;
    writeSampled(this.input, this.canvas, document.hasFocus());
    this.input.setFloat32(ABI.INPUT_SAMPLE_DT_MS_OFFSET, dt, true);
    this.syncCaptureFocus();
  }

  clearQueue() {
    if (this.input.byteLength === 0) {
      return;
    }
    const queueBase = ABI.INPUT_ARENA_QUEUE_OFFSET;
    this.input.setUint32(queueBase + ABI.INPUT_QUEUE_HEADER_COUNT_OFFSET, 0, true);
    this.input.setUint32(queueBase + ABI.INPUT_QUEUE_HEADER_OVERFLOW_OFFSET, 0, true);
  }

  isCaptureActive() {
    return this.captureActive;
  }

  isHiddenInputFocused() {
    return document.activeElement === this.hiddenInput;
  }

  setTextCapture(
    active: boolean,
    x: number,
    y: number,
    w: number,
    h: number,
    maxLen: number,
  ) {
    const wasActive = this.captureActive;
    this.captureActive = active;
    this.maxLen = maxLen;
    const dpr = globalThis.devicePixelRatio || 1;
    this.hiddenInput.style.left = `${x / dpr}px`;
    this.hiddenInput.style.top = `${y / dpr}px`;
    this.hiddenInput.style.width = `${Math.max(1, w / dpr)}px`;
    this.hiddenInput.style.height = `${Math.max(1, h / dpr)}px`;
    if (active) {
      if (!wasActive) {
        if (this.lastOpenCommand === "slash") {
          this.shadowDraftLen = 1;
        } else {
          this.shadowDraftLen = 0;
        }
        this.lastOpenCommand = null;
      }
      this.blurDispatched = false;
      this.syncCaptureFocus();
      this.hiddenInput.value = "";
    } else {
      this.suppressBlurEvent = true;
      this.hiddenInput.blur();
      this.suppressBlurEvent = false;
      this.hiddenInput.value = "";
      this.shadowDraftLen = 0;
      this.lastOpenCommand = null;
      this.blurDispatched = false;
    }
  }

  dispose() {
    globalThis.removeEventListener("keydown", this.onKeyDown);
    globalThis.removeEventListener("keyup", this.onKeyUp);
    globalThis.removeEventListener("blur", this.onBlur);
    globalThis.removeEventListener("focus", this.onFocus);
    globalThis.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onResize);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.hiddenInput.removeEventListener("beforeinput", this.onBeforeInput);
    this.hiddenInput.remove();
  }
}
