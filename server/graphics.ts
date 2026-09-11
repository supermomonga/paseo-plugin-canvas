import { createHash } from "node:crypto";
import { mathSvg } from "./math";
import { rasterize } from "./rasterize";
import {
  graphicInputSchema,
  type GraphicInput,
  type GraphicImage,
} from "../shared/media";

/** Math only. Mermaid is drawn with React Native views on each client. */
export class GraphicsRenderer {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;
  private cache = new Map<string, GraphicImage>();
  private cacheBytes = 0;
  async render(input: GraphicInput): Promise<GraphicImage> {
    graphicInputSchema.parse(input);
    if (this.closed) throw new Error("The rendering service has shut down");
    const key = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.pending >= 32)
      throw new Error("The math rendering queue is full. Please try again.");
    this.pending++;
    const result = this.queue.then(async () => {
      const existing = this.cache.get(key);
      if (existing) return existing;
      const image = await rasterize(mathSvg(input), input.background);
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
    await this.queue;
    this.cache.clear();
    this.cacheBytes = 0;
  }
}
