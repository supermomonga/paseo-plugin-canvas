import type { View, Text } from "react-native";
import type { ReactNode } from "react";
import type { Element } from "hast";
export type ReviewBindings = {
  enabled: boolean;
  register: (
    key: string,
    node: View | Text | null,
    range: { start: number; end: number } | null,
  ) => void;
  navigate: number | null;
  navigationRequest: number;
  text: (value: string, map: number[] | undefined, key: string) => ReactNode;
  wrap: (node: Element, child: ReactNode, key: string) => ReactNode;
  select: (node: Element) => void;
};
export function sourceRange(node: Element) {
  const start = node.properties.dataCanvasStart,
    end = node.properties.dataCanvasEnd;
  return typeof start === "number" && typeof end === "number"
    ? { start, end }
    : null;
}
