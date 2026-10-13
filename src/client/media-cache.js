// @ts-check
// Cache access and index fallback shared by music and effects.

/** @param {{open(name:string):Promise<Cache>}|undefined} storage @param {string} name */
export function createCacheAccess(storage, name) {
  /** @type {Promise<Cache|null>|null} */
  let handle = null;
  return () => {
    handle ??= Promise.resolve().then(() => storage?.open(name) ?? null)
      .catch(() => null);
    return handle;
  };
}

/**
 * @template Entry
 * @param {string} url @param {(data:unknown)=>Entry[]} parse
 * @param {typeof fetch} fetchMedia @param {Cache|null} cache
 * @returns {Promise<Entry[]>}
 */
export async function loadMediaIndex(url, parse, fetchMedia, cache) {
  try {
    const response = await fetchMedia(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const found = parse(JSON.parse(text));
    if (found.length && cache) {
      await cache.put(
        url,
        new Response(text, { headers: { "content-type": "application/json" } }),
      )
        .catch(() => {});
    }
    return found;
  } catch {
    try {
      const kept = await cache?.match(url);
      return kept ? parse(await kept.json()) : [];
    } catch {
      return [];
    }
  }
}

/** @typedef {{key:string,hash:string,tags:string[]}} MediaEntry */
/** Common index fields, in declaration order, with the first valid key retained.
 * @param {unknown} list @returns {{entry:Record<string,unknown>,media:MediaEntry}[]}
 */
export function mediaEntries(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { key, hash, tags } = entry;
    if (typeof key !== "string" || !key || seen.has(key)) continue;
    if (typeof hash !== "string" || !hash || !Array.isArray(tags)) continue;
    const kept = tags.filter((/** @type {unknown} */ tag) =>
      typeof tag === "string" && tag
    );
    if (!kept.length) continue;
    seen.add(key);
    result.push({ entry, media: { key, hash, tags: kept } });
  }
  return result;
}
