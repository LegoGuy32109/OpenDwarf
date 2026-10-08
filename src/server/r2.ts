// The R2 signer for `/media/<key>` (ADR 0007): an AWS SigV4 query-presigned GET URL, built with
// `crypto.subtle` so the shell needs no dependency. Never log a key or a signed URL.
import type { MediaSigner } from "./media.ts";

export type R2Options = {
  accessKeyId: string;
  secretAccessKey: string;
  /** The S3 endpoint, such as `https://<account>.r2.cloudflarestorage.com`. */
  endpoint: string;
  /** The bucket, put in the path first (path style). Empty puts the key at the root. */
  bucket: string;
  region?: string;
  service?: string;
  /** Link lifetime in seconds. */
  expires?: number;
  /** The clock, passed in so tests can fix the date. */
  now?: () => Date;
};

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );

/** RFC 3986 percent-encoding, as SigV4 wants it: only `A-Za-z0-9-_.~` stay. Space is `%20`. */
const encode = (text: string) =>
  encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const sha256 = async (text: string) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

async function hmac(key: ArrayBuffer | string, text: string) {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", imported, encoder.encode(text));
}

/** Returns a signer that makes presigned GET URLs for media keys in an R2 bucket. */
export function createR2Signer(options: R2Options): MediaSigner {
  const region = options.region ?? "auto";
  const service = options.service ?? "s3";
  const expires = options.expires ?? 3600;
  const now = options.now ?? (() => new Date());
  const endpoint = new URL(options.endpoint);
  const base = endpoint.pathname.replace(/\/+$/, "");
  return async (key) => {
    const stamp = now().toISOString().replace(/[-:]|\.\d{3}/g, "");
    const day = stamp.slice(0, 8);
    const scope = `${day}/${region}/${service}/aws4_request`;
    const canonicalPath = "/" +
      [base.slice(1), options.bucket, ...key.split("/").map(encode)]
        .filter(Boolean).join("/");
    const query: [string, string][] = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${options.accessKeyId}/${scope}`],
      ["X-Amz-Date", stamp],
      ["X-Amz-Expires", String(expires)],
      ["X-Amz-SignedHeaders", "host"],
    ];
    const canonicalQuery = query
      .map(([name, value]) => `${encode(name)}=${encode(value)}`)
      .sort()
      .join("&");
    const request = [
      "GET",
      canonicalPath,
      canonicalQuery,
      `host:${endpoint.host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const toSign = [
      "AWS4-HMAC-SHA256",
      stamp,
      scope,
      await sha256(request),
    ].join("\n");
    let secret = await hmac(`AWS4${options.secretAccessKey}`, day);
    for (const part of [region, service, "aws4_request"]) {
      secret = await hmac(secret, part);
    }
    const signature = hex(await hmac(secret, toSign));
    return `${endpoint.origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  };
}

/** The signer for the `R2_*` variables, or undefined unless all four are set. */
export function signerFromEnv(
  get: (name: string) => string | undefined,
): MediaSigner | undefined {
  const accessKeyId = get("R2_ACCESS_KEY_ID");
  const secretAccessKey = get("R2_SECRET_ACCESS_KEY");
  const endpoint = get("R2_ENDPOINT");
  const bucket = get("R2_BUCKET");
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    return undefined;
  }
  return createR2Signer({ accessKeyId, secretAccessKey, endpoint, bucket });
}
