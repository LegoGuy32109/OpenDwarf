export type TileUniformLocations = {
  canvasSizeLoc: WebGLUniformLocation | null;
  cameraLoc: WebGLUniformLocation | null;
  zoomLoc: WebGLUniformLocation | null;
  textureLoc: WebGLUniformLocation | null;
  tintLoc: WebGLUniformLocation | null;
  alphaMultiplierLoc: WebGLUniformLocation | null;
  renderModeLoc: WebGLUniformLocation | null;
};

export function createAtlasTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error("Failed to create texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function uploadTexImage(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  img: HTMLImageElement,
) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function uploadWhiteTexture(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export function createInstancedQuadBuffers(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  maxInstances: number,
): { vertexBuffer: WebGLBuffer; instanceBuffer: WebGLBuffer } {
  const vertexData = new Float32Array([
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    1,
    0,
    1,
    1,
    1,
    1,
    1,
  ]);

  const vertexBuffer = gl.createBuffer();
  if (!vertexBuffer) throw new Error("Failed to create vertex buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

  const instanceBuffer = gl.createBuffer();
  if (!instanceBuffer) throw new Error("Failed to create instance buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    maxInstances * 8 * Float32Array.BYTES_PER_ELEMENT,
    gl.DYNAMIC_DRAW,
  );

  const positionLocation = gl.getAttribLocation(program, "a_position");
  const uvLocation = gl.getAttribLocation(program, "a_uv");
  const instanceOffsetLocation = gl.getAttribLocation(
    program,
    "a_instance_offset",
  );
  const instanceSizeLocation = gl.getAttribLocation(
    program,
    "a_instance_size",
  );
  const instanceUvLocation = gl.getAttribLocation(program, "a_instance_uv");

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLocation);
  gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 16, 8);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.enableVertexAttribArray(instanceOffsetLocation);
  gl.vertexAttribPointer(instanceOffsetLocation, 2, gl.FLOAT, false, 32, 0);
  gl.vertexAttribDivisor(instanceOffsetLocation, 1);
  gl.enableVertexAttribArray(instanceSizeLocation);
  gl.vertexAttribPointer(instanceSizeLocation, 2, gl.FLOAT, false, 32, 8);
  gl.vertexAttribDivisor(instanceSizeLocation, 1);
  if (instanceUvLocation >= 0) {
    gl.enableVertexAttribArray(instanceUvLocation);
    gl.vertexAttribPointer(instanceUvLocation, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(instanceUvLocation, 1);
  }

  return { vertexBuffer, instanceBuffer };
}

export function getTileUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): TileUniformLocations {
  return {
    canvasSizeLoc: gl.getUniformLocation(program, "u_canvas_size"),
    cameraLoc: gl.getUniformLocation(program, "u_camera"),
    zoomLoc: gl.getUniformLocation(program, "u_zoom"),
    textureLoc: gl.getUniformLocation(program, "u_texture"),
    tintLoc: gl.getUniformLocation(program, "u_tint"),
    alphaMultiplierLoc: gl.getUniformLocation(program, "u_alpha_multiplier"),
    renderModeLoc: gl.getUniformLocation(program, "u_render_mode"),
  };
}
