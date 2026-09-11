import { diffChars } from "diff";
import type { ReviewAnchor, ReviewProjection } from "../shared/review";

export function trackAnchor(
  anchor: ReviewAnchor,
  original: string,
  current: string,
): ReviewProjection {
  const outdated = (reason: string): ReviewProjection => ({
    start: null,
    end: null,
    reason,
  });
  if (original.slice(anchor.start, anchor.end) !== anchor.sourceText)
    return outdated("The saved selection does not match its snapshot");
  if (original === current)
    return { start: anchor.start, end: anchor.end, reason: null };
  const options = { timeout: 100, maxEditLength: 10_000 };
  const changes = diffChars(original, current, options);
  if (!changes) return outdated("Tracking exceeded its computation limit");
  let before = 0,
    after = 0;
  let candidate: { start: number; end: number } | undefined;
  for (const change of changes) {
    const length = change.value.length;
    if (
      !change.added &&
      !change.removed &&
      anchor.start >= before &&
      anchor.end <= before + length
    ) {
      candidate = {
        start: after + anchor.start - before,
        end: after + anchor.end - before,
      };
    }
    if (!change.added) before += length;
    if (!change.removed) after += length;
  }
  if (!candidate) return outdated("The selected source was changed or deleted");
  // A diff may assign equal repeated text to an arbitrary occurrence. Require
  // an unambiguous quote, or an exact, unique surrounding context.
  const quote = anchor.sourceText;
  const first = current.indexOf(quote),
    repeated = current.indexOf(quote, first + 1) !== -1;
  if (repeated) {
    const context = anchor.prefix + quote + anchor.suffix;
    const at = current.indexOf(context);
    if (
      at < 0 ||
      current.indexOf(context, at + 1) !== -1 ||
      at + anchor.prefix.length !== candidate.start
    )
      return outdated("Repeated text makes the selection ambiguous");
  }
  return { ...candidate, reason: null };
}
