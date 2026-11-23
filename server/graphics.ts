import { createHash } from "node:crypto";
import { mathSvg } from "./math";
import { Rasterizer } from "./rasterize";
import {
  graphicInputSchema,
  isSvgSource,
  type GraphicInput,
  type GraphicImage,
} from "../shared/media";

/** Math and SVG. Paseo's own Mermaid renderer draws diagrams on each client. */
export class GraphicsRenderer {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;
  private cache = new Map<string, GraphicImage>();
  private cacheBytes = 0;
  private rasterizer: Rasterizer;
  constructor(options: { timeout?: number } = {}) {
    this.rasterizer = new Rasterizer(options.timeout);
  }
  async render(input: GraphicInput): Promise<GraphicImage> {
    graphicInputSchema.parse(input);
    if (this.closed) throw new Error("The rendering service has shut down");
    if (input.kind === "svg" && !isSvgSource(input.source))
      throw new Error("The content is not an SVG document");
    const key = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.pending >= 32)
      throw new Error("The rendering queue is full. Please try again.");
    this.pending++;
    const result = this.queue.then(async () => {
      const existing = this.cache.get(key);
      if (existing) return existing;
      const image = await (input.kind === "math"
        ? this.rasterizer.render(mathSvg(input), {
            background: input.background,
            oversize: "reject",
          })
        : this.rasterizer.render(input.source, { oversize: "shrink" }));
      while (
        this.cacheBytes + image.uri.length > 16_000_000 &&
        this.cache.size
      ) {
        const oldest = this.cache.keys().next().value!;
        this.cacheBytes -= this.cache.get(oldest)!.uri.length;
        this.cache.delete(oldest);
      }
      this.cache.set(key, image);
      this.cacheBytes += image.uri.length;
      return image;
    });
    // Keep later jobs usable after a rejected request; the caller still receives its error.
    this.queue = result.catch(() => {});
    return result.finally(() => {
      this.pending--;
    });
  }
  async close() {
    this.closed = true;
    // Stops the job in progress; queued jobs then fail without starting a new worker.
    await this.rasterizer.close();
    await this.queue;
    this.cache.clear();
    this.cacheBytes = 0;
  }
}
