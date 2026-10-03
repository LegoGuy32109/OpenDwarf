import { assert, assertEquals } from "@std/assert";
import {
  cellAtPoint,
  clampSelection,
  closePickupGrid,
  closeReason,
  createPickupGrid,
  GRID_CELLS,
  markRequested,
  moveSelection,
  openPickupGrid,
  pickupGridCells,
  selectStack,
  shownStacks,
  stepSelection,
  UNFOLD_MS,
} from "../../src/client/pickup-grid.js";
import { ITEM_KINDS } from "../../src/shared/items.js";

const tile = { x: 6, y: 5, z: 1 };
const stacks = (count: number) =>
  ITEM_KINDS.slice(0, count).map(({ kind }, i) => ({ kind, count: i + 1 }));

function opened(count: number) {
  const grid = createPickupGrid();
  openPickupGrid(grid, tile, 0);
  grid.waitForRelease = false;
  return { grid, list: stacks(count) };
}

Deno.test("the selector moves in the 3×3 squares and stops at the edges", () => {
  const { grid } = opened(5);
  assertEquals(moveSelection(grid, 5, 1, 0), true);
  assertEquals(grid.selected, 1);
  assertEquals(moveSelection(grid, 5, 0, 1), true);
  assertEquals(grid.selected, 4);
  // Row 1 holds two stacks, so moving right from the last one stops there.
  assertEquals(moveSelection(grid, 5, 1, 0), false);
  assertEquals(moveSelection(grid, 5, 0, 1), false);
  assertEquals(moveSelection(grid, 5, -1, -1), true);
  assertEquals(grid.selected, 0);
  assertEquals(moveSelection(grid, 5, -1, -1), false);
});

Deno.test("moving down into a short last row lands on the last stack", () => {
  const { grid } = opened(5);
  grid.selected = 2;
  moveSelection(grid, 5, 0, 1);
  assertEquals(grid.selected, 4);
});

Deno.test("more than nine stacks scroll one row and show the plus", () => {
  const { grid, list } = opened(10);
  let cells = pickupGridCells(grid, list, { x: 6, y: 5 }, UNFOLD_MS);
  assertEquals(cells.length, GRID_CELLS);
  assertEquals(cells.filter((cell) => cell.more).map((cell) => cell.index), [
    8,
  ]);
  for (let i = 0; i < 3; i++) moveSelection(grid, 10, 0, 1);
  assertEquals(grid.selected, 9);
  assertEquals(grid.top, 1);
  cells = pickupGridCells(grid, list, { x: 6, y: 5 }, UNFOLD_MS);
  assertEquals(cells.map((cell) => cell.index), [3, 4, 5, 6, 7, 8, 9]);
  assert(!cells.some((cell) => cell.more), "no plus at the end");
  assertEquals(cells.find((cell) => cell.selected)?.index, 9);
  moveSelection(grid, 10, 0, -1);
  moveSelection(grid, 10, 0, -1);
  assertEquals(grid.top, 1, "the rows still show");
  moveSelection(grid, 10, 0, -1);
  assertEquals(grid.top, 0);
});

Deno.test("nine or fewer stacks never show the plus", () => {
  const { grid, list } = opened(9);
  const cells = pickupGridCells(grid, list, { x: 6, y: 5 }, UNFOLD_MS);
  assertEquals(cells.length, 9);
  assert(!cells.some((cell) => cell.more));
});

Deno.test("squares unfold from the tile to the 3×3 tiles around the entity", () => {
  const { grid, list } = opened(4);
  const start = pickupGridCells(grid, list, { x: 5, y: 5 }, 0);
  const end = pickupGridCells(grid, list, { x: 5, y: 5 }, UNFOLD_MS);
  assert(end.every((cell) => cell.alpha === 1));
  assert(start.every((cell) => cell.alpha === 0 && cell.size < end[0].size));
  // The first square ends in the top-left of the 3×3 around tile (5, 5).
  assertEquals([end[0].x, end[0].y], [4 * 64 + 3, 4 * 64 + 3]);
  assertEquals([end[1].x, end[1].y], [5 * 64 + 3, 4 * 64 + 3]);
  assertEquals([end[3].x, end[3].y], [4 * 64 + 3, 5 * 64 + 3]);
  // At the start every square sits on the target tile.
  for (const cell of start) {
    assertEquals(cell.x + cell.size / 2, 6 * 64 + 32);
    assertEquals(cell.y + cell.size / 2, 5 * 64 + 32);
  }
});

