// @ts-check

/**
 * Frame statistics and lag-spike logging. A ring of the last 300 frame times
 * gives p50, p95 and max; counters keep the frames over 33 ms and 100 ms; and
 * `mark`/`end` time the phases of one frame so a slow frame names its slowest
 * phase. A `longtask` observer counts the main-thread stalls the browser
 * reports. Pure apart from the injected clock and observer.
 */

export const RING_SIZE = 300;
export const SPIKE_LOG_SIZE = 20;
/** A frame over this is a spike in the F3 counters. */
export const SPIKE_MS = 33;
/** A frame over this is a bad spike. */
export const BAD_SPIKE_MS = 100;
/** A frame over this is sent to the shell as a `spike` event. */
export const REPORT_SPIKE_MS = 250;
/** The shell gets at most one `spike` event in this time. */
export const REPORT_INTERVAL_MS = 60_000;

/** The phases a frame is timed in. */
export const PHASES = ["step", "visibility", "display", "layout", "render"];

/**
 * @typedef {{at:number,ms:number,phase:string,viewMode:string,zoom:number,chunks:number}} SpikeEntry
 * @typedef {{viewMode:string,zoom:number,chunks:number,quads?:number,tiles?:number}} FrameInfo
 * @typedef {{entry:SpikeEntry,phases:Record<string,number>,info:FrameInfo}} SpikeReport
 */

/**
 * Call `onTask(durationMs)` for each long task. Returns false where the
 * browser has no `longtask` entries (Safari).
 * @param {(durationMs:number)=>void} onTask
 */
export function observeLongTasks(onTask) {
  try {
    if (typeof PerformanceObserver === "undefined") return false;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) onTask(entry.duration);
    }).observe({ type: "longtask" });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{clock?:()=>number,observer?:((onTask:(durationMs:number)=>void)=>unknown)|null}} [options]
 */
export function createFrameStats(options = {}) {
  const clock = options.clock ?? (() => performance.now());
  const ring = new Float32Array(RING_SIZE);
  let count = 0;
  let head = 0;
  let spikes33 = 0;
  let spikes100 = 0;
  let longTasks = 0;
  let longestTaskMs = 0;
  /** @type {SpikeEntry[]} */
  const spikeLog = [];
  /** Milliseconds each phase took in the frame being built, and in the last whole frame. */
  /** @type {Record<string,number>} */
  let current = {};
  /** @type {Record<string,number>} */
  let previous = {};
  /** Smoothed milliseconds per phase, for the F3 line. */
  /** @type {Record<string,number>} */
  const average = {};
  /** @type {string|null} */
  let phase = null;
  let phaseStart = 0;
  let lastFrameAt = -1;
  let lastReportAt = -Infinity;

  /** Close the phase being timed. */
  const end = () => {
    if (phase === null) return;
    current[phase] = (current[phase] ?? 0) + (clock() - phaseStart);
    phase = null;
  };

  const stats = {
    /** Called with each spike report that the rate limit lets through. */
    /** @type {((report:SpikeReport)=>void)|null} */
    onSpike: null,
    /** Start timing `name`; this also ends the phase before it. @param {string} name */
    mark(name) {
      end();
      phase = name;
      phaseStart = clock();
    },
    end,
    /**
     * Start of a frame at `now`: record the time since the last frame start,
     * which includes the work of the frame before, so that frame's phases name
     * the slow part. @param {number} now @param {FrameInfo} info
     */
    frame(now, info) {
      end();
      previous = current;
      current = {};
      for (const name of PHASES) {
        if (name in previous) {
          average[name] = name in average
            ? average[name] + (previous[name] - average[name]) * 0.1
            : previous[name];
        }
      }
      const elapsed = lastFrameAt < 0 ? 0 : now - lastFrameAt;
      lastFrameAt = now;
      if (elapsed <= 0) return;
      ring[head] = elapsed;
      head = (head + 1) % RING_SIZE;
      if (count < RING_SIZE) count++;
      if (elapsed <= SPIKE_MS) return;
      spikes33++;
      if (elapsed > BAD_SPIKE_MS) spikes100++;
      if (elapsed <= BAD_SPIKE_MS) return;
      let slowest = "other";
      let slowestMs = 0;
      for (const [name, ms] of Object.entries(previous)) {
        if (ms > slowestMs) {
          slowest = name;
          slowestMs = ms;
        }
      }
      /** @type {SpikeEntry} */
      const entry = {
        at: Date.now(),
        ms: elapsed,
        phase: slowest,
        viewMode: info.viewMode,
        zoom: info.zoom,
        chunks: info.chunks,
      };
      spikeLog.push(entry);
      if (spikeLog.length > SPIKE_LOG_SIZE) spikeLog.shift();
      if (
        elapsed > REPORT_SPIKE_MS && now - lastReportAt >= REPORT_INTERVAL_MS
      ) {
        lastReportAt = now;
        stats.onSpike?.({ entry, phases: { ...previous }, info });
      }
    },
    /** Forget the gap before the next frame, for a tab that was hidden. */
    skipGap() {
      lastFrameAt = -1;
    },
    /** @param {number} durationMs */
    longTask(durationMs) {
      longTasks++;
      if (durationMs > longestTaskMs) longestTaskMs = durationMs;
    },
    snapshot() {
      const sorted = ring.slice(0, count).sort();
      /** @param {number} p */
      const percentile = (p) =>
        count ? sorted[Math.max(0, Math.ceil(p * count) - 1)] : 0;
      let sum = 0;
      for (let index = 0; index < count; index++) sum += sorted[index];
      return {
        samples: count,
        meanMs: count ? sum / count : 0,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        maxMs: count ? sorted[count - 1] : 0,
        spikes33,
        spikes100,
        longTasks,
        longestTaskMs,
        phaseMs: { ...average },
        spikeLog: spikeLog.map((entry) => ({ ...entry })),
      };
    },
  };
  const observe = options.observer === undefined
    ? observeLongTasks
    : options.observer;
  observe?.((durationMs) => stats.longTask(durationMs));
  return stats;
}

