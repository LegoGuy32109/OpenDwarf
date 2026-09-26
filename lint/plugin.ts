/// <reference lib="deno.unstable" />
// Deno.lint (the plugin API and runPlugin) is declared only in the unstable lib; referencing it here
// keeps it out of the application's own type check.
// Project lint rules, loaded by `deno lint` through `lint.plugins` in deno.json.
//
// open-dwarf/jsdoc-no-any: browser code is JavaScript typed with JSDoc, and the built-in no-explicit-any
// rule reads only TypeScript syntax. This rule reads the type expression of every type-bearing JSDoc
// tag and reports `any`, or the JSDoc wildcard `*`, wherever it appears inside that type.

/** JSDoc tags whose `{...}` holds a type expression. */
const TYPE_TAGS = new Set([
  "param",
  "arg",
  "argument",
  "returns",
  "return",
  "type",
  "typedef",
  "property",
  "prop",
  "template",
  "callback",
  "this",
  "throws",
  "exception",
  "satisfies",
  "enum",
  "yields",
]);

export interface Finding {
  /** Offset of the offending token from the start of the comment text. */
  start: number;
  end: number;
  token: "any" | "*";
}

/**
 * The end of the `{...}` type that opens at `open`, balancing nested braces and skipping string
 * literals, or -1 when the braces never close.
 */
function typeEnd(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      const close = text.indexOf(char, index + 1);
      if (close === -1) return -1;
      index = close;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** `any` and bare `*` tokens in one type expression, outside string literals. */
function tokensIn(type: string, offset: number): Finding[] {
  const findings: Finding[] = [];
  // Blank out string literals, and the leading `*` of each continuation line of a multi-line type,
  // keeping every offset where it was.
  const masked = type
    .replace(
      /"[^"]*"|'[^']*'|`[^`]*`/g,
      (literal) => " ".repeat(literal.length),
    )
    .replace(/\n[ \t]*\*/g, (prefix) => "\n" + " ".repeat(prefix.length - 1));
  for (const match of masked.matchAll(/(?<![\w$.])any(?![\w$])/g)) {
    findings.push({
      start: offset + match.index,
      end: offset + match.index + 3,
      token: "any",
    });
  }
  // `*` is the JSDoc wildcard only when it stands for a whole type: `{*}`, `Array<*>`, `*[]`.
  for (const match of masked.matchAll(/(?<=^|[\s<(,|:])\*(?=$|[\s>),|\[])/g)) {
    findings.push({
      start: offset + match.index,
      end: offset + match.index + 1,
      token: "*",
    });
  }
  return findings;
}

/** Every `any` or wildcard inside the type of a type-bearing tag in one JSDoc comment's text. */
export function findJsdocAny(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const tag of text.matchAll(/@(\w+)\s*(?=\{)/g)) {
    if (!TYPE_TAGS.has(tag[1])) continue;
    const open = tag.index + tag[0].length;
    const close = typeEnd(text, open);
    if (close === -1) continue;
    findings.push(...tokensIn(text.slice(open + 1, close), open + 1));
  }
  return findings.sort((a, b) => a.start - b.start);
}

const plugin: Deno.lint.Plugin = {
  name: "open-dwarf",
  rules: {
    "jsdoc-no-any": {
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              // A JSDoc comment is a block comment whose text starts with a second `*`.
              if (comment.type !== "Block" || !comment.value.startsWith("*")) {
                continue;
              }
              // The comment's range starts at `/*`; its text starts two characters later.
              const base = comment.range[0] + 2;
              for (const finding of findJsdocAny(comment.value)) {
                context.report({
                  range: [base + finding.start, base + finding.end],
                  message: finding.token === "any"
                    ? "`any` in a JSDoc type."
                    : "`*` (any) in a JSDoc type.",
                  hint:
                    "Name the type, or use `unknown` and narrow it where the value is read.",
                });
              }
            }
          },
        };
      },
    },
  },
};

export default plugin;
