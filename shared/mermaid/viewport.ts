export interface Size {
  width: number;
  height: number;
}
export interface Transform {
  scale: number;
  x: number;
  y: number;
}
export function fitted(content: Size, viewport: Size): Transform {
  const scale = Math.min(
    1,
    Math.max(1, viewport.width - 32) / content.width,
    Math.max(1, viewport.height - 32) / content.height,
  );
  return bounded({ scale, x: 0, y: 0 }, content, viewport);
}
export function bounded(
  value: Transform,
  content: Size,
  viewport: Size,
): Transform {
  const axis = (offset: number, size: number, space: number) =>
    size <= space - 32
      ? (space - size) / 2
      : Math.max(space - size - 16, Math.min(16, offset));
  return {
    scale: value.scale,
    x: axis(value.x, content.width * value.scale, viewport.width),
    y: axis(value.y, content.height * value.scale, viewport.height),
  };
}
export function zoomAt(
  value: Transform,
  scale: number,
  point: { x: number; y: number },
  content: Size,
  viewport: Size,
): Transform {
  const minimum = Math.min(0.1, fitted(content, viewport).scale);
  const next = Math.max(minimum, Math.min(4, scale));
  const ratio = next / value.scale;
  return bounded(
    {
      scale: next,
      x: point.x - (point.x - value.x) * ratio,
      y: point.y - (point.y - value.y) * ratio,
    },
    content,
    viewport,
  );
}
