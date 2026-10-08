// `/media/<key>`: objects in the opendwarf R2 bucket (ADR 0007). With R2 configured the shell
// redirects to a presigned link; without it, it serves the file from a local folder that mirrors
// the bucket, so dev and e2e need no bucket. The shell knows nothing about what a key holds.

import { signerFromEnv } from "./r2.ts";

const DEFAULT_DIR = new URL("../../media/", import.meta.url);
const TYPES: Record<string, string> = {
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
};
const SEGMENT = /^[A-Za-z0-9 ._()~-]+$/;

/** Returns a presigned GET URL for a media key. */
export type MediaSigner = (key: string) => Promise<string>;

export type MediaOptions = {
  /** The folder that mirrors the bucket, used when there is no signer. */
  dir?: URL;
  /** Set when R2 is configured. */
  signer?: MediaSigner;
};

export type Media = {
  /** Answers `GET|HEAD /media/<key>`, or null for any other request. */
  handle(request: Request, pathname: string): Promise<Response | null>;
};

/**
 * The media key in a `/media/...` pathname, or null when the path is not a valid key: 1 to 512
 * characters of segments made of letters, digits, space and `._()~-`, none starting with `.`.
 */
export function mediaKey(pathname: string): string | null {
  if (!pathname.startsWith("/media/")) return null;
  let key: string;
  try {
    key = decodeURIComponent(pathname.slice("/media/".length));
  } catch {
    return null;
  }
  if (key.length < 1 || key.length > 512) return null;
  const segments = key.split("/");
  return segments.every((s) => SEGMENT.test(s) && !s.startsWith("."))
    ? key
    : null;
}

/** Parses a single `bytes=` range against a file size; null for a range we cannot serve. */
export function byteRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

async function serveFile(
  dir: URL,
  key: string,
  request: Request,
): Promise<Response> {
  const url = new URL(key.split("/").map(encodeURIComponent).join("/"), dir);
  let file: Deno.FsFile;
  try {
    file = await Deno.open(url);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const { size } = await file.stat();
  const extension = key.slice(key.lastIndexOf("."));
  const headers = new Headers({
    "content-type": TYPES[extension] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  const header = request.headers.get("range");
  const range = header ? byteRange(header, size) : null;
  if (header && !range) {
    file.close();
    headers.set("content-range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers.set("content-length", String(end - start + 1));
  if (range) headers.set("content-range", `bytes ${start}-${end}/${size}`);
  const status = range ? 206 : 200;
  if (request.method === "HEAD" || size === 0) {
    file.close();
    return new Response(null, { status, headers });
  }
  await file.seek(start, Deno.SeekMode.Start);
  let left = end - start + 1;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = new Uint8Array(Math.min(65536, left));
      const read = await file.read(chunk);
      if (read === null || read === 0) {
        file.close();
        controller.close();
        return;
      }
      left -= read;
      controller.enqueue(chunk.subarray(0, read));
      if (left <= 0) {
        file.close();
        controller.close();
      }
    },
    cancel() {
      file.close();
    },
  });
  return new Response(body, { status, headers });
}

export function createMedia(options: MediaOptions = {}): Media {
  const dir = options.dir ?? DEFAULT_DIR;
  return {
    async handle(request, pathname) {
      if (!pathname.startsWith("/media/")) return null;
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
      }
      const key = mediaKey(pathname);
      if (!key) return new Response("Not found", { status: 404 });
      if (options.signer) {
        return new Response(null, {
          status: 302,
          headers: {
            location: await options.signer(key),
            "cache-control": "public, max-age=300",
          },
        });
      }
      return await serveFile(dir, key, request);
    },
  };
}

/**
 * The media for this process. `OD_MEDIA_DIR` overrides the local folder. The R2 signer is used
 * only when `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` and `R2_BUCKET` are all
 * set; otherwise every request is served from the folder.
 */
export function openMedia(
  get: (name: string) => string | undefined = (name) => Deno.env.get(name),
): Media {
  const dir = get("OD_MEDIA_DIR");
  return createMedia({
    dir: dir
      ? new URL(dir.replace(/\/?$/, "/"), `file://${Deno.cwd()}/`)
      : undefined,
    signer: signerFromEnv(get),
  });
}
