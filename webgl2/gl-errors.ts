/// <reference lib="dom" />

function numberedSource(source: string): string {
  return source
    .split("\n")
    .map((line, idx) => `${String(idx + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
}

function glErrorName(gl: WebGL2RenderingContext, error: number): string {
  switch (error) {
    case gl.NO_ERROR:
      return "NO_ERROR";
    case gl.INVALID_ENUM:
      return "INVALID_ENUM";
    case gl.INVALID_VALUE:
      return "INVALID_VALUE";
    case gl.INVALID_OPERATION:
      return "INVALID_OPERATION";
    case gl.INVALID_FRAMEBUFFER_OPERATION:
      return "INVALID_FRAMEBUFFER_OPERATION";
    case gl.OUT_OF_MEMORY:
      return "OUT_OF_MEMORY";
    case gl.CONTEXT_LOST_WEBGL:
      return "CONTEXT_LOST_WEBGL";
    default:
      return `0x${error.toString(16)}`;
  }
}

export function assertNoGlError(gl: WebGL2RenderingContext, label: string) {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`[webgl2] ${label}: ${glErrorName(gl, error)}`);
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error(`[webgl2] ${label}: failed to create shader`);
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? "unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(
      `[webgl2] ${label}: shader compile failed\n${info}\n\n${
        numberedSource(source)
      }`,
    );
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  name: string,
  vert: string,
  frag: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) {
    throw new Error(`[webgl2] ${name}: failed to create program`);
  }

  const vertShader = compileShader(gl, gl.VERTEX_SHADER, vert, `${name} vert`);
  const fragShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    frag,
    `${name} frag`,
  );
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);
  gl.deleteShader(vertShader);
  gl.deleteShader(fragShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`[webgl2] ${name}: program link failed\n${info}`);
  }

  return program;
}
