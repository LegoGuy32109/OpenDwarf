// @ts-check

import { syllables } from "./speech.js";

/** The maximum display width for one piece, including a soft hyphen. */
export const MESSAGE_PIECE_LIMIT = 40;

/**
 * Split one trimmed message at readable boundaries. Existing characters stay
 * in order; only a word split adds a hyphen.
 * @param {string} message
 * @returns {string[]}
 */
export function messagePieces(message) {
  let rest = message.trim();
  /** @type {string[]} */
  const pieces = [];
  while (rest.length > MESSAGE_PIECE_LIMIT) {
    const head = rest.slice(0, MESSAGE_PIECE_LIMIT);
    const firstSpace = rest.indexOf(" ");
    const firstWord = rest.slice(0, firstSpace < 0 ? rest.length : firstSpace);
    if (/^https?:\/\//i.test(firstWord) && firstWord.length > 40) {
      pieces.push(`${rest.slice(0, 39)}-`);
      rest = rest.slice(39);
      continue;
    }
    const sentence = sentenceBoundary(rest);
    const clause = clauseBoundary(rest);
    const space = head.lastIndexOf(" ");
    let cut = sentence || clause;
    if (!cut && space > 0) {
      const wordStart = space + 1;
      const wordEnd = rest.indexOf(" ", wordStart);
      const wordLength = (wordEnd < 0 ? rest.length : wordEnd) - wordStart;
      const currentLength = space + 1;
      const fitsCurrent = currentLength + wordLength <= MESSAGE_PIECE_LIMIT;
      if (
        fitsCurrent || currentLength >= 20
      ) {
        cut = space + 1;
      } else if (wordLength > MESSAGE_PIECE_LIMIT || currentLength < 20) {
        const available = MESSAGE_PIECE_LIMIT - currentLength - 1;
        const word = rest.slice(wordStart, wordStart + wordLength);
        const part = wordPart(word, available);
        if (part) {
          pieces.push(`${rest.slice(0, wordStart)}${part}-`);
          rest = rest.slice(wordStart + part.length);
          continue;
        }
        cut = space + 1;
      }
    }
    if (!cut && space > 0) cut = space + 1;
    if (!cut) {
      const tokenEnd = rest.indexOf(" ");
      const token = rest.slice(0, tokenEnd < 0 ? rest.length : tokenEnd);
      const part = wordPart(token, MESSAGE_PIECE_LIMIT - 1);
      if (part) {
        pieces.push(`${part}-`);
        rest = rest.slice(part.length);
        continue;
      }
      pieces.push(rest.slice(0, MESSAGE_PIECE_LIMIT - 1) + "-");
      rest = rest.slice(MESSAGE_PIECE_LIMIT - 1);
      continue;
    }
    const suffix = rest.slice(cut).trim();
    if (
      cut < rest.length &&
      (/\s/.test(rest[cut]) || /^[.!?,;:–—-]+$/.test(suffix))
    ) {
      // A full-width boundary can leave its separator at the start of the
      // next piece. Split the preceding token earlier so that separator stays
      // after visible text instead of starting a bubble.
      const tokenEnd = rest.search(/\s/);
      const token = rest.slice(0, tokenEnd < 0 ? rest.length : tokenEnd);
      const prefix = token.slice(0, -1);
      if (prefix && rest.length - prefix.length <= MESSAGE_PIECE_LIMIT) {
        pieces.push(`${prefix}-`);
        rest = rest.slice(prefix.length);
        continue;
      }
      cut--;
      while (cut > 0 && /\s/.test(rest[cut])) cut--;
    }
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Sentence punctuation must end a sentence, not a URL or dotted name. @param {string} text */
function sentenceBoundary(text) {
  let cut = 0;
  for (const match of text.matchAll(/[.!?](?=\s|$)/g)) {
    let end = (match.index ?? 0) + 1;
    if (end <= 1) continue;
    while (text[end] === " " && end < MESSAGE_PIECE_LIMIT) end++;
    if (end <= MESSAGE_PIECE_LIMIT) cut = end;
  }
  return cut;
}

/** Keep a clause boundary and its following spaces in the same piece. @param {string} text */
function clauseBoundary(text) {
  let cut = 0;
  const head = text.slice(0, MESSAGE_PIECE_LIMIT);
  for (const match of head.matchAll(/[,;:\-–—]/g)) {
    let end = (match.index ?? 0) + 1;
    if (end <= 1) continue;
    while (text[end] === " " && end < MESSAGE_PIECE_LIMIT) end++;
    if (end <= MESSAGE_PIECE_LIMIT) cut = end;
  }
  return cut;
}

/** Choose the last syllable boundary that fits, or a hard boundary. @param {string} word @param {number} max */
function wordPart(word, max) {
  if (max < 1) return "";
  const candidates = syllables(word)
    .filter((unit) => unit.spoken && unit.index < word.length)
    .map((unit) => unit.index)
    .filter((index) => index <= max);
  return word.slice(0, candidates.at(-1) ?? Math.min(39, max));
}
