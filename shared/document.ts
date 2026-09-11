import { z } from "zod";
import type { Root, RootContent, ElementContent } from "hast";
export const alertTypes = [
  "NOTE",
  "TIP",
  "IMPORTANT",
  "WARNING",
  "CAUTION",
] as const;
export type AlertType = (typeof alertTypes)[number];
export function textContent(node: RootContent | Root): string {
  return node.type === "text"
    ? node.value
    : "children" in node
      ? node.children.map(textContent).join("")
      : "";
}
export function externalLink(href: string): string | null {
  if (!/^(https?:\/\/|mailto:)[^\s\u0000-\u001f]+$/i.test(href)) return null;
  try {
    const url = new URL(href);
    return url.username || url.password ? null : href;
  } catch {
    return null;
  }
}

const property = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number()])),
]);
const nodeSchema: z.ZodType<ElementContent> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("text"), value: z.string() }),
    z.object({
      type: z.literal("element"),
      tagName: z.string(),
      properties: z.record(z.string(), property),
      children: z.array(nodeSchema),
    }),
  ]),
);
export const documentSchema: z.ZodType<Root> = z.object({
  type: z.literal("root"),
  children: z.array(nodeSchema),
});
