import type { CanvasSummary } from "../shared/contracts";

const normalize = (text: string) =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Picks the canvas a `/canvas <title>` command names: an exact title first,
 * then a title prefix, then a title containing the text. The most recently
 * updated canvas wins a tie.
 */
export function findCanvas<Item extends Pick<CanvasSummary, "title" | "updatedAt">>(
  items: readonly Item[],
  query: string,
): Item | null {
  const wanted = normalize(query);
  if (!wanted) return null;
  const recent = [...items].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const title = (item: Item) => normalize(item.title);
  return (
    recent.find((item) => title(item) === wanted) ??
    recent.find((item) => title(item).startsWith(wanted)) ??
    recent.find((item) => title(item).includes(wanted)) ??
    null
  );
}
