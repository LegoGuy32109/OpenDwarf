/// <reference lib="deno.unstable" />
import QRCode from "qrcode-svg";
const ROOT = new URL("../../", import.meta.url);
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};
const SESSION_TTL_MS = 30_000;
type Signal = {
  id: string;
  from: string;
  kind: string;
  data: unknown;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function file(path: string): Promise<Response> {
  const extension = path.slice(path.lastIndexOf("."));
  const mime = CONTENT_TYPES[extension];
  if (!mime || path.includes("..") || path.includes("\\")) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const bytes = await Deno.readFile(new URL(path, ROOT));
    return new Response(bytes, {
      headers: {
        "content-type": mime,
        "cache-control": extension !== ".png"
          ? "no-cache"
          : "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function appendSignal(
  kv: Deno.Kv,
  session: string,
  recipient: string,
  signal: Signal,
) {
  const key = ["mailbox", session, recipient];
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = await kv.get<Signal[]>(key);
    const updated = [...(entry.value ?? []), signal].slice(-32);
    const result = await kv.atomic().check(entry).set(key, updated, {
      expireIn: 60_000,
    }).commit();
    if (result.ok) return true;
  }
  return false;
}

function signalStream(
  kv: Deno.Kv,
  session: string,
  recipient: string,
): Response {
  const key = ["mailbox", session, recipient];
  const encoder = new TextEncoder();
  const watcher = kv.watch([key]);
  const reader = watcher.getReader();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const seen = new Set<string>();
      void (async () => {
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            const [entry] = next.value;
            for (const signal of (entry.value as Signal[] | null) ?? []) {
              if (seen.has(signal.id)) continue;
              seen.add(signal.id);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(signal)}\n\n`),
              );
            }
          }
        } catch (error) {
          if (!(error instanceof TypeError)) {
            console.error("Signal stream ended", error);
          }
        } finally {
          try {
            controller.close();
          } catch { /* Browser closed the stream. */ }
        }
      })();
    },
    cancel() {
      void reader.cancel();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
}

async function iceServers(): Promise<Response> {
  const ident = Deno.env.get("XIRSYS_IDENT");
  const secret = Deno.env.get("XIRSYS_SECRET");
  const channel = Deno.env.get("XIRSYS_CHANNEL");
  if (!ident || !secret || !channel) return json({ iceServers: [] });
  const result = await fetch(
    `https://global.xirsys.net/_turn/${
      encodeURIComponent(channel)
    }?webrtc=1&expire=60`,
    {
      method: "PUT",
      headers: { authorization: `Basic ${btoa(`${ident}:${secret}`)}` },
    },
  );
  if (!result.ok) return json({ error: "ICE credentials unavailable" }, 502);
  const response = await result.json() as { v?: { iceServers?: unknown } };
  return json({ iceServers: response.v?.iceServers ?? [] });
}

export function createApp(
  kv: Deno.Kv,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (
      (path === "/" || path === "/admin" || path === "/phone-test" ||
        /^\/join\/[a-zA-Z0-9_-]{8,80}$/.test(path)) &&
      request.method === "GET"
    ) {
      return file("public/index.html");
    }
    const qrPath = /^\/api\/qr\/([a-zA-Z0-9_-]{8,80})$/.exec(path);
    if (qrPath && request.method === "GET") {
      const link = new URL(`/join/${qrPath[1]}`, request.url).href;
      const svg = new QRCode({
        content: link,
        width: 384,
        height: 384,
        ecl: "M",
        join: true,
      }).svg();
      return new Response(svg, {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    const testPath =
      /^\/api\/phone-test\/([a-f0-9]{32})\/(register|command|result|state)$/
        .exec(path);
    if (testPath) {
      const [, code, action] = testPath;
      const key = ["phone-test", code];
      const entry = await kv.get<{
        command?: { id: string; kind: string; data?: string };
        result?: unknown;
        updated: number;
      }>(key);
      if (action === "register" && request.method === "POST") {
        const value = entry.value ?? { updated: Date.now() };
        await kv.set(key, { ...value, updated: Date.now() }, {
          expireIn: 30 * 60_000,
        });
        return json({ ok: true });
      }
      if (!entry.value) return json({ error: "test session missing" }, 404);
      if (action === "state" && request.method === "GET") {
        return json(entry.value);
      }
      if (action === "command" && request.method === "POST") {
        const data = await body(request);
        if (
          typeof data.kind !== "string" ||
          !["sample", "join", "relay", "drop"].includes(data.kind) ||
          (data.data !== undefined && typeof data.data !== "string")
        ) return json({ error: "invalid test command" }, 400);
        const command = {
          id: crypto.randomUUID(),
          kind: data.kind,
          data: typeof data.data === "string" ? data.data : undefined,
        };
        await kv.set(key, { ...entry.value, command, result: null }, {
          expireIn: 30 * 60_000,
        });
        return json({ command });
      }
      if (action === "result" && request.method === "POST") {
        const data = await body(request);
        if (data.id !== entry.value.command?.id) {
          return json({ error: "stale test command" }, 409);
        }
        await kv.set(key, { ...entry.value, result: data.result }, {
          expireIn: 30 * 60_000,
        });
        return json({ ok: true });
      }
      return json({ error: "invalid test request" }, 405);
    }
    if (path === "/api/presence" && request.method === "POST") {
      const data = await body(request);
      const id = data.id;
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
        return json({ error: "invalid session" }, 400);
      }
      await kv.set(["presence", id], { id, lastSeen: Date.now() }, {
        expireIn: SESSION_TTL_MS,
      });
      return json({ ok: true });
    }
    const presencePath = /^\/api\/presence\/([a-zA-Z0-9_-]{8,80})$/.exec(path);
    if (presencePath && request.method === "DELETE") {
      await kv.delete(["presence", presencePath[1]]);
      return json({ ok: true });
    }
    if (path === "/api/admin/sessions" && request.method === "GET") {
      const sessions = [];
      for await (
        const entry of kv.list<{ id: string; lastSeen: number }>({
          prefix: ["presence"],
        })
      ) {
        if (Date.now() - entry.value.lastSeen <= SESSION_TTL_MS) {
          sessions.push(entry.value);
        }
      }
      return json({ sessions });
    }
    if (path === "/api/ice" && request.method === "GET") return iceServers();
    if (path === "/api/telemetry" && request.method === "POST") {
      if (Number(request.headers.get("content-length") ?? 0) > 4096) {
        return json({ error: "telemetry too large" }, 413);
      }
      const data = await body(request);
      const kind = data.kind;
      if (
        typeof kind !== "string" ||
        !["summary", "connection", "error"].includes(kind) ||
        typeof data.session !== "string" ||
        !/^[a-zA-Z0-9_-]{8,80}$/.test(data.session)
      ) return json({ error: "invalid telemetry" }, 400);
      const number = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value)
          ? Math.round(value * 100) / 100
          : null;
      const safe = {
        event: "open-dwarf-client",
        at: new Date().toISOString(),
        kind,
        session: data.session,
        participant: typeof data.participant === "string" &&
            /^(self|peer-[a-f0-9-]{36})$/.test(data.participant)
          ? data.participant
          : "unknown",
        role: data.role === "host" ? "host" : "guest",
        test: data.test === true,
        route: typeof data.route === "string" &&
            /^(host|srflx|relay|prflx|\?|none|connecting)(\/(host|srflx|relay|prflx|\?))?$/
              .test(data.route)
          ? data.route
          : "unknown",
        status: typeof data.status === "string" &&
            /^[a-z-]{1,32}$/.test(data.status)
          ? data.status
          : "unknown",
        players: number(data.players),
        frameMeanMs: number(data.frameMeanMs),
        frameMaxMs: number(data.frameMaxMs),
        rttMs: number(data.rttMs),
        bytesSent: number(data.bytesSent),
        queuedBytes: number(data.queuedBytes),
      };
      console.log(JSON.stringify(safe));
      return json({ ok: true });
    }
    const signalPath =
      /^\/api\/signal\/([a-zA-Z0-9_-]{8,80})\/(host|peer-[a-f0-9-]{36})$/
        .exec(path);
    if (signalPath && request.method === "GET") {
      return signalStream(kv, signalPath[1], signalPath[2]);
    }
    if (signalPath && request.method === "POST") {
      const data = await body(request);
      if (
        typeof data.kind !== "string" || typeof data.id !== "string" ||
        typeof data.from !== "string" ||
        (signalPath[2] === "host"
          ? !/^peer-[a-f0-9-]{36}$/.test(data.from)
          : data.from !== "host")
      ) {
        return json({ error: "invalid signal" }, 400);
      }
      const signal: Signal = {
        id: data.id,
        from: data.from,
        kind: data.kind,
        data: data.data,
      };
      const ok = await appendSignal(kv, signalPath[1], signalPath[2], signal);
      return ok
        ? json({ ok: true })
        : json({ error: "signal contention" }, 503);
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (
      path.startsWith("/assets/") || path.startsWith("/css/") ||
      path.startsWith("/js/")
    ) {
      return file(`public${path}`);
    }
    if (path.startsWith("/src/client/") || path.startsWith("/src/shared/")) {
      return file(path.slice(1));
    }
    return new Response("Not found", { status: 404 });
  };
}
