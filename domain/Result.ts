import { FailedResult } from "../types/Result.ts";

export function makeError(
  error: unknown,
  existingFailure?: FailedResult,
): FailedResult {
  if (!error) {
    return existingFailure ?? { ok: false, errors: ["Invalid Error Property"] };
  }
  return {
    ok: false,
    errors: [
      String(error),
      ...(existingFailure?.errors ?? []),
    ],
  };
}
