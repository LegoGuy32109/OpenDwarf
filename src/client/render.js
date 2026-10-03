// @ts-check

import {
  liveBubbles,
  TEXT_SIZE_SCALE,
  TEXT_SIZES,
  THOUGHT_DOTS_WIDTH,
  thoughtDotLifts,
} from "../shared/chat.js";
import { Z_LEVELS_BELOW } from "../shared/world.js";
import { materialInfo, ORE_FRAMES } from "../shared/materials.js";
import { readTile } from "../shared/terrain.js";
import { highlightedTile } from "../shared/target.js";
import { decalFrame } from "../shared/mining.js";
import { cycleIndex, ITEM_FRAMES, itemInfo } from "../shared/items.js";
import { entityOpacity, tileVisibility } from "../shared/visibility.js";
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
/** @typedef {{world:World,localId:string,menu:boolean,menuPage:string,uiScale:number,zoom:number,viewZ:number,viewMode:"entity"|"master",inputMode:string,hudUntil:number,touchGesture:boolean,visibility:Visibility,camera:{x:number,y:number},aim:{x:number,y:number},renderOffset:{x:number,y:number,z:number},presentation:ReturnType<typeof import('./presentation.js').createPresentation>,chatFeed:import('../shared/chat.js').DisplayChatRecord[],textSize:import('../shared/chat.js').TextSize,chatOpen:boolean,chatDraft:string,status:string,notice?:{text:string,until:number},mining?:{id:string,x:number,y:number,z:number,progress:number}[],items?:import('../shared/items.js').DroppedEntry[]}} Scene */

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
  const [
    floorImage,
    spriteImage,
    fontImage,
    edgeImage,
    ceilingImage,
    oreImage,
    itemImage,
  ] = /** @type {HTMLImageElement[]} */ (
    await Promise.all([
      image("/assets/floor.png"),
      image("/assets/dwarf.png"),
      image("/assets/font.png"),
      image("/assets/edge.png"),
      image("/assets/ceiling.png"),
      image("/assets/ores.png"),
      image("/assets/items.png"),
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
    ores: texture(gl, oreImage),
    items: texture(gl, itemImage),
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

  /** The animated dots of a thought bubble, inside a bubble whose top-left is (x, y). @param {number} x @param {number} y @param {number} scale @param {number} now */
  function thoughtDots(x, y, scale, now) {
    const lifts = thoughtDotLifts(now);
    for (const [n, lift] of lifts.entries()) {
      rect(
        x + (2 + n * 8) * scale,
        y + (11 - lift * 4) * scale,
        4 * scale,
        4 * scale,
        [0.95, 0.9, 0.78, 0.55 + lift * 0.45],
      );
    }
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
    const localPlayer = scene.world.players[scene.localId];
    if (scene.viewMode === "entity" && localPlayer) {
      const target = highlightedTile(
        localPlayer,
        scene.aim,
        scene.viewZ,
        scene.world,
      );
      if (target) {
        const px = target.x * TILE;
        const py = target.y * TILE;
        const orange = /** @type {[number,number,number,number]} */ ([
          1,
          0.38,
          0.04,
          0.95,
        ]);
        quad(textures.white, false, px, py, TILE, TILE, [0, 0, 1, 1], [
          1,
          0.38,
          0.04,
          0.18,
        ]);
        quad(textures.white, false, px, py, TILE, 3, [0, 0, 1, 1], orange);
        quad(
          textures.white,
          false,
          px,
          py + TILE - 3,
          TILE,
          3,
          [0, 0, 1, 1],
          orange,
        );
        quad(textures.white, false, px, py, 3, TILE, [0, 0, 1, 1], orange);
        quad(
          textures.white,
          false,
          px + TILE - 3,
          py,
          3,
          TILE,
          [0, 0, 1, 1],
          orange,
        );
        flush();
      }
    }
    for (const entry of scene.mining ?? []) {
      if (entry.z !== scene.viewZ) continue;
      const px = entry.x * TILE;
      const py = entry.y * TILE;
      if (entry.id === scene.localId) {
        // A square grows from the tile's center inside the orange outline.
        const side = Math.max(2, (TILE - 12) * entry.progress);
        quad(
          textures.white,
          false,
          px + (TILE - side) / 2,
          py + (TILE - side) / 2,
          side,
          side,
          [0, 0, 1, 1],
          [1, 0.55, 0.12, 0.85],
        );
        continue;
      }
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
      if (local.message && scene.world.tick < local.messageUntil) {
        chat.push({
          id: local.id,
          x: local.x,
          y: local.y,
          z: local.z,
          text: local.message,
          bubbles: (local.messages ?? []).filter((bubble) =>
            scene.world.tick < bubble.until
          ).map((bubble) => ({ text: bubble.text, expiresTick: bubble.until })),
        });
      } else if (local.typing) {
        chat.push({
          id: local.id,
          x: local.x,
          y: local.y,
          z: local.z,
          typing: true,
        });
      }
    }
    /** @type {Map<string,import('../shared/world.js').Tile>} */
    const positions = new Map();
    for (const entry of players) positions.set(entry.player.id, entry.pos);
    const listener = local ?? { x: 0, y: 0, z: scene.viewZ };
    const candidates = chat.map((record) => {
      const pos = positions.get(record.id) ?? record;
      const sx = ((pos.x + 0.5) * TILE - cameraX) * zoom + width / 2;
      const sy = (pos.y * TILE - cameraY) * zoom + height / 2;
      const level = record.z - listener.z;
      const lines = liveBubbles(record, now);
      const contents = lines.length
        ? lines
        : [record.text ?? (record.talking ? ":0" : "")];
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
      const rows = contents.map((content) =>
        `${direction}${direction ? " " : ""}${
          level ? `  ${Math.abs(level)} ` : ""
        }${content}`.slice(0, maxChars)
      );
      const dotsW = record.typing ? THOUGHT_DOTS_WIDTH * bubbleScale : 0;
      const w = Math.min(
        width - 16 * dpr,
        (Math.max(...rows.map((row) => row.length)) * 8 + 16) * bubbleScale +
          dotsW,
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
    }).sort((a, b) =>
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
          if (candidate.record.typing) {
            const dotsX = candidate.x + (8 + row.length * 8) * bubbleScale;
            thoughtDots(dotsX, y, bubbleScale, performance.now());
            if (group[0] === candidate) {
              const tailX = candidate.x + candidate.w / 2;
              const color = /** @type {[number,number,number,number]} */ ([
                0.06,
                0.06,
                0.06,
                0.85,
              ]);
              rect(
                tailX - 3 * bubbleScale,
                y + 21 * bubbleScale,
                4 * bubbleScale,
                4 * bubbleScale,
                color,
              );
              rect(
                tailX - 6 * bubbleScale,
                y + 26 * bubbleScale,
                2 * bubbleScale,
                2 * bubbleScale,
                color,
              );
            }
          }
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
    const status =
      (scene.notice && performance.now() < scene.notice.until
        ? scene.notice.text
        : scene.status).slice(0, 75);
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
        centerText("Text Size", 136);
        for (const [index, size] of TEXT_SIZES.entries()) {
          const label = size[0].toUpperCase() + size.slice(1);
          text(
            label,
            width / 2 + (index - 1) * 90 * dpr - label.length * 4 * menuScale,
            y + 168 * dpr,
            menuScale,
            size === scene.textSize ? [1, 0.78, 0.37, 1] : [0.6, 0.58, 0.52, 1],
          );
        }
        centerText("Back", 212);
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
        const hints = scene.inputMode === "gamepad"
          ? [
            "LEFT STICK MOVE",
            "RIGHT STICK CAMERA",
            "4 5 LEVEL  6 7 ZOOM",
            "3 MENU",
          ]
          : scene.inputMode === "touch"
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
