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

export type ProgramResources = {
  programs: Programs;
  instanceBuffer: WebGLBuffer;
  vertexBuffer: WebGLBuffer;
  maxInstances: number;
  floorTexture: WebGLTexture;
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

  const floorTexture = createTextureSlot(gl, TEXTURE_UNITS.floor);
  const whiteTexture = createTextureSlot(gl, TEXTURE_UNITS.white);

  assertNoGlError(gl, "program init");

  return {
    programs: { floor },
    instanceBuffer,
    vertexBuffer,
    maxInstances: MAX_INSTANCES,
    floorTexture,
    whiteTexture,
  };
}
