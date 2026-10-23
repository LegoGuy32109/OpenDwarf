// @ts-check

/** @typedef {{kind:"chat"|"system",text:string,speaker?:string}} HearingLine */
/** @typedef {{line:HearingLine,nextPart:number}} MessageLine */
/** @typedef {{lines:HearingLine[],heard:Set<string>,groups:Map<string,MessageLine>,version:number}} HearingLog */

export const HEARING_LOG_LIMIT = 200;
const SYSTEM_LINE_LIMIT = 120;
const HEARD_KEYS_LIMIT = 400;

export function createHearingLog() {
  /** @type {HearingLog} */
  const log = { lines: [], heard: new Set(), groups: new Map(), version: 0 };
  return log;
}

/** @param {HearingLog} log @param {HearingLine} line */
function append(log, line) {
  log.lines.push(line);
  log.version++;
  if (log.lines.length > HEARING_LOG_LIMIT) {
    log.lines.splice(0, log.lines.length - HEARING_LOG_LIMIT);
  }
}

/**
 * The one system-line function. Other features call it for pickups, sales,
 * and joins; the log keeps only the newest lines.
 * @param {HearingLog} log @param {string} text
 */
export function addSystemLine(log, text) {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, SYSTEM_LINE_LIMIT);
  if (clean) append(log, { kind: "system", text: clean });
}

/**
 * Logs each message text once. The chat feed already holds text only for
 * speakers inside chat hearing range, so talking and typing records, which
 * carry no readable text, never reach the log.
 * @param {HearingLog} log
 * @param {(import('./chat.js').ChatRecord|import('./chat.js').DisplayChatRecord)[]} feed
 * @param {(id:string)=>string} nameOf
 */
export function hearChat(log, feed, nameOf) {
  for (const record of feed) {
    if (!record.text) continue;
    // Stacked bubbles can bring several new messages in one update, oldest
    // first, so log each bubble rather than only the newest text.
    const messages = record.bubbles?.length
      ? record.bubbles
      : [{ text: record.text, expiresTick: record.expiresTick }];
    for (const message of messages) {
      const grouped = "group" in message && message.group !== undefined;
      const groupKey = grouped ? `${record.id}:${message.group}` : "";
      if (grouped) {
        const current = log.groups.get(groupKey);
        const part = "part" in message ? message.part ?? 0 : 0;
        const key = `${groupKey}:${part}`;
        if (log.heard.has(key)) continue;
        log.heard.add(key);
        if (log.heard.size > HEARD_KEYS_LIMIT) {
          log.heard.delete(
            /** @type {string} */ (log.heard.values().next().value),
          );
        }
        if (!current) {
          const line = /** @type {HearingLine} */ ({
            kind: "chat",
            text: message.text,
            speaker: nameOf(record.id),
          });
          append(log, line);
          log.groups.set(groupKey, { line, nextPart: part + 1 });
        } else if (part === current.nextPart) {
          current.line.text += message.text;
          current.nextPart++;
          log.version++;
        }
        if (
          "parts" in message && message.parts !== undefined &&
          part + 1 >= message.parts
        ) log.groups.delete(groupKey);
        continue;
      }
      const key = `${record.id}:${message.expiresTick}:${message.text}`;
      if (log.heard.has(key)) continue;
      log.heard.add(key);
      if (log.heard.size > HEARD_KEYS_LIMIT) {
        log.heard.delete(
          /** @type {string} */ (log.heard.values().next().value),
        );
      }
      append(log, {
        kind: "chat",
        text: message.text,
        speaker: nameOf(record.id),
      });
    }
  }
}
