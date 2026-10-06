// @ts-check

/**
 * Hosting, joining, and reporting: it starts the world host or joins one as a
 * guest, lists the visitors' worlds on the admin page, loads the join QR code,
 * and runs the host diagnostics and the telemetry reports. `network.js` owns the
 * WebRTC and the world sync; this file wires them to the shared `ctx`.
 */

import {
  createChunkGenerator,
  generateAround,
  seedFromText,
} from "../shared/generation.js";
import { createCornerNpc } from "../shared/npc.js";
import { NPC_ORIGIN } from "../shared/spawn-room.js";
import { build } from "./build.js";
import { joinWorld, startHost } from "./network.js";
import { rememberedLine, worldTerrainLine } from "./terrain-diagnostics.js";

/** @typedef {import('./context.js').Context} Context */

/** @param {Context} ctx @param {string} id */
export function joinSession(ctx, id) {
  const { scene } = ctx;
  ctx.guest?.close();
  scene.presentation.reset();
  scene.sessionId = id;
  ctx.guest = joinWorld(scene, id);
}

/** @param {Context} ctx */
export function startAdminList(ctx) {
  const { scene, ui } = ctx;
  ui.sessions.open = true;
  setInterval(() => {
    const metrics = scene.metrics;
    if (!metrics) return;
    const samples = [...metrics.rttMs].sort((a, b) => a - b);
    const median = samples.length
      ? samples[Math.floor(samples.length / 2)]
      : null;
    const p95 = samples.length
      ? samples[Math.ceil(samples.length * 0.95) - 1]
      : null;
    ui.sessions.stats = `WebRTC · route ${metrics.route} · join ${
      metrics.joinMs ?? "…"
    } ms · RTT median ${median ?? "…"} ms · p95 ${
      p95 ?? "…"
    } ms (${samples.length} samples)`;
  }, 500);
  const refresh = async () => {
    try {
      const response = await fetch(build.apiUrl("sessions"));
      const data = await response.json();
      ui.sessions.items = data.sessions.map((
        /** @type {{id:string}} */ item,
      ) => ({
        id: item.id,
      }));
      ui.sessions.status = data.sessions.length
        ? "Choose a world to join"
        : "No active visitors";
    } catch {
      ui.sessions.status = "Sessions unavailable";
    }
  };
  void refresh();
  setInterval(() => void refresh(), 5000);
}

/**
 * Load the join QR code as a texture. The shell serves it as an SVG, which a
 * canvas draws at a fixed size. A data URL keeps the canvas from tainting.
 * @param {Context} ctx
 * @param {string} url @param {{setQr:(source:TexImageSource|null)=>void}} renderer
 */
async function loadQr(ctx, url, renderer) {
  const response = await fetch(url);
  const svg = await response.text();
  const picture = new Image();
  picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await picture.decode();
  const surface = document.createElement("canvas");
  surface.width = surface.height = 384;
  const context = surface.getContext("2d");
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 384, 384);
  context.drawImage(picture, 0, 0, 384, 384);
  renderer.setQr(surface);
  ctx.ui.qrReady = true;
}

/**
 * Start the world host for this tab: its session, the corner NPC, the first
 * terrain, and the join link with its QR code.
 * @param {Context} ctx @param {{setQr:(source:TexImageSource|null)=>void}|null} renderer
 */
export function startHosting(ctx, renderer) {
  const { scene, ui } = ctx;
  scene.sessionId = crypto.randomUUID();
  ctx.tickNpc = scene.layout === "room"
    ? createCornerNpc(scene.world, NPC_ORIGIN)
    : createCornerNpc(scene.world);
  ctx.host = startHost(scene, scene.sessionId);
  // Only the host generates terrain. `?seed=` replays a world for tests.
  scene.world.generateChunk = createChunkGenerator(seedFromText(
    new URL(location.href).searchParams.get("seed") ?? scene.sessionId,
  ));
  generateAround(scene.world, Object.values(scene.world.players), 9);
  const link = build.joinLink(scene.sessionId, location.origin);
  ui.qrUrl = build.apiUrl(
    `qr/${scene.sessionId}?link=${encodeURIComponent(link)}`,
  );
  const params = new URL(location.href).searchParams;
  // Specs hide the host tools, which sit in screenshots, unless they ask with `?tools=1`.
  ui.hostTools = !params.has("harness") || params.has("tools");
  if (renderer) loadQr(ctx, ui.qrUrl, renderer).catch(() => {});
}

