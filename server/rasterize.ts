import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { rasterizerWasm, japaneseFont } from "./generated/rasterizer";
import type { GraphicImage } from "../shared/media";
let ready: Promise<void> | undefined;
export async function rasterize(
  svg: string,
  background: string,
): Promise<GraphicImage> {
  ready ??= initWasm(Buffer.from(rasterizerWasm, "base64"));
  await ready;
  const renderer = new Resvg(svg, {
    background,
    fitTo: { mode: "zoom", value: 2 },
    font: {
      fontBuffers: [Buffer.from(japaneseFont, "base64")],
      defaultFontFamily: "Noto Sans JP",
      sansSerifFamily: "Noto Sans JP",
      serifFamily: "Noto Sans JP",
    },
  });
  try {
    if (
      renderer.width > 8192 ||
      renderer.height > 8192 ||
      renderer.width * renderer.height > 16_000_000
    )
      throw new Error("数式が表示サイズの上限を超えています");
    const png = renderer.render();
    try {
      const uri = `data:image/png;base64,${Buffer.from(png.asPng()).toString("base64")}`;
      if (uri.length > 8_000_000)
        throw new Error("描画結果が8 MBを超えています");
      return { uri, width: png.width / 2, height: png.height / 2 };
    } finally {
      png.free();
    }
  } finally {
    renderer.free();
  }
}
