// @ts-check

/**
 * Plays the sound events this client hears and its own sounds (ADR 0008,
 * docs/features/sound-events.md). The world host sends the events in range;
 * this client plays each at its tick's presentation time. Its own steps,
 * mining and placing play at once from local state, and never wait for the host.
 */

import { LATE_MS } from "./sfx.js";
import {
  createStepTracker,
  isWalking,
  MINE_HIT_MS,
  stepsTaken,
  stepTags,
} from "../shared/sound.js";
import { materialInfo } from "../shared/materials.js";
import { readTile } from "../shared/terrain.js";
import { renderPosition } from "../shared/world.js";

/** @typedef {import('../shared/sound.js').HeardSound} HeardSound */
/** @typedef {{tags:string[],x:number,y:number,z:number,muffled:boolean,own:boolean}} PlayedSound */

/** Events the harness log keeps. */
const LOG_LIMIT = 2000;
/** Mining that reached this progress before it ended finished with a break. */
const BREAK_PROGRESS = 0.9;

/**
 * @param {{scene:{world:import('../shared/world.js').World,localId:string,presentation:{timeOfTick:(tick:number)=>number|null},mining:{id:string,x:number,y:number,z:number,progress:number}[]},sfx:{play:(tags:string[],options?:import('./sfx.js').PlayOptions)=>void,setListener:(listener:{x:number,y:number,z:number}|undefined)=>void}}} deps
 */
export function createSoundEvents({ scene, sfx }) {
  /** The events this client chose to play, for `__od.sounds`. @type {PlayedSound[]} */
  const log = [];
  const steps = createStepTracker();
  /** @type {{key:string,x:number,y:number,z:number,material:string,nextHit:number,progress:number}|null} */
  let mining = null;

  /** @param {PlayedSound} played */
  function record(played) {
    log.push(played);
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
  }

  /**
   * Play one of this client's own sounds now, at full gain.
   * @param {string[]} tags @param {{x:number,y:number,z:number}} at
   */
  function own(tags, at) {
    record({ tags, x: at.x, y: at.y, z: at.z, muffled: false, own: true });
    sfx.play(tags);
  }

  /** @param {number} x @param {number} y @param {number} z */
  function materialName(x, y, z) {
    return materialInfo(readTile(scene.world, x, y, z))?.name ?? "stone";
  }

  return {
    log,
    own,
    /**
     * Play the events the world host sent: each at its tick's presentation
     * time, muffled when the source is out of sight. One that is more than
     * `LATE_MS` late is dropped.
     * @param {HeardSound[]} list
     */
    hear(list) {
      const now = performance.now();
      for (const event of list) {
        const at = scene.presentation.timeOfTick(event.tick) ?? now;
        if (now - at > LATE_MS) continue;
        const muffled = !event.seen;
        record({
          tags: event.tags,
          x: event.x,
          y: event.y,
          z: event.z,
          muffled,
          own: false,
        });
        sfx.play(event.tags, {
          x: event.x,
          y: event.y,
          z: event.z,
          muffled,
          at,
        });
      }
    },
    /**
     * The local entity's steps, from its predicted motion; call once per world
     * tick after it moves. A guest and the host count steps by the same rule.
     * @param {boolean} running
     */
    ownSteps(running) {
      const player = scene.world.players[scene.localId];
      if (!player) return;
      const at = player.move
        ? renderPosition(player, scene.world.tick)
        : player;
      const taken = stepsTaken(steps, at.x, at.y);
      const count = isWalking(player) ? taken : 0;
      for (let i = 0; i < count; i++) {
        own(stepTags(scene.world, at.x, at.y, player.z, running), {
          x: at.x,
          y: at.y,
          z: player.z,
        });
      }
    },
    /**
     * Once per frame: follow the local entity's mining progress for its hits
     * and its break, and tell the effects player where the listener is.
     * @param {number} now @param {number} alpha progress through the current tick
     */
    frame(now, alpha) {
      const player = scene.world.players[scene.localId];
      sfx.setListener(
        player ? renderPosition(player, scene.world.tick + alpha) : undefined,
      );
      const entry = scene.mining.find((item) => item.id === scene.localId);
      if (entry) {
        const key = `${entry.x},${entry.y},${entry.z}`;
        if (mining?.key !== key) {
          mining = {
            key,
            x: entry.x,
            y: entry.y,
            z: entry.z,
            material: materialName(entry.x, entry.y, entry.z),
            nextHit: now,
            progress: 0,
          };
        }
        mining.progress = entry.progress;
        if (now >= mining.nextHit && entry.progress < 1) {
          mining.nextHit = Math.max(mining.nextHit + MINE_HIT_MS, now);
          own(["mine", "hit", mining.material], mining);
        }
      } else if (mining) {
        if (mining.progress >= BREAK_PROGRESS) {
          own(["mine", "break", mining.material], mining);
        }
        mining = null;
      }
    },
  };
}
