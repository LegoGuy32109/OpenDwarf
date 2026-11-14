import { expect, test } from "./fixtures.ts";
import { openWorld, readWorld } from "./world.ts";
import { ready } from "./ui.ts";
import { evidenceShot } from "./evidence.ts";

test("the same two PNG masks produce gold, movement and purple arrows from palette files", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 320 });
  const maskRequests: string[] = [];
  page.on("request", (request) => {
    if (/arrow-(cardinal|diagonal)-mask\.png$/.test(request.url())) {
      maskRequests.push(request.url());
    }
  });
  await openWorld(page, "/?harness=1");
  await ready(page);
  const result = await page.evaluate(async () => {
    const { createArrowPaletteLoader, arrowCanvas, arrowAtlas } = await import(
      "../../src/client/arrow-palettes.js"
    );
    const loader = createArrowPaletteLoader();
    const names = ["gold", "movement", "purple"];
    const sets = await Promise.all(
      names.map((name) => loader.load(`assets/ui/palettes/${name}.json`)),
    );
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 320;
    canvas.style.cssText =
      "position:fixed;left:0;top:0;z-index:99999;width:640px;height:320px";
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#252830";
    context.fillRect(0, 0, 640, 320);
    context.imageSmoothingEnabled = false;
    context.font = "16px monospace";
    sets.forEach((set, index) => {
      const y = 12 + index * 100;
      context.fillStyle = "#ffffff";
      context.fillText(names[index], 20, y + 44);
      context.drawImage(arrowCanvas(set.cardinal), 170, y, 96, 96);
      context.drawImage(arrowCanvas(set.diagonal), 340, y, 96, 96);
    });
    document.body.append(canvas);
    const atlas = arrowAtlas(sets[0]);
    const atlasContext = atlas.getContext("2d")!;
    const octants = Array.from({ length: 8 }, (_, i) => {
      const bytes = atlasContext.getImageData(0, i * 16, 16, 16).data;
      const colors = new Set<string>();
      let painted = 0;
      for (let p = 0; p < bytes.length; p += 4) {
        if (bytes[p + 3]) {
          painted++;
          colors.add(Array.from(bytes.slice(p, p + 4)).join(","));
        }
      }
      return { painted, colors: [...colors].sort() };
    });
    return {
      octants,
      cached: sets[0] === await loader.load("assets/ui/palettes/gold.json"),
      themes: sets.map((set) =>
        [set.cardinal, set.diagonal].map((pixels) => {
          const colors = new Set<string>();
          const shape: number[] = [];
          for (let i = 0; i < pixels.data.length; i += 4) {
            if (!pixels.data[i + 3]) continue;
            shape.push(i / 4);
            colors.add(Array.from(pixels.data.slice(i, i + 4)).join(","));
          }
          return {
            width: pixels.width,
            height: pixels.height,
            colors: [...colors].sort(),
            shape,
          };
        })
      ),
    };
  });
  expect(new Set(maskRequests).size).toBe(2);
  expect(result.cached).toBe(true);
  const palettes = [
    ["72,43,13,255", "90,60,22,255", "245,182,48,255", "255,229,137,255"],
    ["24,30,37,255", "105,118,129,255", "206,216,224,255", "246,248,247,255"],
    ["36,21,47,255", "99,60,128,255", "173,115,219,255", "233,201,255,255"],
  ];
  for (const [theme, shapes] of result.themes.entries()) {
    for (const [frame, pixels] of shapes.entries()) {
      expect([pixels.width, pixels.height]).toEqual([16, 16]);
      expect(pixels.colors).toEqual(palettes[theme].sort());
      expect(pixels.shape).toEqual(result.themes[0][frame].shape);
      expect(pixels.shape.length).toBeGreaterThan(0);
    }
  }
  for (const [i, octant] of result.octants.entries()) {
    expect(octant.painted).toBe(result.themes[0][i % 2].shape.length);
    expect(octant.colors).toEqual(result.themes[0][i % 2].colors);
  }
  await evidenceShot(page, "arrow-palette-three-themes");
});

test("world renderer uses both pixel arrows, throwing priority, custom palettes and target gradient", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await openWorld(page, "/?harness=1");
  await ready(page);
  const result = await readWorld(page, async (api) => {
    const { createRenderer } = await import("../../src/client/render.js");
    const { createActionGesture } = await import(
      "../../src/shared/single-plane.js"
    );
    const canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:fixed;inset:0;width:640px;height:480px;z-index:9999";
    document.body.append(canvas);
    const renderer = await createRenderer(canvas);
    await renderer.ready;
    const player = api.scene.world.players[api.scene.localId];
    const scene = {
      ...api.scene,
      ui: undefined,
      zoom: 2,
      movementInput: { x: 0, y: 0 },
      actionGesture: createActionGesture(),
    };
    scene.camera = { x: (player.x + 0.5) * 64, y: (player.y + 0.5) * 64 };
    const gl = canvas.getContext("webgl2")!;
    function pixels() {
      renderer.render(scene, 0);
      const data = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      return data;
    }
    function differences(a: Uint8Array, b: Uint8Array) {
      let count = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
          count++;
        }
      }
      return count;
    }
    const idle = pixels();
    scene.movementInput = { x: 1, y: 0 };
    const moving = pixels();
    scene.actionGesture = {
      ...createActionGesture(),
      down: true,
      aiming: true,
      x: 1,
      y: 0,
    };
    const overlapping = pixels();
    scene.movementInput = { x: 0, y: 0 };
    const throwingOnly = pixels();
    scene.movementInput = { x: -1, y: 0 };
    const opposite = pixels();
    await renderer.setArrowPalette("throw", "assets/ui/palettes/purple.json");
    const purple = pixels();
    const corners = new Image();
    corners.src = "assets/ui/target-corners.png";
    await corners.decode();
    const art = document.createElement("canvas");
    art.width = art.height = 16;
    const context = art.getContext("2d")!;
    context.drawImage(corners, 0, 0);
    const bytes = context.getImageData(0, 0, 16, 16).data;
    const alphas = new Set<number>(), shades = new Set<number>();
    for (let i = 0; i < bytes.length; i += 4) {
      alphas.add(bytes[i + 3]);
      if (bytes[i + 3]) shades.add(bytes[i]);
    }
    return {
      movement: differences(idle, moving),
      throwing: differences(moving, overlapping),
      priority: differences(overlapping, throwingOnly),
      both: differences(throwingOnly, opposite),
      palette: differences(opposite, purple),
      alphas: [...alphas].sort((a, b) => a - b),
      shades: shades.size,
    };
  });
  expect(result.movement).toBeGreaterThan(0);
  expect(result.throwing).toBeGreaterThan(0);
  expect(result.priority).toBe(0);
  expect(result.both).toBeGreaterThan(0);
  expect(result.palette).toBeGreaterThan(0);
  expect(result.alphas).toEqual([0, 255]);
  expect(result.shades).toBeGreaterThan(2);
  await evidenceShot(page, "pixel-indicators-in-world");
});
