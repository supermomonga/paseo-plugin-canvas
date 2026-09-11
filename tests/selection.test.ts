import { expect, test, vi } from "vitest";
import { createCanvasSelection } from "../client/selection";

test("selection and notifications stay scoped to workspace and installation", () => {
  const selection = createCanvasSelection();
  const otherHost = createCanvasSelection();
  const first = vi.fn(), second = vi.fn();
  const unsubscribe = selection.subscribe("first", first);
  selection.subscribe("second", second);
  expect(selection.get("first")).toBeNull();
  selection.select("first", "canvas-a");
  expect(selection.get("first")).toBe("canvas-a");
  expect(selection.get("second")).toBeNull();
  expect(otherHost.get("first")).toBeNull();
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  unsubscribe();
  selection.select("first", "canvas-b");
  expect(first).toHaveBeenCalledOnce();
  const again = vi.fn();
  selection.subscribe("first", again);
  selection.select("first", null);
  expect(selection.get("first")).toBeNull();
  expect(again).toHaveBeenCalledOnce();
});
