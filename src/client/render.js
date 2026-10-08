// @ts-check

import {
  chatView,
  liveBubbleItems,
  receiveChat,
  TEXT_SIZE_SCALE,
  thoughtDotLifts,
} from "../shared/chat.js";
import {
  revealedLength,
  speechSchedule,
  voiceFromId,
} from "../shared/speech.js";
import { Z_LEVELS_BELOW } from "../shared/world.js";
import { materialInfo, ORE_FRAMES } from "../shared/materials.js";
import { readTile } from "../shared/terrain.js";
import { CURSOR_ICON_SIZE, CURSOR_OUTLINE, localCursor } from "./cursor.js";
import { decalFrame } from "../shared/mining.js";
import { cycleIndex, ITEM_FRAMES, itemInfo } from "../shared/items.js";
import { SHOP_TILE } from "../shared/shop.js";
import { entityOpacity, tileVisibility } from "../shared/visibility.js";
import { drawUi } from "./ui-draw.js";
import { viewMotionOpacity } from "../shared/view.js";
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
    // Builds load assets from another origin (jsDelivr), which WebGL needs CORS for.
    result.crossOrigin = "anonymous";
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
/** @typedef {{world:World,localId:string,menu:boolean,menuPage:string,uiScale:number,zoom:number,viewZ:number,viewMode:"entity"|"master",inputMode:string,hudUntil:number,touchGesture:boolean,visibility:Visibility,camera:{x:number,y:number},aim:{x:number,y:number},renderOffset:{x:number,y:number,z:number},presentation:ReturnType<typeof import('./presentation.js').createPresentation>,chatFeed:import('../shared/chat.js').DisplayChatRecord[],textSize:import('../shared/chat.js').TextSize,chatOpen:boolean,chatDraft:string,status:string,notice?:{text:string,until:number},ui?:{layout:import('./ui.js').UiLayout,state:import('./ui-draw.js').DrawState},mining?:{id:string,x:number,y:number,z:number,progress:number}[],items?:import('../shared/items.js').DroppedEntry[],pickupCells?:import('./pickup-grid.js').GridCell[],layout?:"room"|"test"}} Scene */

/**
 * Placeholder breaking decal. Each frame adds cracks, as [x, y, width, height]
 * in 16×16 pixel units; frame n draws the pieces of frames 0 through n.
 * @type {readonly (readonly (readonly [number,number,number,number])[])[]}
 */
