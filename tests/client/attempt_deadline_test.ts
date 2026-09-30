import { assertEquals } from "@std/assert";
import { createAttemptDeadline } from "../../src/client/attempt-deadline.js";

Deno.test("an unanswered join expires once at ten seconds without a player", () => {
  const expired: string[] = [];
  const deadline = createAttemptDeadline((attempt) => expired.push(attempt));
  deadline.start("unanswered", 100);
  assertEquals(deadline.check(10_099), false);
  assertEquals(expired, []);
  assertEquals(deadline.check(10_100), true);
  assertEquals(deadline.check(20_000), false);
  assertEquals(expired, ["unanswered"]);
});

Deno.test("replacement gets its own deadline and ignores stale completion", () => {
  const expired: string[] = [];
  const deadline = createAttemptDeadline((attempt) => expired.push(attempt));
  deadline.start("old", 0);
  deadline.start("replacement", 9_000);
  deadline.complete("old");
  assertEquals(deadline.check(10_000), false);
  assertEquals(deadline.check(18_999), false);
  assertEquals(deadline.check(19_000), true);
  assertEquals(expired, ["replacement"]);
});

Deno.test("a successful handshake and connection closure cancel expiration", () => {
  const expired: string[] = [];
  const deadline = createAttemptDeadline((attempt) => expired.push(attempt));
  deadline.start("complete", 0);
  deadline.complete("complete");
  assertEquals(deadline.check(10_000), false);
  deadline.start("closing", 20_000);
  deadline.close();
  deadline.start("after-close", 30_000);
  assertEquals(deadline.check(40_000), false);
  assertEquals(expired, []);
});

Deno.test("an expiry callback can start the next attempt safely", () => {
  const expired: string[] = [];
  const deadline = createAttemptDeadline((attempt) => {
    expired.push(attempt);
    deadline.start("next", 10_000);
  });
  deadline.start("first", 0);
  assertEquals(deadline.check(10_000), true);
  assertEquals(deadline.check(10_000), false);
  assertEquals(deadline.check(20_000), true);
  assertEquals(expired, ["first", "next"]);
});
