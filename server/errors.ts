import type { EditState } from "../shared/contracts";
export class CanvasError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: { revision: number; editState: EditState },
  ) {
    super(message);
    this.name = "CanvasError";
  }
}
export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
