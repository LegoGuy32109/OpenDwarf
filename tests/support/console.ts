/** Capture a test's log messages and restore the console even if its assertion throws. */
export async function captureLogs(
  run: (logged: string[]) => Promise<void>,
): Promise<string[]> {
  const logged: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => logged.push(values.join(" "));
  try {
    await run(logged);
    return logged;
  } finally {
    console.log = original;
  }
}
