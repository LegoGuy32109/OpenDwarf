/**
 * Open Dwarf debug shim.
 *
 * Exposes `window.__opendwarf` so the @opendwarf/debugger package can read
 * page-level game state, dispatch actions, and inspect events without
 * coupling to the Bevy/WASM engine. As the engine exposes more, this shim
 * grows to mirror it.
 *
 * Intentionally plain JS (no build step) so it can be served as a static
 * asset from /opendwarf-shim.js.
 */
(function () {
  if (typeof window === "undefined") return;
  if (window.__opendwarf) return; // idempotent

  const params = new URL(window.location.href).searchParams;
  const localName = params.get("playerName") ?? "";
  const localId = localName ? "player_" + localName : "";

  const startedAt = performance.now();
  const events = [];
  const actions = [];
  const messages = [];
  const subscribers = new Set();

  let tick = 0;
  // Tick counter advances at ~10Hz so waitForState() polls see motion.
  const tickInterval = setInterval(() => {
    tick++;
  }, 100);
  window.addEventListener("beforeunload", () => clearInterval(tickInterval));

  function emit(event) {
    events.push(event);
    if (events.length > 1000) events.shift();
    for (const fn of subscribers) {
      try {
        fn(event);
      } catch (_) { /* ignore subscriber errors */ }
    }
  }

  if (localId) {
    emit({ kind: "player.join", player: localPlayer() });
  }

  function localPlayer() {
    return {
      id: localId,
      name: localName,
      joinedAt: startedAt,
      position: { x: 0, y: 0 },
      stats: { hp: 100, hunger: 0, thirst: 0, energy: 100 },
      inventory: {},
    };
  }

  function snapshot() {
    const players = localId ? [localPlayer()] : [];
    return {
      tick,
      seed: 0,
      players,
      entities: actions
        .filter((a) => a.kind === "spawn")
        .map((a, i) => ({
          id: "entity_" + i,
          kind: a.entityKind ?? "unknown",
          position: { x: a.x ?? 0, y: a.y ?? 0 },
        })),
      weather: "clear",
      tiles: { width: 0, height: 0 },
    };
  }

  window.__opendwarf = {
    version: 1,

    snapshot,

    events() {
      return events.slice();
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    dispatch(action) {
      if (!action || typeof action !== "object" || !action.kind) return;
      actions.push(action);
      emit({ kind: "action", playerId: localId, action });
    },

    sendMessage(message) {
      const m = typeof message === "string"
        ? { text: message, from: localId, kind: "chat" }
        : { ...message, from: message.from ?? localId };
      messages.push(m);
      emit({ kind: "message", message: m });
    },

    messages() {
      return messages.slice();
    },

    seesPlayer(id) {
      // Single-page shim: a player only sees itself for now. Real WebRTC
      // peer enumeration plugs in here.
      return id === localId;
    },

    actions() {
      return actions.slice();
    },

    localPlayer,
  };
})();
