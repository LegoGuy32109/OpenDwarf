/**
 * examples/mods/welcome — a minimal mod that greets new players and keeps
 * hungry dwarves fed.
 *
 * Run with: (mod loader is not yet implemented; this typechecks against
 * @opendwarf/sdk and demonstrates the intended authoring surface.)
 */

import { createMod } from "@opendwarf/sdk";

export default createMod({
  name: "welcome",
  version: "0.1.0",
  description: "Greet players on join and auto-feed hungry dwarves.",
  author: "Open Dwarf examples",

  onPlayerJoin(ctx, player) {
    ctx.broadcast(`${player.name} entered the fortress. (tick ${ctx.tick})`);
    ctx.log.info(`hello ${player.name}`);
  },

  onPlayerLeave(ctx, player) {
    ctx.broadcast(`${player.name} departed.`);
  },

  onTick(ctx) {
    const state = ctx.state.get();
    if (state.tick % 100 !== 0) return;

    for (const player of ctx.players.list()) {
      if (player.stats.hunger > 80) {
        ctx.world.spawn("item", {
          near: player.id,
          props: { kind: "ale" },
        });
        ctx.log.info(`fed ${player.name}`);
      }
    }
  },

  onMessage(ctx, msg) {
    if (msg.text === "/hello") {
      ctx.broadcast({
        kind: "system",
        text: "Hello to you too!",
      });
    }
  },
});
