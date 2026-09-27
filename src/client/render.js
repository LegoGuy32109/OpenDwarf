// @ts-check

import { renderPosition, Z_LEVELS_BELOW } from "../shared/world.js";
import { entityOpacity, tileVisibility } from "../shared/visibility.js";
import {
  ceilingMask,
  DEPTH_TINTS,
  elevationMask,
  playerOccluded,
  shadowMaskToAtlasId,
  surfaceAt,
} from "../shared/surface.js";

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
/** @typedef {import('../shared/visibility.js').Visibility} Visibility */
/** @typedef {{world:World,localId:string,menu:boolean,menuPage:string,uiScale:number,zoom:number,viewZ:number,viewMode:string,inputMode:string,hudUntil:number,touchGesture:boolean,visibility:Visibility,camera:{x:number,y:number},renderOffset:{x:number,y:number,z:number},presentation:ReturnType<typeof import('./presentation.js').createPresentation>,chatOpen:boolean,chatDraft:string,status:string}} Scene */

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
  const [floorImage, spriteImage, fontImage, edgeImage, ceilingImage] =
    /** @type {HTMLImageElement[]} */ (
      await Promise.all([
        image("/assets/floor.png"),
        image("/assets/dwarf.png"),
        image("/assets/font.png"),
        image("/assets/edge.png"),
        image("/assets/ceiling.png"),
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
    edge: texture(gl, edgeImage),
    ceiling: texture(gl, ceilingImage),
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
    const zoom = dpr * scene.zoom;
    const cameraX = scene.camera.x;
    const cameraY = scene.camera.y;
    gl.uniform2f(locationCamera, cameraX, cameraY);
    gl.uniform1f(locationZoom, zoom);
    const left = Math.floor((cameraX - width / (2 * zoom)) / TILE) - 1;
    const right = Math.ceil((cameraX + width / (2 * zoom)) / TILE) + 1;
    const top = Math.floor((cameraY - height / (2 * zoom)) / TILE) - 1;
    const bottom = Math.ceil((cameraY + height / (2 * zoom)) / TILE) + 1;
    /** @type {Map<string,ReturnType<typeof surfaceAt>>} */
    const surfaces = new Map();
    /** @param {number} x @param {number} y */
    const surface = (x, y) => {
      const key = `${x},${y}`;
      if (!surfaces.has(key)) {
        surfaces.set(
          key,
          surfaceAt(x, y, scene.viewZ, scene.viewMode, scene.visibility),
        );
      }
      return surfaces.get(key) ?? null;
    };
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const tile = surface(x, y);
        if (!tile) continue;
        const tint = tile.seen === "remembered"
          ? [1, 0.86, 0.34]
          : DEPTH_TINTS[tile.depth];
        quad(
          textures.floor,
          false,
          x * TILE,
          y * TILE,
          TILE,
          TILE,
          [0, 5 / 31, 1, 1 / 31],
          /** @type {[number,number,number,number]} */ ([
            ...tint,
            tile.seen === "remembered" ? 0.95 : 1,
          ]),
        );
      }
    }
    flush();
    // The authored edge atlas covers the corner mask; narrow bands preserve the old ledge shading.
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const mask = elevationMask(
          x,
          y,
          scene.viewZ,
          scene.viewMode,
          scene.visibility,
        );
        if (!mask) continue;
        const frame = shadowMaskToAtlasId(mask) - 1;
        quad(
          textures.edge,
          false,
          (x + 0.5) * TILE,
          (y + 0.5) * TILE,
          TILE,
          TILE,
          [0, frame / 15, 1, 1 / 15],
          [1, 1, 1, 0.4],
        );
      }
    }
    flush();
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const here = surface(x, y);
        if (!here) continue;
        const rightTile = surface(x + 1, y);
        const downTile = surface(x, y + 1);
        if (rightTile?.depth !== here.depth) {
          const lowerRight = !rightTile || rightTile.depth > here.depth;
          const edgeX = (x + 1) * TILE;
          quad(
            textures.white,
            false,
            edgeX + (lowerRight ? 0 : -4),
            y * TILE,
            4,
            TILE,
            [0, 0, 1, 1],
            [0, 0, 0, 0.28],
          );
          quad(
            textures.white,
            false,
            edgeX + (lowerRight ? 4 : -8),
            y * TILE,
            4,
            TILE,
            [0, 0, 1, 1],
            [0, 0, 0, 0.11],
          );
        }
        if (downTile?.depth !== here.depth) {
          const lowerDown = !downTile || downTile.depth > here.depth;
          const edgeY = (y + 1) * TILE;
          quad(
            textures.white,
            false,
            x * TILE,
            edgeY + (lowerDown ? 0 : -4),
            TILE,
            4,
            [0, 0, 1, 1],
            [0, 0, 0, 0.28],
          );
          quad(
            textures.white,
            false,
            x * TILE,
            edgeY + (lowerDown ? 4 : -8),
            TILE,
            4,
            [0, 0, 1, 1],
            [0, 0, 0, 0.11],
          );
        }
      }
    }
    flush();
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const mask = ceilingMask(
          x,
          y,
          scene.viewZ,
          scene.viewMode,
          scene.visibility,
        );
        if (!mask) continue;
        const frame = shadowMaskToAtlasId(mask) - 1;
        quad(
          textures.ceiling,
          false,
          (x + 0.5) * TILE,
          (y + 0.5) * TILE,
          TILE,
          TILE,
          [0, frame / 15, 1, 1 / 15],
          [1, 1, 1, 0.55],
        );
      }
    }
    flush();
    const players = Object.values(scene.world.players).map((player) =>
      scene.presentation.playerAt(
        player,
        scene.world.tick + alpha,
        player.id === scene.localId,
      )
    );
    /** @type {Map<string,number>} */
    const opacity = new Map();
    for (const player of players) {
      let visible = scene.viewMode === "master"
        ? 1
        : entityOpacity(player, scene.world.tick + alpha, (x, y, z) =>
          tileVisibility(scene.visibility, x, y, z) === "visible");
      if (
        playerOccluded(player, scene.viewZ) ||
        player.z < scene.viewZ - Z_LEVELS_BELOW
      ) visible = 0;
      opacity.set(player.id, visible);
      if (visible <= 0) continue;
      const pos = renderPosition(player, scene.world.tick + alpha);
      const offset = player.id === scene.localId
        ? scene.renderOffset
        : { x: 0, y: 0, z: 0 };
      const uv = player.facingLeft ? [1, 0, -1, 1] : [0, 0, 1, 1];
      const tint = pos.z < scene.viewZ
        ? DEPTH_TINTS[Math.min(scene.viewZ - Math.floor(pos.z), 5)]
        : [1, 1, 1];
      quad(
        textures.sprite,
        false,
        (pos.x + offset.x) * TILE,
        (pos.y + offset.y) * TILE,
        TILE,
        TILE,
        /** @type {[number,number,number,number]} */ (uv),
        /** @type {[number,number,number,number]} */ ([...tint, visible]),
      );
    }
    flush();
    const scale = Math.max(1, Math.round(dpr * 1.5 * scene.uiScale));
    for (const player of players) {
      const visible = opacity.get(player.id) ?? 0;
      if (visible <= 0) continue;
      const pos = renderPosition(player, scene.world.tick + alpha);
      const offset = player.id === scene.localId
        ? scene.renderOffset
        : { x: 0, y: 0, z: 0 };
      const sx = ((pos.x + offset.x) * TILE + TILE / 2 - cameraX) * zoom +
        width / 2;
      const sy = ((pos.y + offset.y) * TILE - cameraY) * zoom + height / 2;
      if (player.name) {
        text(
          player.name,
          sx - player.name.length * 4 * scale,
          sy + TILE * zoom + 4 * dpr,
          scale,
          [0.95, 0.9, 0.78, visible],
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
        rect(bx, by, bubbleWidth, 20 * scale, [
          0.06,
          0.06,
          0.06,
          0.85 * visible,
        ]);
        text(bubble, bx + 8 * scale, by + 2 * scale, scale, [
          0.95,
          0.9,
          0.78,
          visible,
        ]);
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
    if (scene.touchGesture || performance.now() < scene.hudUntil) {
      const value = `Z ${scene.viewZ}  ZOOM ${scene.zoom.toFixed(2)}`;
      const hudWidth = (value.length * 8 + 16) * scale;
      const x = Math.max(8 * dpr, width - hudWidth - 10 * dpr);
      rect(x, 10 * dpr, hudWidth, 20 * scale, [0.06, 0.08, 0.12, 0.75]);
      text(value, x + 8 * scale, 12 * dpr, scale, [1, 0.86, 0.56, 1]);
    }
    if (scene.chatOpen) {
      const barX = 12 * dpr;
      const barY = height - 54 * dpr;
      rect(barX, barY, width - barX * 2, 30 * dpr, [0.1, 0.1, 0.1, 0.9]);
      text(`> ${scene.chatDraft}_`, barX + 8 * dpr, barY + 3 * dpr, scale);
    }
    if (scene.menu) {
      rect(0, 0, width, height, [0, 0, 0, 0.55]);
      const panelWidth = Math.min(320, canvas.clientWidth - 20) * dpr;
      const panelHeight = Math.min(300, canvas.clientHeight - 20) * dpr;
      const x = (width - panelWidth) / 2;
      const y = (height - panelHeight) / 2;
      rect(x, y, panelWidth, panelHeight, [0.08, 0.09, 0.1, 0.96]);
      rect(
        x + 2 * dpr,
        y + 2 * dpr,
        panelWidth - 4 * dpr,
        panelHeight - 4 * dpr,
        [0.2, 0.21, 0.22, 0.85],
      );
      const menuScale = Math.max(1, Math.round(dpr * 1.25));
      /** @param {string} value @param {number} row */
      const centerText = (value, row) =>
        text(
          value,
          width / 2 - value.length * 4 * menuScale,
          y + row * dpr,
          menuScale,
        );
      if (scene.menuPage === "settings") {
        centerText("Settings", 16);
        centerText("UI Scale", 56);
        centerText(`-   ${scene.uiScale.toFixed(2)}   +`, 96);
        centerText("Back", 136);
      } else {
        centerText("Open Dwarf", 12);
        centerText("Resume", 45);
        centerText("Settings", 78);
        centerText("Leave Game", 111);
        rect(x + 12 * dpr, y + 145 * dpr, panelWidth - 24 * dpr, 1 * dpr, [
          0.58,
          0.55,
          0.47,
          0.7,
        ]);
        const hints = scene.inputMode === "touch"
          ? [
            "LEFT STICK MOVE",
            "RIGHT STICK CAMERA",
            "PINCH TO ZOOM",
            "TWO FINGERS DRAG Z",
            "A CHAT  B MENU",
          ]
          : [
            "ESDF MOVE  IJKL LOOK",
            "R V LEVEL  U N ZOOM",
            "T CHAT  / COMMAND",
            "ESC MENU",
          ];
        for (let i = 0; i < hints.length; i++) {
          centerText(hints[i], 157 + i * 25);
        }
      }
    }
    flush();
  }

  return { render };
}
