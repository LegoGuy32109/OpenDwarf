import { assertEquals } from "@std/assert";
import { createStickStepper } from "../../src/client/stick-step.js";

const RIGHT = { x: 1, y: 0 };
const DOWN_RIGHT = { x: 1, y: 1 };
const DOWN = { x: 0, y: 1 };
const CENTER = { x: 0, y: 0 };

Deno.test("a stick steps once when it leaves center", () => {
  const stepper = createStickStepper();
  assertEquals(stepper.update(CENTER, 0), null);
  assertEquals(stepper.update(RIGHT, 10), RIGHT);
  assertEquals(stepper.update(RIGHT, 20), null);
  assertEquals(stepper.update(RIGHT, 300), null);
});

Deno.test("a sweep across a diagonal within 200 ms does not step twice", () => {
  const stepper = createStickStepper();
  assertEquals(stepper.update(RIGHT, 0), RIGHT);
  assertEquals(stepper.update(DOWN_RIGHT, 50), null);
  assertEquals(stepper.update(DOWN, 100), null);
  assertEquals(stepper.update(CENTER, 150), null);
});

Deno.test("a new direction steps once 200 ms after the last step", () => {
  const stepper = createStickStepper();
  assertEquals(stepper.update(RIGHT, 0), RIGHT);
  assertEquals(stepper.update(DOWN, 100), null);
  assertEquals(stepper.update(DOWN, 199), null);
  assertEquals(stepper.update(DOWN, 200), DOWN);
  // Its repeat waits 400 ms from that step.
  assertEquals(stepper.update(DOWN, 599), null);
  assertEquals(stepper.update(DOWN, 600), DOWN);
});

Deno.test("a held direction repeats after 400 ms, then every 200 ms", () => {
  const stepper = createStickStepper();
  assertEquals(stepper.update(RIGHT, 1000), RIGHT);
  assertEquals(stepper.update(RIGHT, 1399), null);
  assertEquals(stepper.update(RIGHT, 1400), RIGHT);
  assertEquals(stepper.update(RIGHT, 1599), null);
  assertEquals(stepper.update(RIGHT, 1600), RIGHT);
  assertEquals(stepper.update(RIGHT, 1800), RIGHT);
});

Deno.test("returning to center resets the rule", () => {
  const stepper = createStickStepper();
  assertEquals(stepper.update(RIGHT, 0), RIGHT);
  assertEquals(stepper.update(CENTER, 50), null);
  assertEquals(stepper.update(DOWN, 60), DOWN);
  assertEquals(stepper.update(CENTER, 70), null);
  assertEquals(stepper.update(DOWN, 80), DOWN);
});

Deno.test("releaseFirst ignores a held stick until it returns to center", () => {
  const stepper = createStickStepper();
  stepper.releaseFirst();
  assertEquals(stepper.update(DOWN, 0), null);
  assertEquals(stepper.update(DOWN, 1000), null);
  assertEquals(stepper.update(CENTER, 1010), null);
  assertEquals(stepper.update(DOWN, 1020), DOWN);
});
