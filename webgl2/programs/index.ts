/// <reference lib="dom" />

import { assertNoGlError, createProgram } from "../gl-errors.ts";
import { createTextureSlot, TEXTURE_UNITS } from "../texture-units.ts";
import type { ProgramHandle, Programs } from "../gpu-types.ts";
import {
  attribs as floorAttribs,
  FLOOR_STRIDE_FLOATS,
  frag as floorFrag,
  sampler as floorSampler,
  vert as floorVert,
} from "./floor.ts";
import {
  attribs as edgeAttribs,
  EDGE_SHADOW_STRIDE_FLOATS,
  frag as edgeFrag,
  sampler as edgeSampler,
  vert as edgeVert,
} from "./edge-shadow.ts";
import {
  attribs as ceilAttribs,
  CEIL_SHADOW_STRIDE_FLOATS,
  frag as ceilFrag,
  sampler as ceilSampler,
  vert as ceilVert,
} from "./ceil-shadow.ts";
import {
  attribs as fogAttribs,
  FOG_STRIDE_FLOATS,
  frag as fogFrag,
  sampler as fogSampler,
  vert as fogVert,
} from "./fog.ts";
import {
  attribs as spriteAttribs,
  frag as spriteFrag,
  sampler as spriteSampler,
  SPRITE_STRIDE_FLOATS,
  vert as spriteVert,
} from "./sprite.ts";
import {
  attribs as uiRectAttribs,
  frag as uiRectFrag,
  sampler as uiRectSampler,
  UI_RECT_STRIDE_FLOATS,
  vert as uiRectVert,
} from "./ui-rect.ts";
import {
  attribs as uiTextAttribs,
  frag as uiTextFrag,
  sampler as uiTextSampler,
  UI_TEXT_STRIDE_FLOATS,
  vert as uiTextVert,
} from "./ui-text.ts";
import { GLOBALS_UNIFORMS } from "./_chunks.ts";

export const MAX_INSTANCES = 8192;
export const MAX_INSTANCE_STRIDE_FLOATS = Math.max(
  FLOOR_STRIDE_FLOATS,
  EDGE_SHADOW_STRIDE_FLOATS,
  CEIL_SHADOW_STRIDE_FLOATS,
  FOG_STRIDE_FLOATS,
  SPRITE_STRIDE_FLOATS,
);

function bindFloorGlobals(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  camera: { x: number; y: number; zoom: number },
  zoom: number,
  canvasSize: { width: number; height: number },
  simTick: number,
) {
  const cameraLoc = gl.getUniformLocation(program, GLOBALS_UNIFORMS.camera);
  const zoomLoc = gl.getUniformLocation(program, GLOBALS_UNIFORMS.zoom);
  const canvasSizeLoc = gl.getUniformLocation(
    program,
    GLOBALS_UNIFORMS.canvasSize,
  );
  const simTickLoc = gl.getUniformLocation(program, GLOBALS_UNIFORMS.simTick);
  if (cameraLoc) gl.uniform2f(cameraLoc, camera.x, camera.y);
  if (zoomLoc) gl.uniform1f(zoomLoc, zoom);
  if (canvasSizeLoc) {
    gl.uniform2f(canvasSizeLoc, canvasSize.width, canvasSize.height);
  }
  if (simTickLoc) gl.uniform1f(simTickLoc, simTick);
}

