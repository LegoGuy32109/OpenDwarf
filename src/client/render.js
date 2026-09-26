// @ts-check

import { renderPosition, WORLD_EDGE } from "../shared/world.js";

const TILE = 64;
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_position;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_color;
uniform vec2 u_size;
uniform vec2 u_camera;
uniform float u_zoom;
uniform int u_screen;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec2 screen = u_screen == 1 ? a_position :
    (a_position - u_camera) * u_zoom + u_size * 0.5;
  gl_Position = vec4((screen / u_size) * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_uv;
in vec4 v_color;
out vec4 color;
void main() { vec4 texel = texture(u_texture, v_uv); color = vec4(texel.rgb * v_color.rgb, texel.a * v_color.a); }`;

/** @param {WebGL2RenderingContext} gl @param {number} kind @param {string} source */
function compile(gl, kind, source) {
  const shader = gl.createShader(kind);
  if (!shader) throw new Error("WebGL2 shader unavailable");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(String(gl.getShaderInfoLog(shader)));
  }
  return shader;
}

/** @param {string} src */
function image(src) {
  return new Promise((resolve, reject) => {
    const result = new Image();
    result.onload = () => resolve(result);
    result.onerror = () => reject(new Error(`Cannot load ${src}`));
    result.src = src;
  });
}

/** @param {WebGL2RenderingContext} gl @param {TexImageSource} source */
function texture(gl, source) {
  const result = gl.createTexture();
  if (!result) throw new Error("WebGL2 texture unavailable");
  gl.bindTexture(gl.TEXTURE_2D, result);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return result;
}

/** @typedef {import('../shared/world.js').World} World */
/** @typedef {{world:World,localId:string,menu:boolean,menuPage:string,uiScale:number,zoom:number,chatOpen:boolean,chatDraft:string,status:string,cameraOffset:{x:number,y:number}}} Scene */

/** @param {HTMLCanvasElement} canvas */
export async function createRenderer(canvas) {
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
  });
  if (!context) throw new Error("WebGL2 is required to play Open Dwarf");
  const gl = /** @type {WebGL2RenderingContext} */ (context);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL2 program unavailable");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(String(gl.getProgramInfoLog(program)));
  }
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("WebGL2 buffer unavailable");
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [index, count, offset] of [[0, 2, 0], [1, 2, 8], [2, 4, 16]]) {
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, count, gl.FLOAT, false, 32, offset);
  }
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const [floorImage, spriteImage, fontImage] =
    /** @type {HTMLImageElement[]} */ (
      await Promise.all([
        image("/assets/floor.png"),
        image("/assets/dwarf.png"),
        image("/assets/font.png"),
      ])
    );
  const whiteImage = document.createElement("canvas");
  whiteImage.width = whiteImage.height = 1;
  const whiteContext = whiteImage.getContext("2d");
  if (whiteContext) {
    whiteContext.fillStyle = "#ffffff";
    whiteContext.fillRect(0, 0, 1, 1);
  }
  const textures = {
    floor: texture(gl, floorImage),
    sprite: texture(gl, spriteImage),
    font: texture(gl, fontImage),
    white: texture(gl, whiteImage),
  };
  const locationSize = gl.getUniformLocation(program, "u_size");
  const locationCamera = gl.getUniformLocation(program, "u_camera");
  const locationZoom = gl.getUniformLocation(program, "u_zoom");
  const locationScreen = gl.getUniformLocation(program, "u_screen");
  /** @type {number[]} */
  let vertices = [];
  /** @type {WebGLTexture|null} */
  let activeTexture = null;
  let activeScreen = false;

  function flush() {
    if (!vertices.length || !activeTexture) return;
    gl.bindTexture(gl.TEXTURE_2D, activeTexture);
    gl.uniform1i(locationScreen, activeScreen ? 1 : 0);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 8);
    vertices = [];
  }

  /** @param {WebGLTexture} tex @param {boolean} screen @param {number} x @param {number} y @param {number} w @param {number} h @param {[number,number,number,number]} uv @param {[number,number,number,number]} [color] */
  function quad(tex, screen, x, y, w, h, uv, color = [1, 1, 1, 1]) {
    if (activeTexture !== tex || activeScreen !== screen) flush();
    activeTexture = tex;
    activeScreen = screen;
    const [u, v, uw, vh] = uv;
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]]) {
      vertices.push(x + cx * w, y + cy * h, u + cx * uw, v + cy * vh, ...color);
    }
  }

  /** @param {string} value @param {number} x @param {number} y @param {number} scale @param {[number,number,number,number]} [color] */
  function text(value, x, y, scale, color = [0.95, 0.9, 0.78, 1]) {
    let cursor = 0;
    for (const char of value.slice(0, 120)) {
      const code = char.charCodeAt(0);
      if (code >= 33 && code <= 126) {
        const glyph = code - 33;
        quad(textures.font, true, x + cursor, y, 8 * scale, 16 * scale, [
          (glyph % 32) / 32,
          Math.floor(glyph / 32) / 3,
          1 / 32,
          1 / 3,
        ], color);
      }
      cursor += 8 * scale;
    }
    return cursor;
  }

  /** @param {number} x @param {number} y @param {number} w @param {number} h @param {[number,number,number,number]} color */
  function rect(x, y, w, h, color) {
    quad(textures.white, true, x, y, w, h, [0, 0, 1, 1], color);
  }

  /** @param {Scene} scene @param {number} alpha */
  function render(scene, alpha) {
    const dpr = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.106, 0.109, 0.122, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.uniform2f(locationSize, width, height);
    const local = scene.world.players[scene.localId];
    const localPos = local
      ? renderPosition(local, scene.world.tick + alpha)
      : { x: 7, y: 7 };
    const zoom = dpr * scene.zoom *
      Math.max(0.75, Math.min(1.25, canvas.clientWidth / 900));
    const cameraX = (localPos.x + 0.5) * TILE + scene.cameraOffset.x;
    const cameraY = (localPos.y + 0.5) * TILE + scene.cameraOffset.y;
    gl.uniform2f(locationCamera, cameraX, cameraY);
    gl.uniform1f(locationZoom, zoom);
    const floorFrame = 5;
    for (let y = 0; y < WORLD_EDGE; y++) {
      for (let x = 0; x < WORLD_EDGE; x++) {
        quad(textures.floor, false, x * TILE, y * TILE, TILE, TILE, [
          0,
          floorFrame / 31,
          1,
          1 / 31,
        ]);
      }
    }
    flush();
    const players = Object.values(scene.world.players);
    for (const player of players) {
      const pos = renderPosition(player, scene.world.tick + alpha);
      const uv = player.facingLeft ? [1, 0, -1, 1] : [0, 0, 1, 1];
      quad(
        textures.sprite,
        false,
        pos.x * TILE,
        pos.y * TILE,
        TILE,
        TILE,
        /** @type {[number,number,number,number]} */ (uv),
      );
    }
    flush();
    const scale = Math.max(1, Math.round(dpr * 1.5 * scene.uiScale));
    for (const player of players) {
      const pos = renderPosition(player, scene.world.tick + alpha);
      const sx = (pos.x * TILE + TILE / 2 - cameraX) * zoom + width / 2;
      const sy = (pos.y * TILE - cameraY) * zoom + height / 2;
      if (player.name) {
        text(
          player.name,
          sx - player.name.length * 4 * scale,
          sy + TILE * zoom + 4 * dpr,
          scale,
        );
      }
      const bubble = player.message || (player.typing ? "[...]" : "");
      if (bubble) {
        const bubbleWidth = Math.min(
          width - 20 * dpr,
          (bubble.length * 8 + 16) * scale,
        );
        const bx = Math.max(
          8 * dpr,
          Math.min(width - bubbleWidth - 8 * dpr, sx - bubbleWidth / 2),
        );
        const by = Math.max(8 * dpr, sy - 28 * scale);
        rect(bx, by, bubbleWidth, 20 * scale, [0.06, 0.06, 0.06, 0.85]);
        text(bubble, bx + 8 * scale, by + 2 * scale, scale);
      }
    }
    const status = scene.status.slice(0, 75);
    if (status) {
      rect(
        10 * dpr,
        10 * dpr,
        Math.min(width - 20 * dpr, (status.length * 8 + 12) * scale),
        20 * scale,
        [0.05, 0.05, 0.05, 0.75],
      );
      text(status, 16 * dpr, 12 * dpr, scale);
    }
    if (scene.chatOpen) {
      const barX = 12 * dpr;
      const barY = height - 54 * dpr;
      rect(barX, barY, width - barX * 2, 30 * dpr, [0.1, 0.1, 0.1, 0.9]);
      text(`> ${scene.chatDraft}_`, barX + 8 * dpr, barY + 3 * dpr, scale);
    }
    if (scene.menu) {
      rect(0, 0, width, height, [0, 0, 0, 0.55]);
      rect(
        width / 2 - 140 * dpr,
        height / 2 - 100 * dpr,
        280 * dpr,
        200 * dpr,
        [0.09, 0.1, 0.11, 0.95],
      );
      rect(width / 2 - 138 * dpr, height / 2 - 98 * dpr, 276 * dpr, 196 * dpr, [
        0.2,
        0.21,
        0.22,
        0.85,
      ]);
      const menuScale = Math.max(1, Math.round(dpr * 1.5));
      /** @param {string} value @param {number} y */
      const centerText = (value, y) =>
        text(
          value,
          width / 2 - value.length * 4 * menuScale,
          height / 2 + y * dpr,
          menuScale,
        );
      if (scene.menuPage === "settings") {
        centerText("Settings", -70);
        centerText("UI Scale", -27);
        centerText(`-   ${scene.uiScale.toFixed(2)}   +`, 14);
        centerText("Back", 59);
      } else {
        centerText("Open Dwarf", -70);
        centerText("Resume", -27);
        centerText("Settings", 14);
        centerText("Leave Game", 59);
      }
    }
    flush();
  }

  return { render };
}