const DECAL_PIECES = [
  [[7, 6, 2, 3]],
  [[5, 4, 2, 2], [9, 9, 2, 2], [7, 3, 2, 3]],
  [[2, 8, 5, 2], [9, 2, 2, 5], [10, 11, 4, 2]],
  [[2, 2, 4, 2], [11, 5, 4, 2], [6, 10, 2, 5], [3, 12, 3, 2]],
  [[1, 5, 4, 2], [11, 8, 4, 2], [8, 0, 2, 6], [13, 12, 2, 3], [3, 3, 2, 6]],
];

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
  // The font loads first, so the loading screen can draw text while the rest loads.
  const fontImage = await image("assets/font.png");
  const whiteImage = document.createElement("canvas");
  whiteImage.width = whiteImage.height = 1;
  const whiteContext = whiteImage.getContext("2d");
  if (whiteContext) {
    whiteContext.fillStyle = "#ffffff";
    whiteContext.fillRect(0, 0, 1, 1);
  }
  /** @type {Record<string,WebGLTexture>} */
  const textures = {
    font: texture(gl, fontImage),
    white: texture(gl, whiteImage),
  };
  let loaded = false;
  /** Resolves when the world's textures are ready; rejects when one cannot load. */
  const ready = Promise.all([
    image("assets/floor.png"),
    image("assets/dwarf.png"),
    image("assets/edge.png"),
    image("assets/ceiling.png"),
    image("assets/ores.png"),
    image("assets/items.png"),
  ]).then((images) => {
    const [floor, sprite, edge, ceiling, ores, items] =
      /** @type {HTMLImageElement[]} */ (images);
    textures.floor = texture(gl, floor);
    textures.sprite = texture(gl, sprite);
    textures.edge = texture(gl, edge);
    textures.ceiling = texture(gl, ceiling);
    textures.ores = texture(gl, ores);
    textures.items = texture(gl, items);
    loaded = true;
  });
  /** The join QR code, drawn by the UI layer. @type {WebGLTexture|null} */
  let qrTexture = null;
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

  /**
   * The thought icon (ADR 0006): a small white speech bubble with a dark
   * outline, three rising dots, and a short tail pointing down toward the head.
   * `x`, `y` are the top-left of the icon; `unit` is one icon pixel.
   * @param {number} x @param {number} y @param {number} unit @param {number} now
   */
  function thoughtIcon(x, y, unit, now) {
    const dark = /** @type {[number,number,number,number]} */ ([
      0.08,
      0.08,
      0.1,
      1,
    ]);
    const white = /** @type {[number,number,number,number]} */ ([1, 1, 1, 1]);
    /** @param {number} u0 @param {number} v0 @param {number} w @param {number} h @param {[number,number,number,number]} color */
    const cell = (u0, v0, w, h, color) => {
      const x0 = Math.round(x + u0 * unit);
      const y0 = Math.round(y + v0 * unit);
      rect(
        x0,
        y0,
        Math.round(x + (u0 + w) * unit) - x0,
        Math.round(y + (v0 + h) * unit) - y0,
        color,
      );
    };
    cell(0, 0, 15, 10, dark);
    cell(1, 1, 13, 8, white);
    cell(9, 10, 4, 1, dark);
    cell(10, 9, 2, 2, white);
    cell(10, 11, 2, 1, dark);
    for (const [n, lift] of thoughtDotLifts(now).entries()) {
      cell(2 + n * 4, 4 - lift * 2, 2, 2, dark);
    }
  }

  /** Speech schedules per bubble, built once rather than every frame. @type {Map<string,import('../shared/speech.js').SpeechSchedule>} */
  const schedules = new Map();
  /** @param {string} id @param {string} text */
  function scheduleFor(id, text) {
    const key = `${id}\0${text}`;
    let schedule = schedules.get(key);
    if (!schedule) {
      if (schedules.size >= 200) schedules.clear();
      schedule = speechSchedule(text, voiceFromId(id));
      schedules.set(key, schedule);
    }
    return schedule;
  }

  /** The local player's own chat while the feed lacks it, timed like any feed. @type {import('../shared/chat.js').DisplayChatRecord[]} */
  let echoFeed = [];

  /** @param {Scene} scene @param {number} dpr */
  function drawInterface(scene, dpr) {
    if (!scene.ui) return;
    const toDevice = (/** @type {number} */ value) => Math.round(value * dpr);
    /** @type {import('./ui-draw.js').Painter} */
    const paint = {
      rect(x, y, w, h, color) {
        const x0 = toDevice(x);
        const y0 = toDevice(y);
        rect(x0, y0, toDevice(x + w) - x0, toDevice(y + h) - y0, color);
      },
      text(value, x, y, textScale, color) {
        text(
          value,
          toDevice(x),
          toDevice(y),
          Math.max(1, Math.round(textScale * dpr)),
          color,
        );
      },
      item(kind, x, y, size, alpha) {
        const frame = itemInfo(kind)?.frame;
        if (frame === undefined) return;
        const x0 = toDevice(x);
        const y0 = toDevice(y);
        quad(
          textures.items,
          true,
          x0,
          y0,
          toDevice(x + size) - x0,
          toDevice(y + size) - y0,
          [0, frame / ITEM_FRAMES, 1, 1 / ITEM_FRAMES],
          [1, 1, 1, alpha],
        );
      },
      qr(x, y, size) {
        if (!qrTexture) return;
        const x0 = toDevice(x);
        const y0 = toDevice(y);
        quad(
          qrTexture,
          true,
          x0,
          y0,
          toDevice(x + size) - x0,
          toDevice(y + size) - y0,
          [0, 0, 1, 1],
        );
      },
    };
    drawUi(paint, scene.ui.layout, scene.ui.state);
    flush();
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
    if (!loaded) {
      drawInterface(scene, dpr);
      return;
    }
    const zoom = dpr * scene.zoom;
    const cameraX = scene.camera.x;
    // The in-game keyboard covers the bottom of the screen: center on what is above it.
    const chatTop = scene.ui?.layout.chatTop;
    const lift = chatTop === null || chatTop === undefined
      ? 0
      : (canvas.clientHeight - chatTop) * dpr / 2;
    const cameraY = scene.camera.y + lift / zoom;
    gl.uniform2f(locationCamera, cameraX, cameraY);
    gl.uniform1f(locationZoom, zoom);
    // Sprites start on a whole device pixel relative to the camera. At a
    // fractional scale, NEAREST sampling otherwise changes which texel columns
    // are one pixel wider on each frame, so a slow sprite shimmers.
    /** @param {number} world @param {number} camera @param {number} size */
    const snap = (world, camera, size) =>
      camera + (Math.round((world - camera) * zoom + size / 2) - size / 2) /
        zoom;
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
          surfaceAt(
            scene.world,
            x,
            y,
            scene.viewZ,
            scene.viewMode,
            scene.visibility,
          ),
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
        // An ore keeps the stone's depth tint, so it reads as a wall at the
        // player's level and as a darker top when seen from above.
        const oreFrame = materialInfo(
          readTile(scene.world, x, y, tile.z),
        )?.oreFrame;
        const ore = oreFrame !== null && oreFrame !== undefined;
        quad(
          ore ? textures.ores : textures.floor,
          false,
          x * TILE,
          y * TILE,
          TILE,
          TILE,
          ore
            ? [0, oreFrame / ORE_FRAMES, 1, 1 / ORE_FRAMES]
            : [0, 5 / 31, 1, 1 / 31],
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
          scene.world,
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
          scene.world,
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
    const cursor = localCursor(scene);
    if (cursor) {
      const px = cursor.tile.x * TILE;
      const py = cursor.tile.y * TILE;
      const [r, g, b] = hexColor(cursor.color);
      const line = /** @type {[number,number,number,number]} */ ([
        r,
        g,
        b,
        cursor.opacity,
      ]);
      const w = CURSOR_OUTLINE;
      quad(textures.white, false, px, py, TILE, w, [0, 0, 1, 1], line);
      quad(
        textures.white,
        false,
        px,
        py + TILE - w,
        TILE,
        w,
        [0, 0, 1, 1],
        line,
      );
      quad(
        textures.white,
        false,
        px,
        py + w,
        w,
        TILE - 2 * w,
        [0, 0, 1, 1],
        line,
      );
      quad(
        textures.white,
        false,
        px + TILE - w,
        py + w,
        w,
        TILE - 2 * w,
        [0, 0, 1, 1],
        line,
      );
      if (cursor.iconFrame !== null) {
        const side = TILE * CURSOR_ICON_SIZE;
        quad(
          textures.items,
          false,
          px + (TILE - side) / 2,
          py + (TILE - side) / 2,
          side,
          side,
          [0, cursor.iconFrame / ITEM_FRAMES, 1, 1 / ITEM_FRAMES],
          [1, 1, 1, cursor.iconOpacity],
        );
      }
      flush();
    }
    for (const entry of scene.mining ?? []) {
      if (entry.z !== scene.viewZ) continue;
      const px = entry.x * TILE;
      const py = entry.y * TILE;
      const unit = TILE / 16;
      const frame = decalFrame(entry.progress);
      quad(textures.white, false, px, py, TILE, TILE, [0, 0, 1, 1], [
        0,
        0,
        0,
        0.07 * (frame + 1),
      ]);
      for (const pieces of DECAL_PIECES.slice(0, frame + 1)) {
        for (const [x, y, w, h] of pieces) {
          quad(
            textures.white,
            false,
            px + x * unit,
            py + y * unit,
            w * unit,
            h * unit,
            [0, 0, 1, 1],
            [0, 0, 0, 0.8],
          );
        }
      }
    }
    flush();
    // Dropped items: one icon per tile, and the kinds on a tile take turns.
    const itemTiles = (scene.items ?? []).filter((entry) =>
      entry.z === scene.viewZ
    );
    const itemNow = performance.now();
    for (const entry of itemTiles) {
      const stack = entry.stacks[cycleIndex(entry.stacks.length, itemNow)];
      const frame = itemInfo(stack?.kind)?.frame;
      if (frame === undefined) continue;
      const side = TILE * 0.625;
      quad(
        textures.items,
        false,
        entry.x * TILE + (TILE - side) / 2,
        entry.y * TILE + (TILE - side) / 2,
        side,
        side,
        [0, frame / ITEM_FRAMES, 1, 1 / ITEM_FRAMES],
      );
    }
    flush();
    const players = scene.presentation.sightEntries(
      Object.values(scene.world.players),
      scene.localId,
      scene.viewMode,
      scene.visibility,
      scene.world.tick + alpha,
    );
    /** @type {Map<string,number>} */
    const opacity = new Map();
    for (const { player, pos, opacity: sightOpacity } of players) {
      let visible = player.id === scene.localId || scene.viewMode === "master"
        ? 1
        : player.viewMotion
        ? viewMotionOpacity(player.viewMotion, scene.world.tick + alpha)
        : player.free
        ? sightOpacity
        : entityOpacity(
          player,
          scene.world.tick + alpha,
          (x, y, z) => tileVisibility(scene.visibility, x, y, z) === "visible",
          pos,
        );
      if (
        playerOccluded(scene.world, player, scene.viewZ) ||
        player.z < scene.viewZ - Z_LEVELS_BELOW
      ) visible = 0;
      opacity.set(player.id, visible);
      if (visible <= 0) continue;
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
        snap((pos.x + offset.x) * TILE, cameraX, width),
        snap((pos.y + offset.y) * TILE, cameraY, height),
        TILE,
        TILE,
        /** @type {[number,number,number,number]} */ (uv),
        /** @type {[number,number,number,number]} */ ([...tint, visible]),
      );
    }
    // The shopkeeper: a gold-tinted dwarf on the reserved tile, in the room layout.
    const shopkeeper = scene.layout === "room" &&
        scene.viewZ === SHOP_TILE.z &&
        (scene.viewMode === "master" ||
          tileVisibility(
              scene.visibility,
              SHOP_TILE.x,
              SHOP_TILE.y,
              SHOP_TILE.z,
            ) === "visible")
      ? SHOP_TILE
      : null;
    if (shopkeeper) {
      quad(
        textures.sprite,
        false,
        snap(shopkeeper.x * TILE, cameraX, width),
        snap(shopkeeper.y * TILE, cameraY, height),
        TILE,
        TILE,
        [0, 0, 1, 1],
        [1, 0.78, 0.25, 1],
      );
    }
    flush();
    // Pickup grid: dark squares with one stack each; the selector is the orange outline.
    for (const cell of scene.pickupCells ?? []) {
      quad(textures.white, false, cell.x, cell.y, cell.size, cell.size, [
        0,
        0,
        1,
        1,
      ], [0.06, 0.06, 0.08, 0.88 * cell.alpha]);
      const side = cell.size * 0.625;
      quad(
        textures.items,
        false,
        cell.x + (cell.size - side) / 2,
        cell.y + (cell.size - side) / 2,
        side,
        side,
        [0, cell.frame / ITEM_FRAMES, 1, 1 / ITEM_FRAMES],
        [1, 1, 1, cell.alpha],
      );
      if (cell.more) {
        // A small gray plus in the corner: more stacks lie below.
        const arm = cell.size * 0.26;
        const thick = Math.max(2, cell.size * 0.05);
        const cx = cell.x + cell.size - 10 - arm / 2;
        const cy = cell.y + 10 + arm / 2;
        const gray = /** @type {[number,number,number,number]} */ ([
          0.72,
          0.72,
          0.74,
          cell.alpha,
        ]);
        quad(textures.white, false, cx - arm / 2, cy - thick / 2, arm, thick, [
          0,
          0,
          1,
          1,
        ], gray);
        quad(textures.white, false, cx - thick / 2, cy - arm / 2, thick, arm, [
          0,
          0,
          1,
          1,
        ], gray);
      }
      if (cell.selected) {
        const orange = /** @type {[number,number,number,number]} */ ([
          1,
          0.38,
          0.04,
          0.95,
        ]);
        quad(
          textures.white,
          false,
          cell.x,
          cell.y,
          cell.size,
          3,
          [0, 0, 1, 1],
          orange,
        );
        quad(
          textures.white,
          false,
          cell.x,
          cell.y + cell.size - 3,
          cell.size,
          3,
          [0, 0, 1, 1],
          orange,
        );
        quad(
          textures.white,
          false,
          cell.x,
          cell.y,
          3,
          cell.size,
          [0, 0, 1, 1],
          orange,
        );
        quad(
          textures.white,
          false,
          cell.x + cell.size - 3,
          cell.y,
          3,
          cell.size,
          [0, 0, 1, 1],
          orange,
        );
      }
    }
    flush();
    const scale = Math.max(1, Math.round(dpr * 1.5 * scene.uiScale));
    const bubbleScale = scale * TEXT_SIZE_SCALE[scene.textSize];
    for (const entry of itemTiles) {
      const stack = entry.stacks[cycleIndex(entry.stacks.length, itemNow)];
      if (!stack || stack.count < 2) continue;
      const label = String(stack.count);
      text(
        label,
        Math.round(((entry.x + 1) * TILE - cameraX) * zoom + width / 2) -
          label.length * 8 * scale - 2 * dpr,
        Math.round(((entry.y + 1) * TILE - cameraY) * zoom + height / 2) -
          16 * scale - 2 * dpr,
        scale,
      );
    }
    for (const cell of scene.pickupCells ?? []) {
      if (cell.count < 2 || cell.alpha < 1) continue;
      const label = String(cell.count);
      text(
        label,
        Math.round((cell.x + cell.size - cameraX) * zoom + width / 2) -
          label.length * 8 * scale - 4 * dpr,
        Math.round((cell.y + cell.size - cameraY) * zoom + height / 2) -
          16 * scale - 2 * dpr,
        scale,
      );
    }
    if (shopkeeper) {
      text(
        "Shopkeeper",
        Math.round(((shopkeeper.x + 0.5) * TILE - cameraX) * zoom + width / 2) -
          5 * scale * 8,
        Math.round(((shopkeeper.y + 1) * TILE - cameraY) * zoom + height / 2) +
          4 * dpr,
        scale,
        [1, 0.82, 0.4, 1],
      );
    }
    for (const { player, pos } of players) {
      const visible = opacity.get(player.id) ?? 0;
      if (visible <= 0) continue;
      const offset = player.id === scene.localId
        ? scene.renderOffset
        : { x: 0, y: 0, z: 0 };
      const sx = Math.round(
        ((pos.x + offset.x) * TILE - cameraX) * zoom +
          width / 2,
      ) + TILE / 2 * zoom;
      const sy = Math.round(
        ((pos.y + offset.y) * TILE - cameraY) * zoom +
          height / 2,
      );
      if (player.name) {
        text(
          player.name,
          sx - player.name.length * 4 * scale,
          sy + TILE * zoom + 4 * dpr,
          scale,
          [0.95, 0.9, 0.78, visible],
        );
      }
    }
    const local = scene.world.players[scene.localId];
    const now = performance.now();
    const chat = scene.chatFeed.filter((record) =>
      record.expiresAt === undefined || performance.now() < record.expiresAt
    );
    if (local && !chat.some((record) => record.id === local.id)) {
      // The local echo follows the feed's rules: queued text stays hidden.
      echoFeed = receiveChat(
        echoFeed,
        chatView(scene.world, local.id, new Map()).filter((record) =>
          record.id === local.id
        ),
        scene.world.tick,
        now,
      );
      chat.push(...echoFeed);
    } else echoFeed = [];
    /** @type {Map<string,import('../shared/world.js').Tile>} */
    const positions = new Map();
    for (const entry of players) positions.set(entry.player.id, entry.pos);
    const listener = local ?? { x: 0, y: 0, z: scene.viewZ };
    const candidates = chat.map((record) => {
      const pos = positions.get(record.id) ?? record;
      const sx = ((pos.x + 0.5) * TILE - cameraX) * zoom + width / 2;
      const sy = (pos.y * TILE - cameraY) * zoom + height / 2;
      const level = record.z - listener.z;
      const lines = liveBubbleItems(record, now);
      if (!lines.length && !record.text && !record.talking) return null;
      const contents = lines.length
        ? lines.map((line) => line.text)
        : [record.text ?? ":0"];
      const shown = lines.length
        ? lines.map((line) =>
          line.startAt === undefined ? line.text : line.text.slice(
            0,
            revealedLength(
              scheduleFor(record.id, line.text),
              line.text,
              now - line.startAt,
            ),
          )
        )
        : contents;
      const direction = sx < 0
        ? "<"
        : sx > width
        ? ">"
        : sy < 0
        ? "^"
        : sy > height
        ? "v"
        : "";
      const maxChars = Math.max(
        2,
        Math.floor((width - 32 * dpr) / (8 * bubbleScale)) - 2,
      );
      const prefix = `${direction}${direction ? " " : ""}${
        level ? `  ${Math.abs(level)} ` : ""
      }`;
      // The bubble keeps its final size while the text fills it.
      const fullRows = contents.map((content) =>
        `${prefix}${content}`.slice(0, maxChars)
      );
      const rows = shown.map((content) =>
        `${prefix}${content}`.slice(0, maxChars)
      );
      const w = Math.min(
        width - 16 * dpr,
        (Math.max(...fullRows.map((row) => row.length)) * 8 + 16) *
          bubbleScale,
      );
      const h = (rows.length * 22 - 2) * bubbleScale;
      const rawX = sx - w / 2;
      const rawY = sy - 28 * bubbleScale - (rows.length - 1) * 22 * bubbleScale;
      const x = Math.max(8 * dpr, Math.min(width - w - 8 * dpr, rawX));
      const y = Math.max(8 * dpr, Math.min(height - h - 2 * bubbleScale, rawY));
      return {
        record,
        rows,
        x,
        y,
        w,
        h,
        direction,
        level,
        distance: Math.hypot(record.x - listener.x, record.y - listener.y),
      };
    }).filter((candidate) => candidate !== null).sort((a, b) =>
      a.distance - b.distance || a.record.id.localeCompare(b.record.id)
    );
    /** @type {(typeof candidates)[]} */
    const groups = [];
    for (const candidate of candidates) {
      const group = groups.find((items) =>
        items.some((item) =>
          candidate.direction
            ? item.direction === candidate.direction
            : !item.direction && candidate.x < item.x + item.w &&
              candidate.x + candidate.w > item.x &&
              candidate.y < item.y + item.h &&
              candidate.y + candidate.h > item.y
        )
      );
      if (group) group.push(candidate);
      else groups.push([candidate]);
    }
    for (const group of groups) {
      let offset = 0;
      for (const candidate of group.slice(0, 3)) {
        const top = Math.max(
          8 * dpr,
          Math.min(
            height - candidate.h - 2 * bubbleScale,
            candidate.y + offset,
          ),
        );
        offset += candidate.h + 2 * bubbleScale;
        for (const [index, row] of candidate.rows.entries()) {
          const y = top + index * 22 * bubbleScale;
          rect(candidate.x, y, candidate.w, 20 * bubbleScale, [
            0.06,
            0.06,
            0.06,
            0.85,
          ]);
          text(
            row,
            candidate.x + 8 * bubbleScale,
            y + 2 * bubbleScale,
            bubbleScale,
          );
          if (candidate.level) {
            const arrowX = candidate.x +
              (candidate.direction ? 24 : 8) * bubbleScale;
            const arrowY = y + 5 * bubbleScale;
            const gold =
              /** @type {[number,number,number,number]} */ ([1, 0.78, 0.37, 1]);
            rect(
              arrowX + 2 * bubbleScale,
              arrowY + 2 * bubbleScale,
              bubbleScale,
              8 * bubbleScale,
              gold,
            );
            for (let n = 0; n < 3; n++) {
              rect(
                arrowX + n * 2 * bubbleScale,
                arrowY +
                  (candidate.level > 0 ? n * 2 : 6 - n * 2) * bubbleScale,
                2 * bubbleScale,
                2 * bubbleScale,
                gold,
              );
            }
          }
        }
      }
      if (group.length > 3) {
        const item = group[0];
        text(
          `+${group.length - 3}`,
          item.x,
          Math.min(height - 18 * bubbleScale, item.y + offset),
          bubbleScale,
          [1, 0.58, 0.2, 1],
        );
      }
    }
    // The thought icon sits beside the upper left of the head, not above it.
    const iconUnit = TILE * zoom / 32;
    for (const record of chat) {
      if (!record.typing && !record.queued) continue;
      const pos = positions.get(record.id) ?? record;
      const sx = ((pos.x + 0.5) * TILE - cameraX) * zoom + width / 2;
      const sy = (pos.y * TILE - cameraY) * zoom + height / 2;
      const x = sx - 20 * iconUnit;
      const y = sy - 1 * iconUnit;
      if (x < -16 * iconUnit || x > width || y < -12 * iconUnit || y > height) {
        continue;
      }
      thoughtIcon(x, y, iconUnit, now);
    }
    drawInterface(scene, dpr);
    flush();
  }

  return {
    render,
    ready,
    /** The image to draw as the join QR code, or null to remove it. @param {TexImageSource|null} source */
    setQr(source) {
      if (qrTexture) gl.deleteTexture(qrTexture);
      qrTexture = source ? texture(gl, source) : null;
    },
  };
}

/** @param {string} hex "#rrggbb" @returns {[number,number,number]} */
function hexColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
