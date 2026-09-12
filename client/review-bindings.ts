import type { View, Text } from "react-native";
import type { ReactNode } from "react";
import type { Element } from "hast";
export { sourceRange } from "../shared/review-targets";
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
};
