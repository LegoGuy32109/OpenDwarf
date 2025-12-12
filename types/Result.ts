export type AsyncResult<T = void> = Promise<Result<T>>;
type EmtpyResult = { success: true } | {
  success: false;
  errors: Array<string>;
};
export type Result<T = void> = T extends void ? EmtpyResult
  : T & EmtpyResult;