/** Once a second, while the diagnostics overlay is open, read the host's network stats into its text. @param {Context} ctx */
export function startDiagnostics(ctx) {
  let previousBytes = 0;
  let previousTime = performance.now();
  setInterval(() => {
    const { host, ui, frameMs } = ctx;
    if (!ui.diagnosticsOpen || !host) return;
    void host.diagnostics().then((stats) => {
      const now = performance.now();
      const bytes = stats.connections.reduce(
        (sum, connection) => sum + connection.bytesSent,
        0,
      );
      const upload = Math.max(0, bytes - previousBytes) * 1000 /
        Math.max(1, now - previousTime);
      previousBytes = bytes;
      previousTime = now;
      const queued = stats.connections.reduce(
        (sum, connection) =>
          sum + connection.bufferedAmount + connection.motionBufferedAmount,
        0,
      );
      const frameMean = frameMs.length
        ? frameMs.reduce((sum, value) => sum + value, 0) / frameMs.length
        : 0;
      const remembered = rememberedLine(stats.connections);
      ui.diagnostics =
        `HOST  F3 close\nFPS ${
          frameMean ? (1000 / frameMean).toFixed(0) : "…"
        }` +
        `  peers ${
          stats.connections.filter((connection) => connection.connected).length
        }` +
        `\nPayload ${Math.round(upload / 1024)} KiB/s  queued ${
          Math.round(queued / 1024)
        } KiB` +
        `\nJoin failures ${stats.joinFailures}` +
        `\n${worldTerrainLine(ctx.scene.world)}` +
        (remembered ? `\n${remembered}` : "");
    }).catch(() => {});
  }, 1000);
}

/**
 * Report a summary every ten seconds and each connection change to the shell.
 * Telemetry is on by default so the admin dashboard shows how sessions run;
 * `?telemetry=0` turns it off. Test pages mark their reports so they can be told
 * apart.
 * @param {Context} ctx
 */
export function startTelemetry(ctx) {
  const { scene, frameMs } = ctx;
  const params = new URL(location.href).searchParams;
  if (params.get("telemetry") === "0") return;
  const test = params.get("test") === "1" || params.has("harness");
  /** @param {"summary"|"connection"|"error"} kind @param {Record<string,unknown>} fields */
  const report = (kind, fields = {}) => {
    if (!scene.sessionId) return;
    void fetch(build.apiUrl("telemetry"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        session: scene.sessionId,
        participant: scene.localId,
        role: ctx.isAdmin ? "guest" : "host",
        test,
        ...fields,
      }),
      keepalive: true,
    }).catch(() => {});
  };
  scene.telemetry = report;
  let lastConnection = "";
  setInterval(() => {
    const status = ctx.isAdmin
      ? /retry|disconnect|failed/i.test(scene.status)
        ? "reconnecting"
        : scene.localId.startsWith("peer-")
        ? "connected"
        : "connecting"
      : "hosting";
    if (status !== lastConnection) {
      lastConnection = status;
      report("connection", { status, route: scene.metrics?.route ?? "none" });
    }
    const orderedRtt = [...(scene.metrics?.rttMs ?? [])].sort((a, b) => a - b);
    void (async () => {
      const stats = await ctx.host?.diagnostics();
      report("summary", {
        status,
        route: scene.metrics?.route ?? "none",
        players: Object.keys(scene.world.players).length,
        frameMeanMs: frameMs.length
          ? frameMs.reduce((sum, value) => sum + value, 0) / frameMs.length
          : 0,
        frameMaxMs: Math.max(0, ...frameMs),
        rttMs: orderedRtt[Math.floor(orderedRtt.length / 2)] ?? null,
        bytesSent: stats?.connections.reduce(
          (sum, connection) => sum + connection.bytesSent,
          0,
        ) ?? 0,
        queuedBytes: stats?.connections.reduce(
          (sum, connection) =>
            sum + connection.bufferedAmount + connection.motionBufferedAmount,
          0,
        ) ?? 0,
      });
    })().catch(() => report("error", { status: "metrics-failed" }));
  }, 10_000);
  globalThis.addEventListener(
    "error",
    () => report("error", { status: "script-error" }),
  );
  globalThis.addEventListener(
    "unhandledrejection",
    () => report("error", { status: "unhandled-rejection" }),
  );
}
