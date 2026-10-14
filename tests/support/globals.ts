/** Restore each replaced global even when a test throws. */
export async function withGlobals<T>(
  values: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const before = new Map(
    Object.keys(values).map((
      key,
    ) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    return await run();
  } finally {
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}