Deno.test("a tap picks the square under the point", () => {
  const { grid, list } = opened(4);
  const cells = pickupGridCells(grid, list, { x: 5, y: 5 }, UNFOLD_MS);
  assertEquals(cellAtPoint(cells, 5 * 64 + 20, 4 * 64 + 20)?.index, 1);
  assertEquals(cellAtPoint(cells, 5 * 64 + 20, 6 * 64 + 20), null);
  assert(selectStack(grid, 4, 3));
  assertEquals(grid.selected, 3);
  assert(!selectStack(grid, 4, 4));
  assert(!selectStack(grid, 4, -1));
});

Deno.test("the aim held while opening does not move the selector", () => {
  const { grid } = opened(5);
  grid.waitForRelease = true;
  const down = { x: 0, y: 1 };
  assert(!stepSelection(grid, 5, down, 10), "still held from opening");
  assert(!stepSelection(grid, 5, down, 1000), "no repeat either");
  assertEquals(grid.selected, 0);
  assert(!stepSelection(grid, 5, { x: 0, y: 0 }, 1100), "released");
  assert(stepSelection(grid, 5, down, 1200), "a new press moves it");
  assertEquals(grid.selected, 3);
});

Deno.test("a held direction moves once, then repeats after a delay", () => {
  const { grid } = opened(10);
  const down = { x: 0, y: 1 };
  assert(stepSelection(grid, 10, down, 1000));
  assertEquals(grid.selected, 3);
  assert(!stepSelection(grid, 10, down, 1100), "no move before the delay");
  assert(stepSelection(grid, 10, down, 1400), "first repeat");
  assertEquals(grid.selected, 6);
  assert(!stepSelection(grid, 10, down, 1450));
  assert(!stepSelection(grid, 10, { x: 0, y: 0 }, 1500));
  assert(stepSelection(grid, 10, { x: 1, y: 0 }, 1510), "new direction");
});

Deno.test("the grid closes out of reach, on another level, or when empty", () => {
  const { grid } = opened(3);
  const player = (x: number, y: number, z = 1) => ({ x, y, z });
  // deno-lint-ignore no-explicit-any
  const reason = (p: any, count = 3) => closeReason(grid, p, count);
  assertEquals(reason(player(5, 5)), null);
  assertEquals(reason(player(6, 5)), null, "own tile");
  assertEquals(reason(player(7, 6)), null, "diagonal");
  assertEquals(reason(player(8, 5)), "out of reach");
  assertEquals(reason(player(5, 5, 2)), "out of reach");
  assertEquals(reason(player(5, 5), 0), "nothing left");
  assertEquals(reason(undefined), "no entity");
  closePickupGrid(grid);
  assertEquals(
    reason(player(20, 20)),
    null,
    "a closed grid never closes again",
  );
});

Deno.test("a guest hides a requested stack until the host's list updates", () => {
  const { grid, list } = opened(3);
  markRequested(grid, list[1].kind, 100);
  assertEquals(shownStacks(grid, list, 200).map((s) => s.kind), [
    list[0].kind,
    list[2].kind,
  ]);
  assertEquals(shownStacks(grid, list, 2000).length, 3, "hidden only briefly");
});

Deno.test("the selection stays on a stack after another entity took one", () => {
  const { grid } = opened(10);
  grid.selected = 9;
  grid.top = 1;
  clampSelection(grid, 4);
  assertEquals([grid.selected, grid.top], [3, 0]);
});
