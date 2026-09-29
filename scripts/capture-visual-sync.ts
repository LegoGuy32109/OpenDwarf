import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

const baseUrl = Deno.args.find((arg) => arg.startsWith("--url="))?.slice(6) ??
  "https://opendwarf.joshhale.me";
const delayMs = Number(
  Deno.args.find((arg) => arg.startsWith("--delay="))?.slice(8) ?? 50,
);
if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 500) {
  throw new Error("--delay must be between 0 and 500 ms");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const output = `exports/visual-sync/${
  new Date().toISOString().replace(/[:.]/g, "-")
}`;
await Deno.mkdir(`${output}/raw`, { recursive: true });

/** @param {Page} page */
async function ready(page: Page) {
  await page.waitForFunction(
    () => Boolean((globalThis as unknown as { __od?: unknown }).__od),
    {
      timeout: 30_000,
    },
  );
}

/** @param {Page} page @param {string} command */
async function command(page: Page, value: string) {
  await page.evaluate((text) => {
    (globalThis as unknown as { __od: { openChat: (text: string) => void } })
      .__od.openChat(text);
  }, value);
  await page.keyboard.press("Enter");
}

/** @param {string} source @param {string} destination */
async function trimVideo(source: string, destination: string) {
  const ffmpeg = new Deno.Command("ffmpeg", {
    args: [
      "-y",
      "-loglevel",
      "error",
      "-sseof",
      "-5",
      "-i",
      source,
      "-t",
      "5",
      "-vf",
      "fps=20",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      destination,
    ],
    stdout: "null",
    stderr: "piped",
  });
  const result = await ffmpeg.output();
  if (result.code !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync("/usr/bin/chromium")
    ? "/usr/bin/chromium"
    : undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const contexts: BrowserContext[] = [];
let host: Page | null = null;
let peer20: Page | null = null;
let hostVideo: ReturnType<Page["video"]> = null;
let peer20Video: ReturnType<Page["video"]> = null;
try {
  const viewport = { width: 1280, height: 800 };
  const hostContext = await browser.newContext({
    viewport,
    recordVideo: { dir: `${output}/raw`, size: viewport },
  });
  contexts.push(hostContext);
  host = await hostContext.newPage();
  hostVideo = host.video();
  const conditions = `harness=1&delay=${delayMs}&test=1`;
  await host.goto(`${baseUrl}/?${conditions}&world=16`);
  await ready(host);
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } })
      .__od.scene.sessionId
  );
  await command(host, "/nick Host");
  await command(host, "/master");

  const participants: { page: Page; id: string }[] = [];
  for (let index = 0; index < 20; index++) {
    const context = await browser.newContext(
      index === 19
        ? { viewport, recordVideo: { dir: `${output}/raw`, size: viewport } }
        : { viewport },
    );
    contexts.push(context);
    const page = await context.newPage();
    if (index === 19) {
      peer20 = page;
      peer20Video = page.video();
    }
    await page.goto(
      `${baseUrl}/join/${session}?${conditions}${
        index === 19 ? "" : "&synthetic=1"
      }`,
    );
    await ready(page);
    await page.waitForFunction(() =>
      (globalThis as unknown as {
        __od: { scene: { localId: string } };
      }).__od.scene.localId.startsWith("peer-"), { timeout: 20_000 });
    const id = await page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { localId: string } } })
        .__od.scene.localId
    );
    participants.push({ page, id });
    if ([1, 5, 10, 20].includes(index + 1)) {
      console.log(`Joined ${index + 1} peers`);
    }
  }
  if (!peer20) throw new Error("Peer 20 was not created");
  await command(peer20, "/nick P20");

  const cells = participants.map((participant, index) => {
    const x = 1 + index % 5 * 3;
    const y = 2 + Math.floor(index / 5) * 3;
    const dx = x === 7 && y === 8 ? -1 : 1;
    return { id: participant.id, x, y, dx };
  });
  await host.evaluate((locations) => {
    const scene = (globalThis as unknown as {
      __od: {
        scene: {
          world: {
            players: Record<
              string,
              { x: number; y: number; z: number; move: unknown }
            >;
          };
        };
      };
    }).__od.scene;
    delete scene.world.players["npc-corner"];
    const own = scene.world.players.self;
    Object.assign(own, { x: 0, y: 0, z: 0, move: null });
    for (const location of locations) {
      const player = scene.world.players[location.id];
      Object.assign(player, {
        x: location.x,
        y: location.y,
        z: 0,
        move: null,
      });
    }
  }, cells);
  await command(peer20, "/master");
  await peer20.waitForFunction(() =>
    (globalThis as unknown as {
      __od: { scene: { viewMode: string } };
    }).__od.scene.viewMode === "master", { timeout: 10_000 });
  await Promise.all(
    participants.map((participant, index) =>
      participant.page.waitForFunction(
        (cell) => {
          const scene = (globalThis as unknown as {
            __od: {
              scene: {
                localId: string;
                world: { players: Record<string, { x: number; y: number }> };
              };
            };
          }).__od.scene;
          const player = scene.world.players[scene.localId];
          return player?.x === cell.x && player.y === cell.y;
        },
        cells[index],
        { timeout: 10_000 },
      )
    ),
  );
  for (const page of [host, peer20]) {
    await page.evaluate(() => {
      const scene = (globalThis as unknown as {
        __od: {
          scene: {
            zoom: number;
            zoomTarget: number;
            camera: { x: number; y: number };
          };
        };
      }).__od.scene;
      scene.zoom = 0.72;
      scene.zoomTarget = 0.72;
      scene.camera = { x: 512, y: 512 };
    });
  }
  await sleep(700);
  const stats = await host.evaluate(() =>
    (globalThis as unknown as {
      __od: {
        hostStats: () => Promise<{
          connections: { connected: boolean; route: string }[];
        }>;
      };
    }).__od.hostStats()
  );
  if (
    stats.connections.filter((connection) => connection.connected).length !== 20
  ) {
    throw new Error("Not all 20 peers were connected before capture");
  }

  const movers = [
    { page: host, id: "self", x: 0, y: 0, dx: 1 },
    ...participants.map((participant, index) => ({
      ...participant,
      ...cells[index],
    })),
  ];
  await host.evaluate((ids) => {
    const seen = new Map(ids.map((id) => [id, new Set<number>()]));
    const game = (globalThis as unknown as {
      __od: {
        scene: {
          world: {
            players: Record<string, { move: { sequence: number } | null }>;
          };
        };
      };
    }).__od;
    (globalThis as unknown as {
      __syncMoveCounts: () => Record<string, number>;
    }).__syncMoveCounts = () =>
      Object.fromEntries([...seen].map(([id, sequences]) => [
        id,
        sequences.size,
      ]));
    const frame = () => {
      for (const [id, sequences] of seen) {
        const move = game.scene.world.players[id]?.move;
        if (move) sequences.add(move.sequence);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, movers.map((mover) => mover.id));
  const cornerOffsets = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const corners = movers.map(() => 0);
  const moves: { atMs: number; id: string; direction: string }[] = [];
  let random = 0x0d0a2f;
  const started = Date.now();
  console.log(`Recording host and peer 20 for five seconds`);
  for (let step = 0; Date.now() - started < 5000; step++) {
    const actions = movers.map((mover, index) => {
      random = (random * 1664525 + 1013904223) >>> 0;
      const prior = corners[index];
      const next = (prior + ((random >>> 29) & 1 ? 1 : 3)) % 4;
      corners[index] = next;
      const from = cornerOffsets[prior];
      const to = cornerOffsets[next];
      const mx = (to.x - from.x) * mover.dx;
      const my = to.y - from.y;
      const direction = mx > 0 ? "f" : mx < 0 ? "s" : my > 0 ? "d" : "e";
      moves.push({ atMs: Date.now() - started, id: mover.id, direction });
      return { page: mover.page, direction };
    });
    await Promise.all(
      actions.map((action) => action.page.keyboard.down(action.direction)),
    );
    await sleep(120);
    await Promise.all(
      actions.map((action) => action.page.keyboard.up(action.direction)),
    );
    const nextAt = started + (step + 1) * 620;
    if (Date.now() < nextAt) await sleep(nextAt - Date.now());
  }
  const ended = Date.now();
  const acceptedMoveCounts = await host.evaluate(() =>
    (globalThis as unknown as {
      __syncMoveCounts: () => Record<string, number>;
    }).__syncMoveCounts()
  );
  await Promise.all([hostContext.close(), peer20.context().close()]);
  const hostRaw = await hostVideo?.path();
  const peerRaw = await peer20Video?.path();
  if (!hostRaw || !peerRaw) {
    throw new Error("Playwright did not save both videos");
  }
  await Promise.all([
    trimVideo(hostRaw, `${output}/host.mp4`),
    trimVideo(peerRaw, `${output}/peer-20.mp4`),
  ]);
  const montage = new Deno.Command("ffmpeg", {
    args: [
      "-y",
      "-loglevel",
      "error",
      "-i",
      `${output}/host.mp4`,
      "-i",
      `${output}/peer-20.mp4`,
      "-filter_complex",
      "[0:v][1:v]hstack=inputs=2,drawtext=text=HOST:x=20:y=h-38:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.7,drawtext=text='PEER 20':x=w/2+20:y=h-38:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.7[v]",
      "-map",
      "[v]",
      "-t",
      "5",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      `${output}/side-by-side.mp4`,
    ],
    stdout: "null",
    stderr: "piped",
  });
  const montageResult = await montage.output();
  if (montageResult.code !== 0) {
    throw new Error(new TextDecoder().decode(montageResult.stderr));
  }
  await Deno.writeTextFile(
    `${output}/manifest.json`,
    JSON.stringify(
      {
        session,
        baseUrl,
        delayMs,
        peer20: participants[19].id,
        startedAt: new Date(started).toISOString(),
        endedAt: new Date(ended).toISOString(),
        connected: stats.connections.length,
        routes: stats.connections.map((connection) => connection.route),
        acceptedMoveCounts,
        moves,
      },
      null,
      2,
    ),
  );
  console.log(`Videos: ${output}/host.mp4, peer-20.mp4, side-by-side.mp4`);
} finally {
  await Promise.allSettled(contexts.map((context) => context.close()));
  await browser.close();
}
