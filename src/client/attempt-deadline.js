/**
 * Bound an incomplete handshake independently of player creation. The caller
 * checks the deadline from its connection watchdog, so replacing an attempt
 * cannot leave an older timeout capable of closing the replacement.
 * @param {(attempt: string) => void} expire
 * @param {{timeoutMs?: number}} [options]
 */
export function createAttemptDeadline(expire, { timeoutMs = 10_000 } = {}) {
  /** @type {{id: string, expiresAt: number} | null} */
  let pending = null;
  let closed = false;
  return {
    /** @param {string} attempt @param {number} [now] */
    start(attempt, now = performance.now()) {
      if (!closed) pending = { id: attempt, expiresAt: now + timeoutMs };
    },
    /** @param {string} attempt */
    complete(attempt) {
      if (pending?.id === attempt) pending = null;
    },
    /** @param {number} [now] */
    check(now = performance.now()) {
      if (!pending || now < pending.expiresAt) return false;
      const attempt = pending.id;
      pending = null;
      expire(attempt);
      return true;
    },
    close() {
      pending = null;
      closed = true;
    },
  };
}
