// Interpolate between readable widths and measured unwrapped content widths.
// Short columns already fit at their minimum, so spare room goes to columns
// that would otherwise wrap. Only scroll once those minimums no longer fit.
export function tableColumnWidths(
  preferred: number[],
  available: number,
): number[] {
  const minimum = preferred.map((width) => Math.min(width, 180));
  const minTotal = minimum.reduce((sum, width) => sum + width, 0);
  const preferredTotal = preferred.reduce((sum, width) => sum + width, 0);
  if (preferredTotal === 0) return preferred;
  const total = Math.max(available, minTotal);
  if (total >= preferredTotal) {
    return preferred.map((width) => (width * total) / preferredTotal);
  }
  const share = (total - minTotal) / (preferredTotal - minTotal);
  return preferred.map(
    (width, column) => minimum[column] + (width - minimum[column]) * share,
  );
}