/** @typedef {ReturnType<typeof createFrameStats>} FrameStats */

/**
 * The named numbers telemetry sends for a frame (`telemetryMetrics` on the
 * shell keeps up to 24). `quads` is left out until the renderer reports it.
 * @param {ReturnType<FrameStats["snapshot"]>} snapshot @param {FrameInfo} info
 */
export function summaryMetrics(snapshot, info) {
  /** @type {Record<string,number>} */
  const metrics = {
    frameP95Ms: snapshot.p95Ms,
    spikes33: snapshot.spikes33,
    spikes100: snapshot.spikes100,
    longTasks: snapshot.longTasks,
    longestTaskMs: snapshot.longestTaskMs,
    renderMs: snapshot.phaseMs.render ?? 0,
    zoom: info.zoom,
    master: info.viewMode === "master" ? 1 : 0,
  };
  if (info.quads !== undefined) metrics.quads = info.quads;
  return metrics;
}

/**
 * The metrics of one slow frame: its total, each phase, and the view.
 * @param {SpikeReport} report
 */
export function spikeMetrics(report) {
  /** @type {Record<string,number>} */
  const metrics = {
    frameMs: report.entry.ms,
    zoom: report.info.zoom,
    master: report.info.viewMode === "master" ? 1 : 0,
    chunks: report.info.chunks,
  };
  for (const [name, ms] of Object.entries(report.phases)) {
    metrics[`${name}Ms`] = ms;
  }
  if (report.info.quads !== undefined) metrics.quads = report.info.quads;
  return metrics;
}

/**
 * The F3 frame line, such as `FPS 34  p95 47  max 114  spikes 47/2  render 27.1 ms  quads 19k`.
 * @param {ReturnType<FrameStats["snapshot"]>} snapshot @param {number|undefined} quads
 */
export function frameLine(snapshot, quads) {
  if (!snapshot.samples) return "FPS …";
  const render = snapshot.phaseMs.render;
  return `FPS ${(1000 / snapshot.meanMs).toFixed(0)}  p95 ${
    snapshot.p95Ms.toFixed(0)
  }  max ${
    snapshot.maxMs.toFixed(0)
  }  spikes ${snapshot.spikes33}/${snapshot.spikes100}` +
    `  render ${render === undefined ? "-" : `${render.toFixed(1)} ms`}` +
    `  quads ${
      quads === undefined
        ? "-"
        : quads >= 1000
        ? `${Math.round(quads / 1000)}k`
        : quads
    }`;
}
