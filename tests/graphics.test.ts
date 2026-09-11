import { test, expect } from "vitest";
import { mathSvg } from "../server/math";
import { GraphicsRenderer } from "../server/graphics";
import { imageResultSchema } from "../shared/media";
test("real local renderer draws math without a browser, rejects invalid input and remains usable", async () => {
  const renderer = new GraphicsRenderer();
  const base = {
    display: true,
    foreground: "#fafafa",
    background: "#181b1a",
    fontSize: 16,
  };
  try {
    for (const [kind, source] of [
      ["math", "\\frac{n(n+1)}{2}"],
      ["math", "\\sum_{i=1}^n i = \\text{日本語}"],
    ] as const) {
      const result = await renderer.render({ ...base, kind, source });
      imageResultSchema.parse(result);
      expect(
        Buffer.from(result.uri.split(",")[1], "base64").subarray(0, 8),
      ).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(result.width).toBeGreaterThan(20);
      expect(result.height).toBeGreaterThan(20);
      expect(await renderer.render({ ...base, kind, source })).toEqual(result);
    }
    await renderer.render({
      ...base,
      kind: "math",
      source: "\\newcommand{\\canvasmacro}{x}\\canvasmacro",
    });
    await expect(
      renderer.render({ ...base, kind: "math", source: "\\canvasmacro" }),
    ).rejects.toThrow();
    await expect(
      renderer.render({ ...base, kind: "math", source: "\\invalidcommand" }),
    ).rejects.toThrow();
    expect(
      (
        await renderer.render({
          ...base,
          display: false,
          kind: "math",
          source: "a^2",
        })
      ).width,
    ).toBeGreaterThan(10);
  } finally {
    await renderer.close();
  }
  await expect(
    renderer.render({ ...base, kind: "math", source: "a" }),
  ).rejects.toThrow("shut down");
}, 60_000);

test("inline math retains both sides of relation operators in one SVG", () => {
  const svg = mathSvg({
    kind: "math",
    source: "E=mc^2",
    display: false,
    foreground: "#eeeeee",
    background: "#111111",
    fontSize: 16,
  });
  expect(svg).toContain('data-c="3D"');
  expect(svg).toContain('data-c="32"');
  expect(svg).toContain('data-latex="m"');
  expect(svg).toContain('data-latex="c"');
  const width = Number(/width="([\d.]+)"/.exec(svg)?.[1]);
  expect(width).toBeGreaterThan(50);
});
