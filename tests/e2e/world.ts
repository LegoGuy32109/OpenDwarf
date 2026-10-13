import type { Page } from "@playwright/test";
import type { bindTestDriver } from "../../src/client/test-driver.js";
import type { createHarnessApi } from "../../src/client/harness.js";
import type { WorldDefinition } from "../../src/shared/world-builder.js";
export type TestWorld = NonNullable<
  ReturnType<typeof bindTestDriver<ReturnType<typeof createHarnessApi>>>
>;

/** Run an observation or fixture command through the shared test driver. */
export function readWorld<T, A = undefined>(
  page: Page,
  read: (world: TestWorld, arg: A) => T,
  arg?: A,
): Promise<Awaited<T>> {
  return page.evaluate(async ({ source, arg }) => {
    const { inspectWorld } = await import(
      new URL("../src/client/test-driver.js", document.baseURI).href
    );
    return new Function("world", "arg", `return (${source})(world,arg)`)(
      inspectWorld(),
      arg,
    );
  }, { source: read.toString(), arg });
}
/** Supply a serialized world before boot. A reload replays the same definition. */
let setupRevision = 0;
export async function configureWorld(page: Page, definition: WorldDefinition) {
  await page.addInitScript(({ definition, revision }) => {
    const root = globalThis as unknown as {
      __worldDefinition?: WorldDefinition;
      __worldSetupRevision?: number;
    };
    if ((root.__worldSetupRevision ?? -1) < revision) {
      root.__worldDefinition = definition;
      root.__worldSetupRevision = revision;
    }
  }, { definition, revision: ++setupRevision });
}
/** Media randomness must be fixed before the conductor chooses its first track. */
export async function configureMusic(page: Page, random: number) {
  await page.addInitScript(
    (value) => Object.assign(globalThis, { __musicRandom: value }),
    random,
  );
}
/** Construct a custom host world and navigate to its page. */
export async function startWorld(
  page: Page,
  definition: WorldDefinition,
  url = "/?harness=1",
) {
  await configureWorld(page, definition);
  await page.goto(url);
}

/** Every navigation constructs its explicit world before boot. */
export async function openWorld(
  page: Page,
  url: string,
  options: { npc?: boolean } & NonNullable<Parameters<Page["goto"]>[1]> = {},
) {
  const params = new URL(url, "http://127.0.0.1").searchParams;
  if (params.has("harness")) {
    const { authoredRecipe, roomRecipe } = await import(
      "../../src/shared/world-recipes.js"
    );
    const { worldSeedFromParams } = await import(
      "../../src/shared/generation.js"
    );
    const seed = worldSeedFromParams(params);
    const definition = params.get("layout") === "room"
      ? roomRecipe(seed, { npc: options.npc ?? false })
      : authoredRecipe(params.get("world") === "32" ? 32 : 16, {
        npc: options.npc ?? false,
        generator: true,
        seed,
      });
    if (params.has("unloadGraceMs")) {
      definition.unloadGraceTicks = Math.ceil(
        Number(params.get("unloadGraceMs")) / 50,
      );
    }
    await configureWorld(page, definition);
  }
  const { npc: _npc, ...navigation } = options;
  return page.goto(url, navigation);
}

/** Fixture commands share one implementation across all specs. */
export function giveItems(page: Page, kind: string, count = 1, id?: string) {
  return readWorld(
    page,
    (world, { kind, count, id }) =>
      world.edit({
        players: [{
          id: id ?? world.scene.localId,
          inventory: [{ kind, count }],
        }],
      }),
    { kind, count, id },
  );
}
export function dropItems(
  page: Page,
  x: number,
  y: number,
  kind: string,
  count = 1,
  z = 0,
) {
  return readWorld(
    page,
    (world, { x, y, z, kind, count }) =>
      world.edit({ drops: [{ at: { x, y, z }, kind, count }] }),
    { x, y, z, kind, count },
  );
}
export function setTile(
  page: Page,
  x: number,
  y: number,
  z: number,
  material: number,
) {
  return readWorld(
    page,
    (world, { x, y, z, material }) =>
      world.edit({
        tiles: [{
          bounds: { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z },
          material,
        }],
      }),
    { x, y, z, material },
  );
}
export function placePlayer(
  page: Page,
  x: number,
  y: number,
  z?: number,
  id?: string,
) {
  return readWorld(page, (world, { x, y, z, id }) => {
    const who = id ?? world.scene.localId;
    world.edit({
      players: [{
        id: who,
        at: { x, y, z: z ?? world.scene.world.players[who].z },
      }],
    });
  }, { x, y, z, id });
}