function createFloorProgram(
  gl: WebGL2RenderingContext,
  vertexBuffer: WebGLBuffer,
  instanceBuffer: WebGLBuffer,
): ProgramHandle {
  const handle = createProgram(gl, "floor", floorVert, floorFrag);
  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error("[webgl2] floor: failed to create VAO");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(floorAttribs.corner);
  gl.vertexAttribPointer(floorAttribs.corner, 2, gl.FLOAT, false, 8, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(floorAttribs.pos);
  gl.vertexAttribPointer(
    floorAttribs.pos,
    2,
    gl.FLOAT,
    false,
    FLOOR_STRIDE_FLOATS * 4,
    0,
  );
  gl.vertexAttribDivisor(floorAttribs.pos, 1);

  gl.enableVertexAttribArray(floorAttribs.frame);
  gl.vertexAttribPointer(
    floorAttribs.frame,
    1,
    gl.FLOAT,
    false,
    FLOOR_STRIDE_FLOATS * 4,
    8,
  );
  gl.vertexAttribDivisor(floorAttribs.frame, 1);

  gl.enableVertexAttribArray(floorAttribs.tint);
  gl.vertexAttribPointer(
    floorAttribs.tint,
    3,
    gl.FLOAT,
    false,
    FLOOR_STRIDE_FLOATS * 4,
    12,
  );
  gl.vertexAttribDivisor(floorAttribs.tint, 1);

  gl.enableVertexAttribArray(floorAttribs.alpha);
  gl.vertexAttribPointer(
    floorAttribs.alpha,
    1,
    gl.FLOAT,
    false,
    FLOOR_STRIDE_FLOATS * 4,
    24,
  );
  gl.vertexAttribDivisor(floorAttribs.alpha, 1);
  gl.bindVertexArray(null);

  gl.useProgram(handle);
  const samplerLoc = gl.getUniformLocation(handle, "u_texture");
  if (samplerLoc) {
    gl.uniform1i(samplerLoc, floorSampler);
  }
  gl.useProgram(null);

  return {
    name: "floor",
    handle,
    vao,
    strideFloats: FLOOR_STRIDE_FLOATS,
    setGlobals: (camera, zoom, canvasSize, simTick) => {
      gl.useProgram(handle);
      bindFloorGlobals(gl, handle, camera, zoom, canvasSize, simTick);
    },
  };
}

function bindQuadGlobals(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  camera: { x: number; y: number; zoom: number },
  zoom: number,
  canvasSize: { width: number; height: number },
  simTick: number,
) {
  const cameraLoc = gl.getUniformLocation(program, GLOBALS_UNIFORMS.camera);
  const zoomLoc = gl.getUniformLocation(program, GLOBALS_UNIFORMS.zoom);
  const canvasSizeLoc = gl.getUniformLocation(
    program,
    GLOBALS_UNIFORMS.canvasSize,
  );
  const simTickLoc = gl.getUniformLocation(program, GLOBALS_UNIFORMS.simTick);
  if (cameraLoc) gl.uniform2f(cameraLoc, camera.x, camera.y);
  if (zoomLoc) gl.uniform1f(zoomLoc, zoom);
  if (canvasSizeLoc) {
    gl.uniform2f(canvasSizeLoc, canvasSize.width, canvasSize.height);
  }
  if (simTickLoc) gl.uniform1f(simTickLoc, simTick);
}

function bindScreenGlobals(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  canvasSize: { width: number; height: number },
  simTick: number,
) {
  const canvasSizeLoc = gl.getUniformLocation(
    program,
    GLOBALS_UNIFORMS.canvasSize,
  );
  const simTickLoc = gl.getUniformLocation(program, GLOBALS_UNIFORMS.simTick);
  if (canvasSizeLoc) {
    gl.uniform2f(canvasSizeLoc, canvasSize.width, canvasSize.height);
  }
  if (simTickLoc) gl.uniform1f(simTickLoc, simTick);
}

function bindSampler(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  uniformName: string,
  unit: number,
) {
  const samplerLoc = gl.getUniformLocation(program, uniformName);
  if (samplerLoc) {
    gl.uniform1i(samplerLoc, unit);
  }
}

function createEdgeShadowProgram(
  gl: WebGL2RenderingContext,
  vertexBuffer: WebGLBuffer,
  instanceBuffer: WebGLBuffer,
): ProgramHandle {
  const handle = createProgram(gl, "edge-shadow", edgeVert, edgeFrag);
  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error("[webgl2] edge-shadow: failed to create VAO");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(edgeAttribs.corner);
  gl.vertexAttribPointer(edgeAttribs.corner, 2, gl.FLOAT, false, 8, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(edgeAttribs.pos);
  gl.vertexAttribPointer(
    edgeAttribs.pos,
    2,
    gl.FLOAT,
    false,
    EDGE_SHADOW_STRIDE_FLOATS * 4,
    0,
  );
  gl.vertexAttribDivisor(edgeAttribs.pos, 1);

  gl.enableVertexAttribArray(edgeAttribs.size);
  gl.vertexAttribPointer(
    edgeAttribs.size,
    2,
    gl.FLOAT,
    false,
    EDGE_SHADOW_STRIDE_FLOATS * 4,
    8,
  );
  gl.vertexAttribDivisor(edgeAttribs.size, 1);

  gl.enableVertexAttribArray(edgeAttribs.alpha);
  gl.vertexAttribPointer(
    edgeAttribs.alpha,
    1,
    gl.FLOAT,
    false,
    EDGE_SHADOW_STRIDE_FLOATS * 4,
    16,
  );
  gl.vertexAttribDivisor(edgeAttribs.alpha, 1);
  gl.bindVertexArray(null);

  gl.useProgram(handle);
  bindSampler(gl, handle, "u_texture", edgeSampler);
  gl.useProgram(null);

  return {
    name: "edge-shadow",
    handle,
    vao,
    strideFloats: EDGE_SHADOW_STRIDE_FLOATS,
    setGlobals: (camera, zoom, canvasSize, simTick) => {
      gl.useProgram(handle);
      bindQuadGlobals(gl, handle, camera, zoom, canvasSize, simTick);
    },
  };
}

function createCeilShadowProgram(
  gl: WebGL2RenderingContext,
  vertexBuffer: WebGLBuffer,
  instanceBuffer: WebGLBuffer,
): ProgramHandle {
  const handle = createProgram(gl, "ceil-shadow", ceilVert, ceilFrag);
  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error("[webgl2] ceil-shadow: failed to create VAO");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(ceilAttribs.corner);
  gl.vertexAttribPointer(ceilAttribs.corner, 2, gl.FLOAT, false, 8, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(ceilAttribs.pos);
  gl.vertexAttribPointer(
    ceilAttribs.pos,
    2,
    gl.FLOAT,
    false,
    CEIL_SHADOW_STRIDE_FLOATS * 4,
    0,
  );
  gl.vertexAttribDivisor(ceilAttribs.pos, 1);

  gl.enableVertexAttribArray(ceilAttribs.frame);
  gl.vertexAttribPointer(
    ceilAttribs.frame,
    1,
    gl.FLOAT,
    false,
    CEIL_SHADOW_STRIDE_FLOATS * 4,
    8,
  );
  gl.vertexAttribDivisor(ceilAttribs.frame, 1);

  gl.enableVertexAttribArray(ceilAttribs.alpha);
  gl.vertexAttribPointer(
    ceilAttribs.alpha,
    1,
    gl.FLOAT,
    false,
    CEIL_SHADOW_STRIDE_FLOATS * 4,
    12,
  );
  gl.vertexAttribDivisor(ceilAttribs.alpha, 1);
  gl.bindVertexArray(null);

  gl.useProgram(handle);
  bindSampler(gl, handle, "u_texture", ceilSampler);
  gl.useProgram(null);

  return {
    name: "ceil-shadow",
    handle,
    vao,
    strideFloats: CEIL_SHADOW_STRIDE_FLOATS,
    setGlobals: (camera, zoom, canvasSize, simTick) => {
      gl.useProgram(handle);
      bindQuadGlobals(gl, handle, camera, zoom, canvasSize, simTick);
    },
  };
}

function createFogProgram(
  gl: WebGL2RenderingContext,
  vertexBuffer: WebGLBuffer,
  instanceBuffer: WebGLBuffer,
): ProgramHandle {
  const handle = createProgram(gl, "fog", fogVert, fogFrag);
  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error("[webgl2] fog: failed to create VAO");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(fogAttribs.corner);
  gl.vertexAttribPointer(fogAttribs.corner, 2, gl.FLOAT, false, 8, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(fogAttribs.pos);
  gl.vertexAttribPointer(
    fogAttribs.pos,
    2,
    gl.FLOAT,
    false,
    FOG_STRIDE_FLOATS * 4,
    0,
  );
  gl.vertexAttribDivisor(fogAttribs.pos, 1);

  gl.enableVertexAttribArray(fogAttribs.alpha);
  gl.vertexAttribPointer(
    fogAttribs.alpha,
    1,
    gl.FLOAT,
    false,
    FOG_STRIDE_FLOATS * 4,
    8,
  );
  gl.vertexAttribDivisor(fogAttribs.alpha, 1);
  gl.bindVertexArray(null);

  gl.useProgram(handle);
  bindSampler(gl, handle, "u_texture", fogSampler);
  gl.useProgram(null);

  return {
    name: "fog",
    handle,
    vao,
    strideFloats: FOG_STRIDE_FLOATS,
    setGlobals: (camera, zoom, canvasSize, simTick) => {
      gl.useProgram(handle);
      bindQuadGlobals(gl, handle, camera, zoom, canvasSize, simTick);
    },
  };
}

function createSpriteProgram(
  gl: WebGL2RenderingContext,
  vertexBuffer: WebGLBuffer,
  instanceBuffer: WebGLBuffer,
): ProgramHandle {
  const handle = createProgram(gl, "sprite", spriteVert, spriteFrag);
  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error("[webgl2] sprite: failed to create VAO");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(spriteAttribs.corner);
  gl.vertexAttribPointer(spriteAttribs.corner, 2, gl.FLOAT, false, 8, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(spriteAttribs.pos);
  gl.vertexAttribPointer(
    spriteAttribs.pos,
    2,
    gl.FLOAT,
    false,
    SPRITE_STRIDE_FLOATS * 4,
    0,
  );
  gl.vertexAttribDivisor(spriteAttribs.pos, 1);

  gl.enableVertexAttribArray(spriteAttribs.size);
  gl.vertexAttribPointer(
    spriteAttribs.size,
    2,
    gl.FLOAT,
    false,
    SPRITE_STRIDE_FLOATS * 4,
    8,
  );
  gl.vertexAttribDivisor(spriteAttribs.size, 1);

  gl.enableVertexAttribArray(spriteAttribs.uv);
  gl.vertexAttribPointer(
    spriteAttribs.uv,
    4,
    gl.FLOAT,
    false,
    SPRITE_STRIDE_FLOATS * 4,
    16,
  );
  gl.vertexAttribDivisor(spriteAttribs.uv, 1);

  gl.enableVertexAttribArray(spriteAttribs.tint);
  gl.vertexAttribPointer(
    spriteAttribs.tint,
    3,
    gl.FLOAT,
    false,
    SPRITE_STRIDE_FLOATS * 4,
    32,
  );
  gl.vertexAttribDivisor(spriteAttribs.tint, 1);

  gl.enableVertexAttribArray(spriteAttribs.alpha);
  gl.vertexAttribPointer(
    spriteAttribs.alpha,
    1,
    gl.FLOAT,
    false,
    SPRITE_STRIDE_FLOATS * 4,
    44,
  );
  gl.vertexAttribDivisor(spriteAttribs.alpha, 1);
  gl.bindVertexArray(null);

  gl.useProgram(handle);
  bindSampler(gl, handle, "u_texture", spriteSampler);
  gl.useProgram(null);

  return {
    name: "sprite",
    handle,
    vao,
    strideFloats: SPRITE_STRIDE_FLOATS,
    setGlobals: (camera, zoom, canvasSize, simTick) => {
      gl.useProgram(handle);
      bindQuadGlobals(gl, handle, camera, zoom, canvasSize, simTick);
    },
  };
}

function createUiTextProgram(
  gl: WebGL2RenderingContext,
  vertexBuffer: WebGLBuffer,
  instanceBuffer: WebGLBuffer,
): ProgramHandle {
  const handle = createProgram(gl, "ui-text", uiTextVert, uiTextFrag);
  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error("[webgl2] ui-text: failed to create VAO");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(uiTextAttribs.corner);
  gl.vertexAttribPointer(uiTextAttribs.corner, 2, gl.FLOAT, false, 8, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(uiTextAttribs.pos);
  gl.vertexAttribPointer(
    uiTextAttribs.pos,
    2,
    gl.FLOAT,
    false,
    UI_TEXT_STRIDE_FLOATS * 4,
    0,
  );
  gl.vertexAttribDivisor(uiTextAttribs.pos, 1);

  gl.enableVertexAttribArray(uiTextAttribs.size);
  gl.vertexAttribPointer(
    uiTextAttribs.size,
    2,
    gl.FLOAT,
    false,
    UI_TEXT_STRIDE_FLOATS * 4,
    8,
  );
  gl.vertexAttribDivisor(uiTextAttribs.size, 1);

  gl.enableVertexAttribArray(uiTextAttribs.uv);
  gl.vertexAttribPointer(
    uiTextAttribs.uv,
    4,
    gl.FLOAT,
    false,
    UI_TEXT_STRIDE_FLOATS * 4,
    16,
  );
  gl.vertexAttribDivisor(uiTextAttribs.uv, 1);

  gl.enableVertexAttribArray(uiTextAttribs.tint);
  gl.vertexAttribPointer(
    uiTextAttribs.tint,
    3,
    gl.FLOAT,
    false,
    UI_TEXT_STRIDE_FLOATS * 4,
    32,
  );
  gl.vertexAttribDivisor(uiTextAttribs.tint, 1);

  gl.enableVertexAttribArray(uiTextAttribs.alpha);
  gl.vertexAttribPointer(
    uiTextAttribs.alpha,
    1,
    gl.FLOAT,
    false,
    UI_TEXT_STRIDE_FLOATS * 4,
    44,
  );
  gl.vertexAttribDivisor(uiTextAttribs.alpha, 1);
  gl.bindVertexArray(null);

  gl.useProgram(handle);
  bindSampler(gl, handle, "u_texture", uiTextSampler);
  gl.useProgram(null);

  return {
    name: "ui-text",
    handle,
    vao,
    strideFloats: UI_TEXT_STRIDE_FLOATS,
    setGlobals: (_camera, _zoom, canvasSize, simTick) => {
      gl.useProgram(handle);
      bindScreenGlobals(gl, handle, canvasSize, simTick);
    },
  };
}

function createUiRectProgram(
  gl: WebGL2RenderingContext,
  vertexBuffer: WebGLBuffer,
  instanceBuffer: WebGLBuffer,
): ProgramHandle {
  const handle = createProgram(gl, "ui-rect", uiRectVert, uiRectFrag);
  const vao = gl.createVertexArray();
  if (!vao) {
    throw new Error("[webgl2] ui-rect: failed to create VAO");
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(uiRectAttribs.corner);
  gl.vertexAttribPointer(uiRectAttribs.corner, 2, gl.FLOAT, false, 8, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(uiRectAttribs.pos);
  gl.vertexAttribPointer(
    uiRectAttribs.pos,
    2,
    gl.FLOAT,
    false,
    UI_RECT_STRIDE_FLOATS * 4,
    0,
  );
  gl.vertexAttribDivisor(uiRectAttribs.pos, 1);

  gl.enableVertexAttribArray(uiRectAttribs.size);
  gl.vertexAttribPointer(
    uiRectAttribs.size,
    2,
    gl.FLOAT,
    false,
    UI_RECT_STRIDE_FLOATS * 4,
    8,
  );
  gl.vertexAttribDivisor(uiRectAttribs.size, 1);

  gl.enableVertexAttribArray(uiRectAttribs.tint);
  gl.vertexAttribPointer(
    uiRectAttribs.tint,
    3,
    gl.FLOAT,
    false,
    UI_RECT_STRIDE_FLOATS * 4,
    16,
  );
  gl.vertexAttribDivisor(uiRectAttribs.tint, 1);

  gl.enableVertexAttribArray(uiRectAttribs.alpha);
  gl.vertexAttribPointer(
    uiRectAttribs.alpha,
    1,
    gl.FLOAT,
    false,
    UI_RECT_STRIDE_FLOATS * 4,
    28,
  );
  gl.vertexAttribDivisor(uiRectAttribs.alpha, 1);
  gl.bindVertexArray(null);

  gl.useProgram(handle);
  bindSampler(gl, handle, "u_texture", uiRectSampler);
  gl.useProgram(null);

  return {
    name: "ui-rect",
    handle,
    vao,
    strideFloats: UI_RECT_STRIDE_FLOATS,
    setGlobals: (_camera, _zoom, canvasSize, simTick) => {
      gl.useProgram(handle);
      bindScreenGlobals(gl, handle, canvasSize, simTick);
    },
  };
}

export type ProgramResources = {
  programs: Programs;
  instanceBuffer: WebGLBuffer;
  vertexBuffer: WebGLBuffer;
  maxInstances: number;
  maxStrideFloats: number;
  floorTexture: WebGLTexture;
  edgeShadowTexture: WebGLTexture;
  ceilShadowTexture: WebGLTexture;
  spriteTexture: WebGLTexture;
  fontTexture: WebGLTexture;
  whiteTexture: WebGLTexture;
};

export function compilePrograms(gl: WebGL2RenderingContext): ProgramResources {
  const vertexBuffer = gl.createBuffer();
  if (!vertexBuffer) {
    throw new Error("[webgl2] failed to create shared vertex buffer");
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      0,
      0,
      1,
      0,
      0,
      1,
      1,
      1,
    ]),
    gl.STATIC_DRAW,
  );

  const instanceBuffer = gl.createBuffer();
  if (!instanceBuffer) {
    throw new Error("[webgl2] failed to create shared instance buffer");
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    MAX_INSTANCES * MAX_INSTANCE_STRIDE_FLOATS *
      Float32Array.BYTES_PER_ELEMENT,
    gl.DYNAMIC_DRAW,
  );

  const floor = createFloorProgram(gl, vertexBuffer, instanceBuffer);
  const edgeShadow = createEdgeShadowProgram(gl, vertexBuffer, instanceBuffer);
  const ceilShadow = createCeilShadowProgram(gl, vertexBuffer, instanceBuffer);
  const fog = createFogProgram(gl, vertexBuffer, instanceBuffer);
  const sprite = createSpriteProgram(gl, vertexBuffer, instanceBuffer);
  const uiText = createUiTextProgram(gl, vertexBuffer, instanceBuffer);
  const uiRect = createUiRectProgram(gl, vertexBuffer, instanceBuffer);

  const floorTexture = createTextureSlot(gl, TEXTURE_UNITS.floor);
  const edgeShadowTexture = createTextureSlot(gl, TEXTURE_UNITS.edgeShadow);
  const ceilShadowTexture = createTextureSlot(gl, TEXTURE_UNITS.ceilShadow);
  const spriteTexture = createTextureSlot(gl, TEXTURE_UNITS.sprite);
  const fontTexture = createTextureSlot(gl, TEXTURE_UNITS.font);
  const whiteTexture = createTextureSlot(gl, TEXTURE_UNITS.white);

  assertNoGlError(gl, "program init");

  return {
    programs: { floor, edgeShadow, ceilShadow, fog, sprite, uiText, uiRect },
    instanceBuffer,
    vertexBuffer,
    maxInstances: MAX_INSTANCES,
    maxStrideFloats: MAX_INSTANCE_STRIDE_FLOATS,
    floorTexture,
    edgeShadowTexture,
    ceilShadowTexture,
    spriteTexture,
    fontTexture,
    whiteTexture,
  };
}
