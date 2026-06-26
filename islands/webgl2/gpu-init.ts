const GL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  powerPreference: "high-performance",
};

export type WebGl2Capabilities = {
  version: string;
  shadingLanguageVersion: string;
  vendor: string;
  renderer: string;
  maxTextureSize: number;
  maxRenderbufferSize: number;
  maxVertexAttribs: number;
};

export type WebGl2Boot = {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  capabilities: WebGl2Capabilities;
};

function readGpuString(
  gl: WebGL2RenderingContext,
  debugInfo: WEBGL_debug_renderer_info | null,
  fallbackPname: number,
  debugPname: number,
): string {
  const value = debugInfo
    ? gl.getParameter(debugPname)
    : gl.getParameter(fallbackPname);
  return typeof value === "string" ? value : String(value);
}

export function bootWebGl2Renderer(
  canvas: HTMLCanvasElement,
): WebGl2Boot | null {
  const t0 = performance.now();
  console.info("[webgl2] phase 1 start: sync boot");

  const gl = canvas.getContext("webgl2", GL_CONTEXT_ATTRIBUTES);
  if (!gl) {
    console.warn("[webgl2] phase 1 failed: WebGL2 context unavailable");
    return null;
  }

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const capabilities: WebGl2Capabilities = {
    version: String(gl.getParameter(gl.VERSION)),
    shadingLanguageVersion: String(
      gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    ),
    vendor: readGpuString(
      gl,
      debugInfo,
      gl.VENDOR,
      debugInfo?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR,
    ),
    renderer: readGpuString(
      gl,
      debugInfo,
      gl.RENDERER,
      debugInfo?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER,
    ),
    maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
    maxRenderbufferSize: Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
    maxVertexAttribs: Number(gl.getParameter(gl.MAX_VERTEX_ATTRIBS)),
  };

  const elapsedMs = Math.round(performance.now() - t0);
  console.info(
    `[webgl2] phase 1 done: sync boot (${elapsedMs}ms) — skeleton renderer online`,
  );
  console.info("[webgl2] capability:", capabilities);

  return { gl, canvas, capabilities };
}
