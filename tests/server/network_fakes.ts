/** The GitHub commit endpoint shared by shell fixtures. Other endpoints return null. */
export function commitResponse(
  url: string,
  refs: Record<string, string>,
): Response | null {
  const ref = /\/commits\/(.+)$/.exec(url)?.[1];
  if (ref === undefined) return null;
  const value = refs[ref];
  return new Response(value || "{}", { status: value ? 200 : 422 });
}
