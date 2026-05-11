import { useEffect, useRef, useState } from "preact/hooks";

type WebGlCapabilityReport = {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number | null;
  devicePixelRatio: number;
  innerSize: { width: number; height: number };
  screenSize: { width: number; height: number };
  maxTouchPoints: number | null;
  fullscreen: boolean;
  canvasCssSize: { width: number; height: number };
  framebufferSize: { width: number; height: number };
  context: {
    webgl2: boolean;
    version: string | null;
    shadingLanguageVersion: string | null;
    renderer: string | null;
    vendor: string | null;
    maxTextureSize: number | null;
    maxViewportDims: [number, number] | null;
  };
};

type LogEntry = {
  id: number;
  text: string;
};

function readGpuStrings(gl: WebGL2RenderingContext) {
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info") as
    | {
      UNMASKED_RENDERER_WEBGL: number;
      UNMASKED_VENDOR_WEBGL: number;
    }
    | undefined;

  return {
    renderer: debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
      : null,
    vendor: debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
      : null,
  };
}

export default function WebGlGameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const logIdRef = useRef(0);

  const [status, setStatus] = useState("booting");
  const [fullscreen, setFullscreen] = useState(false);
  const [capability, setCapability] = useState<WebGlCapabilityReport | null>(
    null,
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    canvas.tabIndex = 0;
    canvas.style.touchAction = "none";

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
      stencil: false,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;

    if (!gl) {
      setStatus("webgl2 unavailable");
      setCapability({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        devicePixelRatio: window.devicePixelRatio || 1,
        innerSize: { width: window.innerWidth, height: window.innerHeight },
        screenSize: { width: window.screen.width, height: window.screen.height },
        maxTouchPoints: navigator.maxTouchPoints ?? null,
        fullscreen: document.fullscreenElement === canvas,
        canvasCssSize: { width: 0, height: 0 },
        framebufferSize: { width: 0, height: 0 },
        context: {
          webgl2: false,
          version: null,
          shadingLanguageVersion: null,
          renderer: null,
          vendor: null,
          maxTextureSize: null,
          maxViewportDims: null,
        },
      });
      return;
    }

    glRef.current = gl;
    setStatus("webgl2 ready");

    const emitLog = (text: string) => {
      const id = logIdRef.current++;
      setLogs((prev) => [{ id, text }, ...prev].slice(0, 8));
    };

    const updateCapability = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
      setCapability({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        devicePixelRatio: dpr,
        innerSize: { width: window.innerWidth, height: window.innerHeight },
        screenSize: { width: window.screen.width, height: window.screen.height },
        maxTouchPoints: navigator.maxTouchPoints ?? null,
        fullscreen: document.fullscreenElement === canvas,
        canvasCssSize: { width: rect.width, height: rect.height },
        framebufferSize: { width: canvas.width, height: canvas.height },
        context: {
          webgl2: true,
          version: String(gl.getParameter(gl.VERSION)),
          shadingLanguageVersion: String(
            gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          ),
          ...readGpuStrings(gl),
          maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
          maxViewportDims: [maxViewportDims[0], maxViewportDims[1]],
        },
      });
    };

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      gl.viewport(0, 0, width, height);
      updateCapability();
      emitLog(`resize ${Math.round(rect.width)}x${Math.round(rect.height)} @ ${dpr.toFixed(2)}x`);
    };

    const drawFrame = () => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.1, 0.11, 0.13, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      rafRef.current = window.requestAnimationFrame(drawFrame);
    };

    const enterFullscreen = async () => {
      if (document.fullscreenElement === canvas) return;
      await canvas.requestFullscreen();
    };

    const exitFullscreen = async () => {
      if (document.fullscreenElement === canvas) {
        await document.exitFullscreen();
      }
    };

    const handleFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement === canvas;
      setFullscreen(isFullscreen);
      emitLog(isFullscreen ? "fullscreen enter" : "fullscreen exit");
      resizeCanvas();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        if (document.fullscreenElement === canvas) {
          void exitFullscreen();
        } else {
          void enterFullscreen();
        }
      }

      if (event.key === "Escape" && document.fullscreenElement === canvas) {
        event.preventDefault();
        void exitFullscreen();
      }
    };

    const handlePointerDown = () => {
      canvas.focus();
    };

    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(host);
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    resizeCanvas();
    drawFrame();
    emitLog("webgl2 boot");

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
      glRef.current = null;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      class="relative overflow-hidden rounded-[18px] border border-white/10 bg-[#0e1015] shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
    >
      <style>
        {`
          .webgl-experiment-canvas {
            display: block;
            width: 100%;
            height: 74vh;
            outline: none;
          }

          .webgl-experiment-canvas:fullscreen {
            width: 100vw;
            height: 100vh;
            border-radius: 0;
          }
        `}
      </style>
      <div class="absolute left-4 top-4 z-10 max-w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-amber-200/15 bg-black/55 px-4 py-3 text-xs text-amber-50/90 backdrop-blur">
        <div class="flex items-center gap-3">
          <span class="rounded-full bg-amber-300/20 px-2 py-1 font-semibold uppercase tracking-[0.18em] text-amber-100">
            WebGL Step 0
          </span>
          <span class="text-white/70">{status}</span>
        </div>
        <div class="mt-2 space-y-1 font-mono text-[11px] leading-5 text-white/75">
          <div>fullscreen: {fullscreen ? "yes" : "no"}</div>
          <div>
            framebuffer: {capability?.framebufferSize.width ?? 0} x{" "}
            {capability?.framebufferSize.height ?? 0}
          </div>
          <div>
            dpr: {capability?.devicePixelRatio.toFixed(2) ?? "0.00"} browser:{" "}
            {capability?.userAgent ?? "n/a"}
          </div>
          <div>
            renderer: {capability?.context.renderer ?? "n/a"} / vendor:{" "}
            {capability?.context.vendor ?? "n/a"}
          </div>
          <div>
            max texture size: {capability?.context.maxTextureSize ?? "n/a"}
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-md border border-amber-100/15 bg-amber-50/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-50 transition hover:bg-amber-50/15"
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              void canvas.requestFullscreen();
            }}
          >
            Enter Fullscreen
          </button>
          <button
            type="button"
            class="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:bg-white/10 hover:text-white"
            onClick={() => canvasRef.current?.focus()}
          >
            Focus Canvas
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        class="webgl-experiment-canvas"
      />
      <div class="pointer-events-none absolute bottom-4 right-4 w-[min(24rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-[11px] text-white/80 backdrop-blur">
        <div class="font-semibold uppercase tracking-[0.16em] text-white/55">
          Event Log
        </div>
        <div class="mt-2 space-y-1 font-mono leading-5">
          {logs.length === 0
            ? <div class="text-white/45">waiting for resize or fullscreen...</div>
            : logs.map((entry) => <div key={entry.id}>{entry.text}</div>)}
        </div>
      </div>
    </div>
  );
}
