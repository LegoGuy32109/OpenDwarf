/** A fixed window counter per key, kept in memory. */
export interface RateLimiter {
  /** True when the key may act now; counts the action. */
  allow(key: string): boolean;
}

export function createRateLimiter(
  options: { limit: number; windowMs: number; now?: () => number },
): RateLimiter {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    allow(key) {
      const time = now();
      if (windows.size > 1000) {
        for (const [other, entry] of windows) {
          if (time - entry.start >= options.windowMs) windows.delete(other);
        }
      }
      const entry = windows.get(key);
      if (!entry || time - entry.start >= options.windowMs) {
        windows.set(key, { start: time, count: 1 });
        return true;
      }
      if (entry.count >= options.limit) return false;
      entry.count++;
      return true;
    },
  };
}
