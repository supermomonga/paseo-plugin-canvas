import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/js/input/tex/cancel/CancelConfiguration.js";
import type { GraphicInput } from "../shared/media";

import { MathJaxTexFont } from "@mathjax/mathjax-tex-font/js/svg.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
export function mathSvg(input: GraphicInput): string {
  // Each expression owns its macros, labels and equation counters.
  const tex = new TeX({
    packages: [
      "base",
      "ams",
      "newcommand",
      "boldsymbol",
      "mathtools",
      "cancel",
    ],
    maxMacros: 1000,
    maxBuffer: 50_000,
    formatError: (_jax: unknown, error: Error) => {
      throw new Error(`Unable to parse math: ${error.message}`);
    },
  });
  const doc = mathjax.document("", {
    InputJax: tex,
    OutputJax: new SVG({
      fontCache: "none",
      fontData: MathJaxTexFont,
      // MathJax 4 otherwise emits separate SVGs at inline relation operators.
      // Rasterize the complete expression as one image.
      linebreaks: { inline: false },
    }),
  });
  const container = doc.convert(input.source, {
    display: input.display,
    em: input.fontSize,
    ex: input.fontSize / 2,
    containerWidth: 1200,
  });
  if (adaptor.childNodes(container).length !== 1)
    throw new Error("Unable to convert the entire expression into a single image");
  const svg = adaptor.firstChild(container);
  if (!svg || !("attributes" in svg) || adaptor.kind(svg) !== "svg")
    throw new Error("Unable to generate an SVG for the expression");
  const bounds = String(adaptor.getAttribute(svg, "viewBox"))
    .split(/\s+/)
    .map(Number);
  const width = (bounds[2] * input.fontSize) / 1000;
  const height = (bounds[3] * input.fontSize) / 1000;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Unable to determine the expression dimensions");
  adaptor.setAttribute(svg, "width", String(width));
  adaptor.setAttribute(svg, "height", String(height));
  adaptor.setAttribute(svg, "color", input.foreground);
  return adaptor.outerHTML(svg);
}
