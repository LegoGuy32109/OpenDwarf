// @ts-check

/**
 * The music player (ADR 0007). It reads the music index from the bucket, picks
 * a track for the current **mood**, keeps each downloaded track in the Cache
 * Storage cache `od-media`, and plays through Web Audio so a gain node sets the
 * volume (iOS ignores `audio.volume`) and crossfades between tracks.
 */

import { build } from "./build.js";
import { useMediaSession } from "./chatter.js";

/** @typedef {{key:string,hash:string,tags:string[],duration?:number}} Track */
/** @typedef {"off"|"25"|"50"|"75"|"100"} MusicLevel */
/** @typedef {{played:number,bytes:number}} PlayRecord */

export const MUSIC_LEVELS = /** @type {MusicLevel[]} */ ([
  "off",
  "25",
  "50",
  "75",
  "100",
]);
/** The master volume of each music setting. 50% is the default. */
export const MUSIC_VOLUME = {
  off: 0,
  "25": 0.25,
  "50": 0.5,
  "75": 0.75,
  "100": 1,
};
export const MUSIC_KEY = "open-dwarf-music";
/** The localStorage key of the play times and sizes of the cached tracks. */
export const PLAYS_KEY = "open-dwarf-music-plays";
export const INDEX_KEY = "index/music.v1.json";
export const CACHE_NAME = "od-media";
/** The mood the game sets for now. */
export const GAME_MOOD = ["adventure", "soft", "forest"];
export const CACHE_CAP_BYTES = 150 * 1024 * 1024;
export const CROSSFADE_SECONDS = 3;
/** A track is not picked again while it is among this many last played. */
export const RECENT_LIMIT = 5;
/** Failed tracks in a row after which the player stops until the next mood. */
export const MAX_FAILURES = 3;
/** Seconds a track lasts for the conductor when its index entry has no `duration`. */
export const DEFAULT_DURATION = 180;

/** @param {unknown} value @returns {MusicLevel} */
export function parseMusicLevel(value) {
  return MUSIC_LEVELS.find((level) => level === value) ?? "50";
}

/**
 * The tracks of a music v1 index. An entry without a `key`, a `hash` and tags
 * is ignored, and so is any field this client does not know.
 * @param {unknown} json @returns {Track[]}
 */
export function parseIndex(json) {
  const list = /** @type {{tracks?:unknown}|null} */ (json)?.tracks;
  if (!Array.isArray(list)) return [];
  /** @type {Track[]} */
  const tracks = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { key, hash, tags, duration } = entry;
    if (typeof key !== "string" || !key || seen.has(key)) continue;
    if (typeof hash !== "string" || !hash) continue;
    if (!Array.isArray(tags)) continue;
    const kept = tags.filter((tag) => typeof tag === "string" && tag);
    if (!kept.length) continue;
    seen.add(key);
    tracks.push({
      key,
      hash,
      tags: kept,
      ...(typeof duration === "number" ? { duration } : {}),
    });
  }
  return tracks;
}

/**
 * A random track that shares a tag with the mood. It avoids the last
 * `RECENT_LIMIT` tracks played; when too few tracks match for that, the window
 * shrinks until one is left, so a small index still plays.
 * @param {Track[]} tracks @param {string[]} mood
 * @param {{recent?:string[],exclude?:Set<string>,random?:() => number}} [options]
 *   `recent` lists played keys, oldest first; `exclude` lists keys that failed.
 * @returns {Track|null}
 */
export function pickTrack(tracks, mood, options = {}) {
  const { recent = [], exclude = new Set(), random = Math.random } = options;
  const matching = tracks.filter((track) =>
    !exclude.has(track.key) && track.tags.some((tag) => mood.includes(tag))
  );
  for (let window = RECENT_LIMIT; window >= 0; window--) {
    const blocked = new Set(recent.slice(Math.max(0, recent.length - window)));
    const candidates = matching.filter((track) => !blocked.has(track.key));
    if (!candidates.length) continue;
    const index = Math.floor(random() * candidates.length);
    return candidates[Math.min(candidates.length - 1, Math.max(0, index))];
  }
  return null;
}

/**
 * The cached tracks to delete so the rest fit in `cap` bytes: least recently
 * played first. Tracks in `keep` stay even when the cap is still exceeded.
 * @param {{url:string,bytes:number,played:number}[]} entries @param {number} cap
 * @param {Set<string>} [keep]
 * @returns {string[]}
 */
