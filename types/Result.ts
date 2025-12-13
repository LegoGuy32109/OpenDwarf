export type AsyncResult<T = void> = Promise<Result<T>>;
export type FailedResult = {
  ok: false;
  errors: Array<string>;
};
export type Result<T = void> = T extends void ? { ok: true } | FailedResult
  : T & { ok: true } | FailedResult;
