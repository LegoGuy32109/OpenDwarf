// The shell's owner API under `/api/v1`: label and promotion writes, and public reads (labels, promotions, shell deploys, status). A write
// needs the owner token (`OD_OWNER_TOKEN`). The shell keeps only a SHA-256 hash of it, compares
// hashes in constant time, and never logs or returns it. Without a token set, writes answer 403.
// Terms follow CONTEXT.md: Label, Main, Promotion, Session.
import type { Builds } from "./builds.ts";
import type { Label, Store } from "./store.ts";

const LABEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA = /^[0-9a-f]{7,40}$/;
const encoder = new TextEncoder();

export interface AdminApi {
  /** Answers an admin route, or null when the path is not one. */
  handle(request: Request): Promise<Response | null>;
}

export interface AdminOptions {
  store: Store;
  builds: Builds;
  /** The owner token. Unset or empty disables every write route. */
  ownerToken?: string;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

const fail = (error: string, status: number) => json({ error }, status);

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(text)),
  );
}

/** Compares two equal-length hashes without stopping at the first difference. */
function sameHash(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ (b[i] ?? 0);
  return difference === 0;
}

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function createAdminApi(options: AdminOptions): AdminApi {
  const { store, builds } = options;
  const ownerHash = options.ownerToken
    ? sha256(options.ownerToken)
    : Promise.resolve(null);

  /** Null when the request may write; otherwise the refusal. */
  async function authorize(request: Request): Promise<Response | null> {
    const expected = await ownerHash;
    if (!expected) return fail("write routes are disabled", 403);
    const match = /^Bearer (\S+)$/.exec(
      request.headers.get("authorization") ?? "",
    );
    if (!match) return fail("owner token required", 401);
    return sameHash(await sha256(match[1]), expected)
      ? null
      : fail("owner token required", 401);
  }

  /** A label with the commit it points to now; null when GitHub has no such ref. */
  async function describe(label: Label) {
    let commit: string | null = null;
    try {
      commit = label.kind === "branch"
        ? await builds.branch(label.target)
        : await builds.commit(label.target);
    } catch {
      // GitHub is unreachable; list the label without a commit.
    }
    return { ...label, commit };
  }

  async function setLabel(name: string, request: Request) {
    if (!LABEL_NAME.test(name)) return fail("invalid label name", 400);
    const target = (await bodyOf(request)).target;
    if (typeof target !== "string" || target === "") {
      return fail("target is required", 400);
    }
    // A branch wins over a commit SHA that looks the same, as in build resolution.
    if (!/^[^\s~^:?*\[\\]{1,200}$/.test(target)) {
      return fail("invalid branch or commit", 400);
    }
    if (await builds.branch(target, { fresh: true })) {
      return json(
        await describe(
          await store.setLabel({ name, kind: "branch", target }),
        ),
      );
    }
    const sha = SHA.test(target) ? await builds.commit(target) : null;
    if (!sha) return fail(`no branch or commit named ${target}`, 404);
    return json(
      await describe(
        await store.setLabel({ name, kind: "commit", target: sha }),
      ),
    );
  }

  async function promote(request: Request) {
    const data = await bodyOf(request);
    const target = data.target;
    if (typeof target !== "string" || target === "") {
      return fail("target is required", 400);
    }
    if (data.note !== undefined && typeof data.note !== "string") {
      return fail("note must be text", 400);
    }
    const commit = await builds.resolve(target, { fresh: true });
    if (!commit) {
      return fail(`no label, branch, or commit named ${target}`, 404);
    }
    // The promotion records the label it came from; a bare SHA or an odd branch name uses the SHA.
    const label = LABEL_NAME.test(target) && !SHA.test(target)
      ? target
      : commit.slice(0, 7);
    return json(
      await store.promote({ commit, label, note: data.note as string }),
      201,
    );
  }

  async function status() {
    const [main, labels, sessions] = await Promise.all([
      store.getMain(),
      store.listLabels(),
      store.listLiveSessions(),
    ]);
    return json({
      main,
      labels: await Promise.all(labels.map(describe)),
      sessions: sessions.map((session) => ({
        id: session.id,
        buildCommit: session.buildCommit,
        label: session.label,
        started: session.started,
        lastHeartbeat: session.lastHeartbeat,
        playerCount: session.playerCount,
      })),
    });
  }

  async function route(request: Request, path: string): Promise<Response> {
    const method = request.method;
    const read = method === "GET";
    if (path === "/labels" && read) {
      const labels = await store.listLabels();
      return json({ labels: await Promise.all(labels.map(describe)) });
    }
    if (path === "/promotions" && read) {
      return json({ promotions: await store.listPromotions(50) });
    }
    if (path === "/shell-deploys" && read) {
      return json({ deploys: await store.listShellDeploys(50) });
    }
    if (path === "/status" && read) return status();
    const named = /^\/labels\/([^/]+)(\/rename)?$/.exec(path);
    const writes = (path === "/promotions" && method === "POST") ||
      (named &&
        (named[2]
          ? method === "POST"
          : method === "PUT" || method === "DELETE"));
    if (!writes) return fail("not found", 404);
    const refused = await authorize(request);
    if (refused) return refused;
    if (path === "/promotions") return promote(request);
    const name = decodeURIComponent(named![1]);
    if (named![2]) {
      const to = (await bodyOf(request)).to;
      if (typeof to !== "string") return fail("to is required", 400);
      if (!LABEL_NAME.test(to)) return fail("invalid label name", 400);
      if (!await store.getLabel(name)) return fail("no such label", 404);
      if (await store.getLabel(to) || to === name) {
        return fail("label name is taken", 409);
      }
      return json(await describe(await store.renameLabel(name, to)));
    }
    if (method === "PUT") return setLabel(name, request);
    return await store.deleteLabel(name)
      ? json({ ok: true })
      : fail("no such label", 404);
  }

  return {
    async handle(request) {
      const path =
        /^\/api\/v1(\/(?:labels|promotions|shell-deploys|status)(?:\/.*)?)$/
          .exec(
            new URL(request.url).pathname,
          )?.[1];
      if (!path) return null;
      try {
        return await route(request, path);
      } catch (error) {
        console.error(
          "Admin API failed",
          error instanceof Error ? error.message : "",
        );
        return fail("the shell could not complete the request", 502);
      }
    },
  };
}
