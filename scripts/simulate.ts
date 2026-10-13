// Run the same world simulation as the browser without real-time pacing.
import { createSimulation } from "../src/shared/simulation.js";
import { authoredRecipe, roomRecipe } from "../src/shared/world-recipes.js";
import type { WorldDefinition } from "../src/shared/world-builder.js";
import { droppedEntries, inventoryOf } from "../src/shared/items.js";
const args = Deno.args;
const value = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ticks = Number(value("ticks") ?? 10000);
const file = args.find((a) => !a.startsWith("--"));
const definition: WorldDefinition = file
  ? JSON.parse(await Deno.readTextFile(file))
  : value("recipe") === "test"
  ? authoredRecipe()
  : roomRecipe();
const simulation = createSimulation(definition);
simulation.join("self");
const start = performance.now();
simulation.advanceTicks(ticks);
const elapsed = performance.now() - start;
console.log(JSON.stringify(
  {
    ticks: simulation.world.tick,
    elapsedMs: Math.round(elapsed),
    ticksPerSecond: Math.round(ticks * 1000 / Math.max(elapsed, 0.001)),
    chunks: simulation.world.chunks.size,
    players: Object.values(simulation.world.players).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      inventory: inventoryOf(p),
    })),
    drops: droppedEntries(simulation.world),
  },
  null,
  2,
));
