// learn/jsdoc-no-any: every `any` inside a JSDoc type is reported at its own position, and nothing
// outside a type is.
import { assertEquals } from "@std/assert";
import plugin, { findJsdocAny } from "../../lint/plugin.ts";

/** The source text each report points at, in order. */
function reported(source: string): string[] {
  return Deno.lint.runPlugin(plugin, "sample.js", source).map((diagnostic) =>
    source.slice(diagnostic.range[0], diagnostic.range[1])
  );
}

/** Report positions as 1-based `line:column`. */
function positions(source: string): string[] {
  return Deno.lint.runPlugin(plugin, "sample.js", source).map((diagnostic) => {
    const before = source.slice(0, diagnostic.range[0]).split("\n");
    return `${before.length}:${before.at(-1)!.length + 1}`;
  });
}

Deno.test("any is reported in every type-bearing tag, at its own position", () => {
  const source = [
    "// @ts-check",
    "/**",
    " * @param {any} a",
    " * @param {Array<any>} b",
    " * @returns {Promise<Record<string, any>>}",
    " */",
    "export function f(a, b) { return Promise.resolve({ a, b }); }",
    "/** @type {any} */",
    "export const g = /** @type {any} */ (f);",
    "/** @typedef {{ id: string, value: any }} Row */",
    "/** @template {any} T */",
    "",
  ].join("\n");
  assertEquals(reported(source), [
    "any",
    "any",
    "any",
    "any",
    "any",
    "any",
    "any",
  ]);
  assertEquals(positions(source), [
    "3:12",
    "4:18",
    "5:37",
    "8:12",
    "9:29",
    "10:36",
    "11:16",
  ]);
});

Deno.test("the JSDoc wildcard * is reported where it stands for a whole type", () => {
  assertEquals(findJsdocAny("* @type {*} "), [{
    start: 9,
    end: 10,
    token: "*",
  }]);
  assertEquals(findJsdocAny("* @param {Array<*>} x").map((f) => f.token), [
    "*",
  ]);
  assertEquals(findJsdocAny("* @param {*[]} x").map((f) => f.token), ["*"]);
});

Deno.test("a multi-line type is read across its continuation lines without flagging their *", () => {
  const text = [
    "*",
    " * @typedef {{ valid: true, fingerprint: string,",
    " *   normalizedLesson: Lesson }} Accepted",
    " * @typedef {{ valid: false,",
    " *   detail: any }} Rejected",
    " ",
  ].join("\n");
  assertEquals(findJsdocAny(text).map((finding) => finding.token), ["any"]);
});

Deno.test("prose, names containing any, string literal types and plain comments are not reported", () => {
  const source = [
    "/**",
    " * Accepts any value; returns anything but `any`.",
    " * @param {Many | Company | anyOf} a  Any of these, for any caller.",
    " * @param {\"any\" | 'any'} b",
    " * @param {typeof globalThis.any} c",
    " * @see {@link any}",
    " */",
    "export function f(a, b, c) { return [a, b, c]; }",
    "/* @type {any} is not JSDoc */",
    "// @type {any}",
    "",
  ].join("\n");
  assertEquals(reported(source), []);
});

Deno.test("an unclosed type is skipped rather than read past the comment", () => {
  assertEquals(findJsdocAny("* @param {Array<any a"), []);
});
