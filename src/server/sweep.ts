// The sweep deletes the Xirsys session channel of every session that has ended, and prunes old
// telemetry. Deno Deploy has no cron here, so `maybeRun` is called when a session starts or sends a
// heartbeat and works at most once a minute per isolate. Several isolates may call it at once: each
// takes a lease on a session in the store before it deletes the channel, so one isolate deletes it.
import type { SignalingProvider } from "./signaling.ts";
import { type Store, TELEMETRY_RETENTION_MS } from "./store.ts";

export interface SweeperOptions {
  store: Store;
  provider: SignalingProvider;
  /** The clock, in milliseconds. Tests set it. */
  now?: () => number;
  /** The least time between two runs in one isolate. Default one minute. */
  intervalMs?: number;
  /** How long a claimed session stays claimed when its delete fails. Default two minutes. */
  leaseMs?: number;
  /** How many sessions one run deletes. Default 20. */
  batch?: number;
  /** The least time between two telemetry prunes in one isolate. Default one hour. */
  pruneIntervalMs?: number;
  /** Telemetry older than this is deleted. Default 30 days. */
  retentionMs?: number;
}

export interface SweepResult {
  /** The sessions whose channel this run deleted. */
  closed: string[];
  /** The sessions whose channel could not be deleted. A later run tries again. */
  failed: string[];
  /** Telemetry summaries deleted. */
  pruned: number;
}

export function createSweeper(options: SweeperOptions) {
  const { store, provider } = options;
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? 60_000;
  const leaseMs = options.leaseMs ?? 120_000;
  const batch = options.batch ?? 20;
  const pruneIntervalMs = options.pruneIntervalMs ?? 60 * 60_000;
  const retentionMs = options.retentionMs ?? TELEMETRY_RETENTION_MS;
  let lastRun = -Infinity;
  let lastPrune = -Infinity;
  let running: Promise<SweepResult> | null = null;

  /**
   * Deletes one ended session's channel. False when another sweep holds it or it is already gone.
   * Throws when Xirsys refuses; the lease then holds until it runs out, and a later sweep retries.
   */
  async function closeSession(id: string): Promise<boolean> {
    if (!await store.claimSessionSweep(id, leaseMs)) return false;
    await provider.close(id);
    await store.markChannelDeleted(id);
    return true;
  }

  async function run(): Promise<SweepResult> {
    const result: SweepResult = { closed: [], failed: [], pruned: 0 };
    for (const session of await store.listSessionsToSweep(batch)) {
      try {
        if (await closeSession(session.id)) result.closed.push(session.id);
      } catch {
        result.failed.push(session.id);
      }
    }
    if (now() - lastPrune >= pruneIntervalMs) {
      lastPrune = now();
      result.pruned = await store.pruneTelemetry(now() - retentionMs);
    }
    return result;
  }

  return {
    closeSession,
    run,
    /**
     * Runs the sweep unless this isolate ran it within the interval or is running it. Never
     * throws: a sweep that fails must not fail the request that triggered it.
     */
    async maybeRun(): Promise<SweepResult | null> {
      if (running || now() - lastRun < intervalMs) return null;
      lastRun = now();
      running = run();
      try {
        return await running;
      } catch (error) {
        console.error(
          "Session sweep failed",
          error instanceof Error ? error.message : "",
        );
        return null;
      } finally {
        running = null;
      }
    },
  };
}
