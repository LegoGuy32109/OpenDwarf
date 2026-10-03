// Cases every Store implementation must pass. store_test.ts runs them against the in-memory store;
// store_turso_test.ts runs the same cases against Turso. Each case uses a fresh `tag`, so the
// names, commits, and sessions it writes never collide with an earlier run on a shared database.
import { assertEquals, assertRejects } from "@std/assert";
import type { Store } from "../../src/server/store.ts";

export interface Harness {
  store: Store;
  /** Sets the clock the store reads. */
  setNow(ms: number): void;
  /** True when the store starts with no rows, so cases may assert global lists. */
  empty: boolean;
}

export type Case = (h: Harness, tag: string) => Promise<void>;

/** A lowercase hex string of `length` digits, unique per call. */
export function hex(length = 40): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => (b % 16).toString(16)).join("");
}

export const cases: Record<string, Case> = {
  async "set label creates a branch label and records history"(h, tag) {
    h.setNow(1000);
    const label = await h.store.setLabel({
      name: `seed-${tag}`,
      kind: "branch",
      target: "feature/seed",
    });
    assertEquals(label, {
      name: `seed-${tag}`,
      kind: "branch",
      target: "feature/seed",
      created: 1000,
      updated: 1000,
    });
    assertEquals(await h.store.getLabel(`seed-${tag}`), label);
    const history = await h.store.labelHistory(`seed-${tag}`);
    assertEquals(history.map((c) => c.action), ["created"]);
    assertEquals(history[0].previousName, null);
  },

  async "set label moves a label and keeps its creation time"(h, tag) {
    const name = `move-${tag}`;
    const first = hex(40);
    const second = hex(7);
    h.setNow(1000);
    await h.store.setLabel({ name, kind: "branch", target: "main-work" });
    h.setNow(2000);
    const moved = await h.store.setLabel({
      name,
      kind: "commit",
      target: first,
    });
    assertEquals([moved.created, moved.updated], [1000, 2000]);
    // The same target again is not a change.
    h.setNow(3000);
    assertEquals(
      await h.store.setLabel({ name, kind: "commit", target: first }),
      moved,
    );
    await h.store.setLabel({ name, kind: "commit", target: second });
    const history = await h.store.labelHistory(name);
    assertEquals(history.map((c) => [c.action, c.kind, c.target]), [
      ["created", "branch", "main-work"],
      ["moved", "commit", first],
      ["moved", "commit", second],
    ]);
    assertEquals((await h.store.getLabel(name))?.target, second);
  },

  async "set label refuses bad names and targets"(h) {
    await assertRejects(() =>
      h.store.setLabel({ name: "a/b", kind: "branch", target: "x" })
    );
    await assertRejects(() =>
      h.store.setLabel({ name: "", kind: "branch", target: "x" })
    );
    await assertRejects(() =>
      h.store.setLabel({ name: "ok-name", kind: "commit", target: "main" })
    );
    await assertRejects(() =>
      h.store.setLabel({ name: "ok-name", kind: "branch", target: "has space" })
    );
    assertEquals(await h.store.getLabel("ok-name"), null);
  },

  async "rename label keeps its target and moves its history"(h, tag) {
    const from = `old-${tag}`;
    const to = `new-${tag}`;
    h.setNow(1000);
    await h.store.setLabel({ name: from, kind: "branch", target: "work" });
    h.setNow(2000);
    const renamed = await h.store.renameLabel(from, to);
    assertEquals(renamed, {
      name: to,
      kind: "branch",
      target: "work",
      created: 1000,
      updated: 2000,
    });
    assertEquals(await h.store.getLabel(from), null);
    assertEquals(await h.store.labelHistory(from), []);
    const history = await h.store.labelHistory(to);
    assertEquals(history.map((c) => [c.name, c.action, c.previousName]), [
      [to, "created", null],
      [to, "renamed", from],
    ]);
  },

  async "rename label refuses a missing label and a taken name"(h, tag) {
    await h.store.setLabel({ name: `a-${tag}`, kind: "branch", target: "a" });
    await h.store.setLabel({ name: `b-${tag}`, kind: "branch", target: "b" });
    await assertRejects(() => h.store.renameLabel(`none-${tag}`, `c-${tag}`));
    await assertRejects(() => h.store.renameLabel(`a-${tag}`, `b-${tag}`));
    await assertRejects(() => h.store.renameLabel(`a-${tag}`, `a-${tag}`));
    assertEquals((await h.store.getLabel(`a-${tag}`))?.target, "a");
    assertEquals((await h.store.getLabel(`b-${tag}`))?.target, "b");
  },

  async "delete label removes it and keeps its history"(h, tag) {
    const name = `gone-${tag}`;
    await h.store.setLabel({ name, kind: "branch", target: "x" });
    assertEquals(await h.store.deleteLabel(name), true);
    assertEquals(await h.store.deleteLabel(name), false);
    assertEquals(await h.store.getLabel(name), null);
    assertEquals(
      (await h.store.labelHistory(name)).map((c) => c.action),
      ["created", "deleted"],
    );
  },

  async "list labels is sorted by name"(h, tag) {
    for (const part of ["c", "a", "b"]) {
      await h.store.setLabel({
        name: `list-${tag}-${part}`,
        kind: "branch",
        target: part,
      });
    }
    const names = (await h.store.listLabels()).map((l) => l.name)
      .filter((name) => name.startsWith(`list-${tag}-`));
    assertEquals(names, [`list-${tag}-a`, `list-${tag}-b`, `list-${tag}-c`]);
  },

  async "main is the latest promotion"(h, tag) {
    if (h.empty) assertEquals(await h.store.getMain(), null);
    const [one, two] = [hex(40), hex(40)];
    h.setNow(1000);
    const first = await h.store.promote({
      commit: one,
      label: `m-${tag}`,
      note: "first",
    });
    assertEquals(first, {
      commit: one,
      label: `m-${tag}`,
      at: 1000,
      note: "first",
    });
    // Two promotions in the same millisecond still order by when they were made.
    const second = await h.store.promote({ commit: two, label: `n-${tag}` });
    assertEquals(second.note, "");
    assertEquals(await h.store.getMain(), second);
    assertEquals(await h.store.listPromotions(2), [second, first]);
    assertEquals(await h.store.listPromotions(1), [second]);
  },

  async "promote refuses a bad commit or label"(h, tag) {
    await assertRejects(() => h.store.promote({ commit: "main", label: tag }));
    await assertRejects(() =>
      h.store.promote({ commit: hex(40), label: "a b" })
    );
    await assertRejects(() => h.store.listPromotions(0));
  },

  async "shell deploys list newest first"(h, tag) {
    const [one, two] = [hex(40), hex(40)];
    h.setNow(1000);
    const first = await h.store.recordShellDeploy({
      commit: one,
      denoRevision: `rev-${tag}-1`,
    });
    h.setNow(2000);
    const second = await h.store.recordShellDeploy({
      commit: two,
      denoRevision: `rev-${tag}-2`,
      note: "second",
    });
    assertEquals(first.note, "");
    assertEquals(await h.store.listShellDeploys(2), [second, first]);
    await assertRejects(() =>
      h.store.recordShellDeploy({ commit: "nope", denoRevision: "r" })
    );
  },

  async "session lifecycle: start, heartbeat, end"(h, tag) {
    const id = `s-${tag}`;
    const commit = hex(40);
    h.setNow(1000);
    const started = await h.store.startSession({
      id,
      buildCommit: commit,
      label: `l-${tag}`,
      hostPeer: "peer-1",
    });
    assertEquals(started, {
      id,
      buildCommit: commit,
      label: `l-${tag}`,
      hostPeer: "peer-1",
      started: 1000,
      lastHeartbeat: 1000,
      playerCount: 1,
      ended: null,
    });
    assertEquals(await h.store.getSession(id), started);
    h.setNow(5000);
    assertEquals(await h.store.heartbeatSession(id, 3), true);
    const beat = await h.store.getSession(id);
    assertEquals([beat?.lastHeartbeat, beat?.playerCount], [5000, 3]);
    h.setNow(6000);
    assertEquals(await h.store.endSession(id), true);
    assertEquals((await h.store.getSession(id))?.ended, 6000);
    // An ended session takes no more heartbeats and ends once.
    assertEquals(await h.store.heartbeatSession(id, 9), false);
    assertEquals(await h.store.endSession(id), false);
    assertEquals((await h.store.getSession(id))?.playerCount, 3);
  },

  async "session without a label, and an unknown session"(h, tag) {
    const id = `nl-${tag}`;
    const session = await h.store.startSession({
      id,
      buildCommit: hex(7),
      hostPeer: "p",
      playerCount: 2,
    });
    assertEquals([session.label, session.playerCount], [null, 2]);
    assertEquals((await h.store.getSession(id))?.label, null);
    assertEquals(await h.store.getSession(`missing-${tag}`), null);
    assertEquals(await h.store.heartbeatSession(`missing-${tag}`, 1), false);
    assertEquals(await h.store.endSession(`missing-${tag}`), false);
  },

  async "start session refuses a taken id and bad input"(h, tag) {
    const id = `dup-${tag}`;
    await h.store.startSession({ id, buildCommit: hex(40), hostPeer: "p" });
    await assertRejects(() =>
      h.store.startSession({ id, buildCommit: hex(40), hostPeer: "q" })
    );
    await assertRejects(() =>
      h.store.startSession({ id: "", buildCommit: hex(40), hostPeer: "p" })
    );
    await assertRejects(() =>
      h.store.startSession({
        id: `x-${tag}`,
        buildCommit: "xyz",
        hostPeer: "p",
      })
    );
    await assertRejects(() => h.store.heartbeatSession(id, -1));
  },

  async "live sessions need a recent heartbeat and no end"(h, tag) {
    // The cases' stores use a 10 second heartbeat timeout.
    const [live, quiet, ended] = [`live-${tag}`, `quiet-${tag}`, `end-${tag}`];
    h.setNow(100_000);
    for (const id of [quiet, ended, live]) {
      await h.store.startSession({
        id,
        buildCommit: hex(40),
        hostPeer: "p",
      });
    }
    h.setNow(105_000);
    await h.store.endSession(ended);
    await h.store.heartbeatSession(live, 4);
    h.setNow(112_000);
    const ids = (await h.store.listLiveSessions()).map((s) => s.id)
      .filter((id) => id.endsWith(tag));
    assertEquals(ids, [live]);
  },

  async "telemetry summaries list by session in order"(h, tag) {
    const session = `t-${tag}`;
    h.setNow(1000);
    await h.store.recordTelemetry({
      session,
      route: "direct",
      frameMeanMs: 8.5,
      frameMaxMs: 40.25,
      rttMs: 103.4,
      bytes: 12345,
    });
    h.setNow(2000);
    await h.store.recordTelemetry({
      session,
      route: "relay",
      frameMeanMs: 9,
      frameMaxMs: 30,
      rttMs: 150,
      bytes: 99,
    });
    await h.store.recordTelemetry({
      session: `other-${tag}`,
      route: "direct",
      frameMeanMs: 1,
      frameMaxMs: 2,
      rttMs: 3,
      bytes: 4,
    });
    assertEquals(await h.store.listTelemetry(session), [
      {
        session,
        at: 1000,
        route: "direct",
        frameMeanMs: 8.5,
        frameMaxMs: 40.25,
        rttMs: 103.4,
        bytes: 12345,
      },
      {
        session,
        at: 2000,
        route: "relay",
        frameMeanMs: 9,
        frameMaxMs: 30,
        rttMs: 150,
        bytes: 99,
      },
    ]);
    assertEquals(await h.store.listTelemetry(`none-${tag}`), []);
    await assertRejects(() =>
      h.store.recordTelemetry({
        session,
        route: "direct",
        frameMeanMs: NaN,
        frameMaxMs: 1,
        rttMs: 1,
        bytes: 1,
      })
    );
  },
};
