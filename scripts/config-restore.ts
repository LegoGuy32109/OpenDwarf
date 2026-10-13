/** Restore a local config file rewritten by a CLI, and report whether it changed. */
export async function restoreConfig(path: URL, before: Uint8Array) {
  const after = await Deno.readFile(path);
  const changed = before.length !== after.length ||
    before.some((byte, index) => byte !== after[index]);
  if (changed) await Deno.writeFile(path, before);
  return { changed, afterBytes: after.length };
}
