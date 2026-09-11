import { expect, test } from "vitest";
import { tableColumnWidths } from "../shared/table";

test("spare width goes to wrapping columns while short labels retain their natural width", () => {
  expect(tableColumnWidths([120, 1000], 800)).toEqual([120, 680]);
  expect(tableColumnWidths([120, 1000], 360)).toEqual([120, 240]);
  expect(tableColumnWidths([1000, 120], 800)).toEqual([680, 120]);
});

test("several wrapping columns share width according to their remaining need", () => {
  const widths = tableColumnWidths([60, 400, 800], 800);
  expect(widths[0]).toBe(60);
  expect(widths[2]).toBeGreaterThan(widths[1]);
  expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(800);
  expect(widths.every((width, index) => width <= [60, 400, 800][index])).toBe(
    true,
  );
});

test("horizontal scrolling starts only when readable column widths no longer fit", () => {
  expect(tableColumnWidths([80, 900, 1000], 320)).toEqual([80, 180, 180]);
  expect(tableColumnWidths([80, 90], 320)).toEqual([
    (80 * 320) / 170,
    (90 * 320) / 170,
  ]);
});

test("tables whose content fits fill the viewport proportionally", () => {
  expect(tableColumnWidths([100, 300], 800)).toEqual([200, 600]);
  expect(tableColumnWidths([180, 180], 360)).toEqual([180, 180]);
  expect(tableColumnWidths([120], 800)).toEqual([800]);
});

test("the initial measurement pass and an empty table never produce invalid widths", () => {
  expect(tableColumnWidths([0, 0], 800)).toEqual([0, 0]);
  expect(tableColumnWidths([], 800)).toEqual([]);
  expect(tableColumnWidths([120, 1000], 0)).toEqual([120, 180]);
});