export function evictionPlan(entries, cap, keep = new Set()) {
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const oldest = entries.slice().sort((a, b) =>
    a.played - b.played || (a.url < b.url ? -1 : 1)
  );
  /** @type {string[]} */
  const doomed = [];
  for (const entry of oldest) {
    if (total <= cap) break;
    if (keep.has(entry.url)) continue;
    doomed.push(entry.url);
    total -= entry.bytes;
  }
  return doomed;
}

/** `music/ACelticTale.ogg` as `ACelticTale`. @param {string} key */
function trackName(key) {
  return (key.split("/").pop() ?? key).replace(/\.[^.]*$/, "");
}

/**
 * @typedef {object} MusicOptions
 * @property {boolean} [enabled] False plays nothing and downloads nothing.
 * @property {MusicLevel} [level]
 * @property {number} [capBytes]
 * @property {number} [crossfade] Seconds.
 * @property {() => number} [random]
 * @property {(key:string, hash?:string) => string} [mediaUrl]
 * @property {typeof fetch} [fetch]
 * @property {{open(name:string):Promise<Cache>,}} [caches]
 * @property {Pick<Storage,"getItem"|"setItem">} [storage]
 * @property {() => AudioContext} [createContext]
 * @property {() => HTMLAudioElement} [createElement]
 * @property {(blob:Blob) => string} [createObjectURL]
 * @property {(url:string) => void} [revokeObjectURL]
 * @property {() => Promise<unknown>} [persist]
 * @property {() => number} [now]
 */

