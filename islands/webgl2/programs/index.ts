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
import { GLOBALS_UNIFORMS } from "./_chunks.ts";

export const MAX_INSTANCES = 8192;

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

export type ProgramResources = {
  programs: Programs;
  instanceBuffer: WebGLBuffer;
  vertexBuffer: WebGLBuffer;
  maxInstances: number;
  floorTexture: WebGLTexture;
  edgeShadowTexture: WebGLTexture;
  ceilShadowTexture: WebGLTexture;
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
    MAX_INSTANCES * FLOOR_STRIDE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    gl.DYNAMIC_DRAW,
  );

  const floor = createFloorProgram(gl, vertexBuffer, instanceBuffer);
  const edgeShadow = createEdgeShadowProgram(gl, vertexBuffer, instanceBuffer);
  const ceilShadow = createCeilShadowProgram(gl, vertexBuffer, instanceBuffer);

  const floorTexture = createTextureSlot(gl, TEXTURE_UNITS.floor);
  const edgeShadowTexture = createTextureSlot(gl, TEXTURE_UNITS.edgeShadow);
  const ceilShadowTexture = createTextureSlot(gl, TEXTURE_UNITS.ceilShadow);
  const whiteTexture = createTextureSlot(gl, TEXTURE_UNITS.white);

  assertNoGlError(gl, "program init");

  return {
    programs: { floor, edgeShadow, ceilShadow },
    instanceBuffer,
    vertexBuffer,
    maxInstances: MAX_INSTANCES,
    floorTexture,
    edgeShadowTexture,
    ceilShadowTexture,
    whiteTexture,
  };
}
