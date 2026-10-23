import { assert, assertEquals } from "@std/assert";
import {
  MESSAGE_PIECE_LIMIT,
  messagePieces,
} from "../../src/shared/message-pieces.js";

Deno.test("message pieces prefer sentence, clause, then space boundaries", () => {
  assertEquals(messagePieces("One. Two three four five six seven eight nine"), [
    "One. ",
    "Two three four five six seven eight nine",
  ]);
  assertEquals(
    messagePieces("alpha beta, gamma delta epsilon zeta eta theta iota"),
    ["alpha beta, ", "gamma delta epsilon zeta eta theta iota"],
  );
  assertEquals(messagePieces("alpha beta gamma delta epsilon zeta eta theta"), [
    "alpha beta gamma delta epsilon zeta eta ",
    "theta",
  ]);
});

Deno.test("message pieces use syllable hyphens and hard breaks for long tokens", () => {
  const syllabic = messagePieces(`${"mountain".repeat(6)} end`);
  assert(syllabic[0].endsWith("-"));
  assert(syllabic[0].length <= MESSAGE_PIECE_LIMIT);
  const hard = messagePieces("x".repeat(80));
  assertEquals(hard, [`${"x".repeat(39)}-`, `${"x".repeat(39)}-`, "xx"]);
  const url = `https://example.test/${"path".repeat(12)}`;
  assertEquals(messagePieces(url)[0], `${url.slice(0, 39)}-`);
});

Deno.test("message pieces move fitting words when the current piece is half full", () => {
  assertEquals(messagePieces(`${"a".repeat(25)} enormouslylongword`), [
    "a".repeat(25) + " ",
    "enormouslylongword",
  ]);
  const nextWord = "enormouslylongword".repeat(2);
  assertEquals(messagePieces(`${"a".repeat(19)} ${nextWord}`), [
    "a".repeat(19) + " ",
    nextWord,
  ]);
  const fittingWord = "extraordinarilyextraordinarily";
  assertEquals(
    messagePieces(`aaaaaaaaa ${fittingWord} extra`),
    [`aaaaaaaaa `, `${fittingWord} extra`],
  );
  const pieces = messagePieces(
    `${"a".repeat(15)} extraordinarilyextraordinarily`,
  );
  assert(pieces[0].endsWith("-"));
  assert(pieces[0].length <= MESSAGE_PIECE_LIMIT);
});

Deno.test("pieces stay bounded, have no leading space or lone punctuation, and preserve text", () => {
  for (
    const input of [
      "  A sentence, and a second sentence!  ",
      "word? ".repeat(12),
      "word: ".repeat(12),
      "https://example.test/" + "path".repeat(12),
    ]
  ) {
    const pieces = messagePieces(input);
    assert(pieces.every((piece) => piece.length <= MESSAGE_PIECE_LIMIT));
    assert(pieces.every((piece) => !piece.startsWith(" ")));
    assert(pieces.every((piece) => !/^[.!?,;:–—-]$/.test(piece)));
    assertEquals(pieces.join("").replaceAll("-", ""), input.trim());
  }
});
