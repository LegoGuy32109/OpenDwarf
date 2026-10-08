import QRCode from "qrcode-svg";
import { type AdminApi, createAdminApi } from "./admin-api.ts";
import { serveAdminPage } from "./admin-page.ts";
import { type Builds, openBuilds } from "./builds.ts";
import { type Media, openMedia } from "./media.ts";
import {
  createSessionRoutes,
  type SessionRoutesOptions,
} from "./session-routes.ts";
import { openStore } from "./store.ts";
const ROOT = new URL("../../", import.meta.url);
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
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

/**
 * The address a QR code opens. A build under a base path sends its own join
 * link; accept it only when it is on this request's own origin and ends in this
 * session's join path, so the endpoint cannot encode arbitrary URLs.
 */
export function joinLink(
  request: Request,
  session: string,
  requested: string | null,
): string {
  if (requested) {
    try {
      const link = new URL(requested);
      if (
        link.origin === new URL(request.url).origin &&
        new RegExp(`^(/[a-zA-Z0-9._~-]+)*/join/${session}$`).test(link.pathname)
      ) {
        return `${link.origin}${link.pathname}`;
      }
    } catch {
      // Fall through to this server's own join link.
    }
  }
  return new URL(`/join/${session}`, request.url).href;
}

export function createApp(
  builds: Builds = openBuilds(openStore()),
  admin: AdminApi = createAdminApi({
    store: builds.store,
    builds,
    ownerToken: Deno.env.get("OD_OWNER_TOKEN"),
  }),
  options: SessionRoutesOptions = {},
  media: Media = openMedia(),
): (
  request: Request,
  info?: { remoteAddr?: { hostname?: string } },
) => Promise<Response> {
  const sessions = createSessionRoutes({ store: builds.store, ...options });
  return async (request, info) => {
    const url = new URL(request.url);
    // `/api/v1/*` is the client's API; the unversioned paths stay as aliases.
    const path = url.pathname.replace(/^\/api\/v1\//, "/api/");
    const mediaResponse = await media.handle(request, url.pathname);
    if (mediaResponse) return mediaResponse;
    // The local build's service worker loader (ADR 0007). Remote builds: see the media ticket.
    if (
      builds.local && request.method === "GET" &&
      (url.pathname === "/sw.js" || url.pathname === "/b/local/sw.js")
    ) {
      return new Response('importScripts("/js/sw-main.js"); // build local\n', {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
        },
      });
    }
    // Build pages: `/b/<name>/...`, and main at the root pages.
    if (builds.handles(url.pathname) && request.method === "GET") {
      return builds.serve(url.pathname);
    }
    if (request.method === "GET") {
      const page = await serveAdminPage(url.pathname);
      if (page) return page;
    }
    const owner = await admin.handle(request);
    if (owner) return owner;
    const qrPath = /^\/api\/qr\/([a-zA-Z0-9_-]{8,80})$/.exec(path);
    if (qrPath && request.method === "GET") {
      const link = joinLink(request, qrPath[1], url.searchParams.get("link"));
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
      const nonNegative = (value: unknown) => {
        const rounded = number(value);
        return rounded !== null && rounded >= 0 ? rounded : null;
      };
      const count = (value: unknown) => {
        const rounded = nonNegative(value);
        return rounded === null ? null : Math.round(rounded);
      };
      const safe = {
        event: "open-dwarf-client",
        at: new Date().toISOString(),
        kind,
        session: data.session,
        participant: typeof data.participant === "string" &&
            /^(self|peer-[a-f0-9-]{36})$/.test(data.participant)
          ? data.participant
          : "unknown",
        role: data.role === "host" ? "host" as const : "guest" as const,
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
      // Only a summary is kept, and for 30 days; connection and error events stay in the log.
      if (kind === "summary") {
        try {
          await builds.store.recordTelemetry({
            session: safe.session,
            route: safe.route,
            role: safe.role,
            players: count(data.players),
            frameMeanMs: nonNegative(data.frameMeanMs),
            frameMaxMs: nonNegative(data.frameMaxMs),
            rttMs: nonNegative(data.rttMs),
            bytes: count(data.bytesSent),
            test: safe.test,
          });
        } catch (error) {
          console.error("Could not store telemetry", error);
          return json({ error: "the shell could not store telemetry" }, 502);
        }
      }
      return json({ ok: true });
    }
    const sessionResponse = await sessions.handle(request, path, info);
    if (sessionResponse) return sessionResponse;
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    // Only the local build's files come from disk; other builds load from jsDelivr.
    if (builds.local) {
      if (
        path.startsWith("/assets/") || path.startsWith("/css/") ||
        path.startsWith("/js/")
      ) {
        return file(`public${path}`);
      }
      if (path.startsWith("/src/client/") || path.startsWith("/src/shared/")) {
        return file(path.slice(1));
      }
    }
    return new Response("Not found", { status: 404 });
  };
}
