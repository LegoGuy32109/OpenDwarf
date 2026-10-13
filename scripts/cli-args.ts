/** Parse --name=value flags without interpreting their contents as shell code. */
export function cliArgs(args: string[]): Map<string, string> {
  return new Map(args.map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }));
}