/** @param {MusicOptions} [options] */
export function createMusic(options = {}) {
  const enabled = options.enabled ?? true;
  let level = options.level ?? "50";
  const capBytes = options.capBytes ?? CACHE_CAP_BYTES;
  const crossfade = options.crossfade ?? CROSSFADE_SECONDS;
  let random = options.random ?? Math.random;
  const mediaUrl = options.mediaUrl ?? build.mediaUrl;
  const fetchMedia = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const cacheStorage = options.caches ?? globalThis.caches;
  const storage = options.storage ?? safeStorage();
  const createContext = options.createContext ??
    (() => new (globalThis.AudioContext)());
  const createElement = options.createElement ??
    (() => new globalThis.Audio());
  const createObjectURL = options.createObjectURL ??
    ((blob) => URL.createObjectURL(blob));
  const revokeObjectURL = options.revokeObjectURL ??
    ((url) => URL.revokeObjectURL(url));
  const persist = options.persist ??
    (() => globalThis.navigator?.storage?.persist?.() ?? Promise.resolve());
  const now = options.now ?? (() => Date.now());

  /** @type {Track[]} */
  let tracks = [];
  /** @type {string[]} */
  let mood = [];
  /** @type {AudioContext|null} */
  let audio = null;
  /** @type {GainNode|null} */
  let master = null;
  let started = false;
  let persistAsked = false;
  /** @type {Promise<void>} */
  let loaded = Promise.resolve();
  /** @type {Active|null} */
  let current = null;
  /** @type {{track:Track,load:Promise<{blob:Blob,url:string}>}|null} */
  let upcoming = null;
  /** The host's listener for each track the conductor starts (ADR 0009). @type {((track:{key:string,hash:string}) => void)|null} */
  let trackListener = null;
  /** The track the conductor is counting out while no audio plays (Music Off). @type {{track:Track,startedAt:number,timer:ReturnType<typeof setTimeout>}|null} */
  let virtual = null;
  /** The cue a guest follows: the track and the `now()` time it was at its start. @type {{track:{key:string,hash:string},startedAt:number}|null} */
  let following = null;
  /** Bumped by each cue, so a load for an older cue gives up. */
  let followTurn = 0;
  /** Keys played, oldest first. @type {string[]} */
  const recent = [];
  /** Keys that failed since the mood was set. @type {Set<string>} */
  const failed = new Set();
  let failures = 0;
  /** The first track error, for the menu's audio line. */
  let firstError = "";
  let stopped = false;
  let advancing = false;
  /** Bumped when the volume turns off, so work in flight gives up. */
  let generation = 0;
  /** @type {"idle"|"loading"|"playing"|"stopped"} */
  let status = "idle";
  /** @type {Promise<Cache|null>|null} */
  let cacheHandle = null;
  /** @type {Record<string,PlayRecord>} */
  const plays = readPlays();

  /**
   * @typedef {object} Active
   * @property {Track} track @property {string} url
   * @property {HTMLAudioElement} element @property {GainNode} gain
   * @property {string} objectUrl
   * @property {boolean} advanced Whether the next track was already asked for.
   * @property {number} startedAt The `now()` time the track was at its start.
   * @property {number} offset Seconds into the track where this play began.
   * @property {() => void} dispose
   */

  function safeStorage() {
    try {
      return globalThis.localStorage;
    } catch {
      return undefined;
    }
  }

  /** @returns {Record<string,PlayRecord>} */
  function readPlays() {
    try {
      const parsed = JSON.parse(storage?.getItem(PLAYS_KEY) ?? "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writePlays() {
    try {
      storage?.setItem(PLAYS_KEY, JSON.stringify(plays));
    } catch {
      // Without storage the least recently played order is lost, not the music.
    }
  }

  function openCache() {
    cacheHandle ??= Promise.resolve().then(() =>
      cacheStorage?.open(CACHE_NAME) ?? null
    ).catch(() => null);
    return cacheHandle;
  }

  const volume = () => MUSIC_VOLUME[level];
  /** Whether the player may start a track now. */
  const canPlay = () =>
    enabled && volume() > 0 && Boolean(audio) && !stopped &&
    tracks.length > 0 &&
    mood.length > 0;
  /** Whether a cued track may play: audio is unlocked and the volume is up. */
  const canHear = () => enabled && volume() > 0 && Boolean(audio);
  const matches = (/** @type {Track} */ track) =>
    track.tags.some((tag) => mood.includes(tag));

  /** The index from the bucket, else the last good copy in the device cache. */
  async function loadIndex() {
    const url = mediaUrl(INDEX_KEY);
    const cache = await openCache();
    /** @type {Track[]} */
    let found = [];
    try {
      const response = await fetchMedia(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      found = parseIndex(JSON.parse(text));
      if (found.length && cache) {
        await cache.put(
          url,
          new Response(text, {
            headers: { "content-type": "application/json" },
          }),
        ).catch(() => {});
      }
    } catch {
      try {
        const kept = await cache?.match(url);
        if (kept) found = parseIndex(await kept.json());
      } catch {
        // No index and no copy: the player stays quiet.
      }
    }
    tracks = found;
  }

  /** Match the play record to the cache: drop what is gone, add what we did not write. */
  async function reconcile() {
    const cache = await openCache();
    if (!cache) return;
    try {
      const urls = (await cache.keys()).map((request) => request.url).filter(
        isMusicUrl,
      );
      for (const url of Object.keys(plays)) {
        if (!urls.includes(url)) delete plays[url];
      }
      for (const url of urls) {
        if (plays[url]) continue;
        const stored = await cache.match(url);
        plays[url] = { played: 0, bytes: (await stored?.blob())?.size ?? 0 };
      }
      writePlays();
    } catch {
      // The record stays as it was.
    }
  }

  /** @param {string} url */
  const isMusicUrl = (url) => url.includes("/media/music/");

  /** Delete the least recently played tracks until the cache fits. @param {string[]} keep */
  async function enforceCap(keep) {
    const cache = await openCache();
    const entries = Object.entries(plays).map(([url, record]) => ({
      url,
      bytes: record.bytes,
      played: record.played,
    }));
    for (const url of evictionPlan(entries, capBytes, new Set(keep))) {
      await cache?.delete(url).catch(() => {});
      delete plays[url];
    }
    writePlays();
  }

  /**
   * A track's audio: from the device cache when it is there (no network), else
   * downloaded and cached.
   * @param {Track} track
   */
  async function loadTrack(track) {
    const url = mediaUrl(track.key, track.hash);
    const cache = await openCache();
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) {
      const blob = await hit.blob();
      return { blob, url };
    }
    const response = await fetchMedia(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (cache) {
      try {
        await cache.put(
          url,
          new Response(blob, {
            headers: { "content-type": blob.type || "audio/ogg" },
          }),
        );
        plays[url] = { played: plays[url]?.played ?? 0, bytes: blob.size };
        await enforceCap([
          url,
          ...(current ? [current.url] : []),
          ...(upcoming
            ? [mediaUrl(upcoming.track.key, upcoming.track.hash)]
            : []),
        ]);
      } catch {
        // A full or blocked cache still lets the track play.
      }
    }
    return { blob, url };
  }

  /** Ask for the next track now, so its download is under way while this one plays. */
  function prefetch() {
    if (!canPlay() || following) return;
    const track = pickTrack(tracks, mood, { recent, exclude: failed, random });
    if (!track) return;
    const load = loadTrack(track);
    load.catch(() => {});
    upcoming = { track, load };
  }

  /**
   * @param {Track} track @param {{blob:Blob,url:string}} loadedTrack
   * @param {{offset?:number,notify?:boolean}} [where] `offset` seconds into the
   *   track; `notify` false when the track did not start now (a resume or a cue).
   */
  async function startTrack(track, loadedTrack, where = {}) {
    const { offset = 0, notify = true } = where;
    const context = /** @type {AudioContext} */ (audio);
    const element = createElement();
    const objectUrl = createObjectURL(loadedTrack.blob);
    element.src = objectUrl;
    if (offset > 0) element.currentTime = offset;
    const source = context.createMediaElementSource(element);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(/** @type {GainNode} */ (master));
    const previous = current;
    gain.gain.value = previous ? 0 : 1;
    /** @type {Active} */
    const active = {
      track,
      url: loadedTrack.url,
      element,
      gain,
      objectUrl,
      advanced: false,
      startedAt: now() - offset * 1000,
      offset,
      dispose() {
        try {
          element.pause();
          source.disconnect();
          gain.disconnect();
        } catch {
          // Already torn down.
        }
        revokeObjectURL(objectUrl);
      },
    };
    try {
      await element.play();
    } catch (error) {
      active.dispose();
      throw error;
    }
    element.addEventListener("timeupdate", () => {
      if (
        current === active && !active.advanced &&
        element.duration - element.currentTime <= crossfade
      ) {
        active.advanced = true;
        void advance();
      }
    });
    element.addEventListener("ended", () => {
      if (current !== active) return;
      if (!active.advanced) {
        active.advanced = true;
        void advance();
      }
    });
    element.addEventListener("error", () => {
      if (current !== active) return;
      failed.add(track.key);
      failures++;
      stopCurrent();
      if (failures >= MAX_FAILURES) {
        stopped = true;
        status = "stopped";
      } else void advance();
    });
    current = active;
    failures = 0;
    status = "playing";
    plays[active.url] = {
      played: now(),
      bytes: plays[active.url]?.bytes ?? loadedTrack.blob.size,
    };
    writePlays();
    recent.push(track.key);
    if (recent.length > RECENT_LIMIT * 4) recent.splice(0, recent.length - 20);
    if (previous) fadeOver(previous, active);
    if (notify) trackListener?.({ key: track.key, hash: track.hash });
    prefetch();
  }

  function clearVirtual() {
    if (virtual) clearTimeout(virtual.timer);
    virtual = null;
  }

  /**
   * The conductor counts a track out without audio: the next one starts when
   * this one is `crossfade` from its end, as it would if it played.
   * @param {Track} track @param {number} startedAt
   */
  function conductVirtual(track, startedAt) {
    clearVirtual();
    const seconds = (track.duration ?? DEFAULT_DURATION) - crossfade;
    const delay = Math.max(0, startedAt + seconds * 1000 - now());
    const timer = setTimeout(() => {
      virtual = null;
      void advance();
    }, delay);
    virtual = { track, startedAt, timer };
  }

  /** With no audio to play, a host still picks tracks so its guests have a conductor. */
  function conductSilently() {
    if (!trackListener || !enabled || stopped) return;
    if (!tracks.length || !mood.length) return;
    if (virtual && matches(virtual.track)) return;
    const track = pickTrack(tracks, mood, { recent, exclude: failed, random });
    if (!track) return;
    recent.push(track.key);
    if (recent.length > RECENT_LIMIT * 4) recent.splice(0, recent.length - 20);
    conductVirtual(track, now());
    trackListener({ key: track.key, hash: track.hash });
  }

  /**
   * A guest plays the cued track from where the host is in it. `force` starts
   * it even over a playing track (a new cue); otherwise only when none plays.
   * A track the index does not list, or that fails, leaves the current one.
   * @param {boolean} force
   */
  async function syncFollow(force) {
    const target = following;
    if (!target || !canHear() || (!force && current)) return;
    const turn = ++followTurn;
    const turnGeneration = generation;
    await loaded;
    const stale = () =>
      turn !== followTurn || turnGeneration !== generation || !canHear();
    if (stale()) return;
    const listed = tracks.find((entry) => entry.key === target.track.key);
    if (!listed) return;
    const track = { ...listed, hash: target.track.hash };
    const offset = () => Math.max(0, (now() - target.startedAt) / 1000);
    if (listed.duration !== undefined && offset() >= listed.duration) return;
    status = current ? "playing" : "loading";
    try {
      const loadedTrack = await loadTrack(track);
      if (stale()) return;
      await startTrack(track, loadedTrack, {
        offset: offset(),
        notify: false,
      });
    } catch {
      failed.add(track.key);
      if (!current) status = "idle";
    }
  }

  /** Crossfade: the new track rises while the old falls, then the old is torn down. */
  function fadeOver(/** @type {Active} */ old, /** @type {Active} */ fresh) {
    const time = audio?.currentTime ?? 0;
    for (
      const [track, from, to]
        of /** @type {const} */ ([[old, 1, 0], [fresh, 0, 1]])
    ) {
      track.gain.gain.setValueAtTime(from, time);
      track.gain.gain.linearRampToValueAtTime(to, time + crossfade);
    }
    setTimeout(() => old.dispose(), crossfade * 1000 + 100);
  }

  function stopCurrent() {
    current?.dispose();
    current = null;
  }

  /** Start the next track: the prefetched one when it still fits the mood. */
  async function advance() {
    if (advancing || following || !enabled) return;
    if (!canPlay()) {
      conductSilently();
      return;
    }
    advancing = true;
    const turn = generation;
    try {
      while (canPlay() && turn === generation) {
        // A host that had no audio resumes the track its conductor was counting.
        const resumed = virtual?.track;
        const startedAt = virtual?.startedAt ?? 0;
        const resumeOffset = (now() - startedAt) / 1000;
        const resume =
          resumed && !failed.has(resumed.key) && matches(resumed) &&
            resumeOffset < (resumed.duration ?? DEFAULT_DURATION) - crossfade
            ? resumed
            : null;
        clearVirtual();
        const wanted = !resume && upcoming && !failed.has(upcoming.track.key) &&
            matches(upcoming.track)
          ? upcoming
          : null;
        upcoming = null;
        const track = resume ?? wanted?.track ??
          pickTrack(tracks, mood, { recent, exclude: failed, random });
        if (!track) {
          status = "idle";
          return;
        }
        status = current ? "playing" : "loading";
        try {
          const loadedTrack = await (wanted?.load ?? loadTrack(track));
          if (turn !== generation || following) return;
          await startTrack(
            track,
            loadedTrack,
            resume ? { offset: Math.max(0, resumeOffset), notify: false } : {},
          );
          return;
        } catch (error) {
          failed.add(track.key);
          failures++;
          firstError ||= error instanceof Error
            ? `${error.name} ${error.message}`
            : String(error);
          if (failures >= MAX_FAILURES) {
            stopped = true;
            status = current ? "playing" : "stopped";
            return;
          }
        }
      }
    } finally {
      advancing = false;
      if (turn !== generation) void advance();
    }
  }

  /** @param {number} level */
  function applyVolume(level) {
    if (master) master.gain.value = level;
  }

  function silence() {
    generation++;
    upcoming = null;
    const was = current;
    stopCurrent();
    status = "idle";
    // A host's conductor keeps counting the track that was playing.
    if (was && trackListener && !following) {
      conductVirtual(was.track, was.startedAt);
    }
  }

  return {
    /** Load the index. Nothing plays until `unlock` runs in a gesture. @param {string[]} [first] */
    start(first = GAME_MOOD) {
      if (started || !enabled) return;
      started = true;
      mood = first.slice();
      globalThis.document?.addEventListener("visibilitychange", () => {
        if (!audio) return;
        if (document.hidden) audio.suspend?.();
        else audio.resume?.();
      });
      loaded = reconcile().then(loadIndex).then(() => {
        void advance();
      });
    },
    /** Create or resume the audio context, then play; call it from a user gesture. */
    unlock() {
      if (!enabled) return;
      useMediaSession();
      try {
        if (!audio) {
          audio = createContext();
          master = audio.createGain();
          master.connect(audio.destination);
          applyVolume(volume());
        }
        if (audio.state === "suspended") audio.resume?.();
      } catch {
        audio = null;
        return;
      }
      if (!persistAsked) {
        persistAsked = true;
        void Promise.resolve(persist()).catch(() => {});
      }
      // Every key press and tap calls this; only start a track when none plays
      // yet, or holding a movement key would skip to a new track each repeat.
      if (started && !current) {
        void loaded.then(() => {
          if (!current) return following ? syncFollow(false) : advance();
        });
      }
    },
    /**
     * Host side (ADR 0009): `listener` hears each track the conductor starts,
     * even with Music Off, so the host can send a music cue. With a listener,
     * the player keeps picking tracks and counts each one out by its `duration`
     * while no audio plays.
     * @param {(track:{key:string,hash:string}) => void} listener
     */
    onTrackStart(listener) {
      trackListener = listener;
      if (started && !current && !following) void loaded.then(() => advance());
    },
    /**
     * Guest side (ADR 0009): stop picking and play `track` from `offsetSeconds`,
     * crossfading from the previous one; null goes back to picking locally.
     * With Music Off, or before the first gesture, nothing downloads: the cue
     * is kept and the track starts at its then-current offset.
     * @param {{key:string,hash:string}|null} track @param {number} offsetSeconds
     */
    follow(track, offsetSeconds) {
      if (!enabled) return;
      followTurn++;
      if (!track) {
        following = null;
        if (!current) void advance();
        else if (!upcoming) prefetch();
        return;
      }
      following = {
        track: { key: track.key, hash: track.hash },
        startedAt: now() - Math.max(0, offsetSeconds) * 1000,
      };
      clearVirtual();
      upcoming = null;
      void syncFollow(true);
    },
    /**
     * Play for this mood from now on: tracks that share a tag. A playing track
     * that does not fit crossfades into one that does.
     * @param {string[]} tags
     */
    setMood(tags) {
      mood = tags.filter((tag) => typeof tag === "string");
      failed.clear();
      failures = 0;
      stopped = false;
      if (upcoming && !matches(upcoming.track)) upcoming = null;
      if (!current) status = "idle";
      if (!current || !matches(current.track)) void advance();
      else if (!upcoming) prefetch();
    },
    /** @param {MusicLevel} value */
    setLevel(value) {
      level = value;
      applyVolume(volume());
      if (!enabled) return;
      if (value === "off") silence();
      else if (!current) void (following ? syncFollow(false) : advance());
    },
    /** For tests: the source of randomness. @param {() => number} source */
    setRandom(source) {
      random = source;
    },
    get level() {
      return level;
    },
    get enabled() {
      return enabled;
    },
    /** What the harness and the F3 panel show. */
    state() {
      const urls = Object.keys(plays);
      return {
        enabled,
        level,
        status,
        mood: mood.slice(),
        track: current?.track.key ?? null,
        /** Seconds into the playing track where this client began it: 0 unless it joined mid-track. */
        offset: current?.offset ?? 0,
        /** `host` while a world host conducts, `cued` for a guest, else `local`. */
        role: following ? "cued" : trackListener ? "host" : "local",
        /** The track the conductor or the cue names, playing or not. */
        cue: following?.track.key ?? virtual?.track.key ??
          (trackListener ? current?.track.key ?? null : null),
        next: upcoming?.track.key ?? null,
        skipped: [...failed],
        failures,
        firstError,
        context: audio?.state ?? "none",
        recent: recent.slice(),
        cachedTracks: urls.length,
        cachedBytes: urls.reduce((sum, url) => sum + plays[url].bytes, 0),
      };
    },
    /** The F3 panel line. */
    line() {
      const state = this.state();
      const megabytes = (state.cachedBytes / (1024 * 1024)).toFixed(1);
      if (!enabled) return "Music off";
      const name = state.track ?? state.cue;
      const role = state.role === "local"
        ? ""
        : ` (${state.role === "host" ? "host" : "cued"})`;
      return `Music ${name ? trackName(name) : state.status}${role}  ${
        state.mood.join(",")
      }  cached ${state.cachedTracks} tracks, ${megabytes} MB`;
    },
  };
}

/** @typedef {ReturnType<typeof createMusic>} Music */
