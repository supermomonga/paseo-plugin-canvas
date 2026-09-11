import { parseDocument, stringify } from "yaml";
import {
  contentSchema,
  metadataSchema,
  type Metadata,
} from "../shared/contracts";
import { CanvasError } from "./errors";
export function encodeDocument(metadata: Metadata, content: string): string {
  return `---\n${stringify(metadataSchema.parse(metadata))}---\n${contentSchema.parse(content)}`;
}
export function decodeDocument(
  source: string,
  workspaceId: string,
  canvasId: string,
): { metadata: Metadata; content: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!match)
    throw new CanvasError(
      "CORRUPT_DOCUMENT",
      "Canvas frontmatter is missing or malformed",
    );
  try {
    const document = parseDocument(match[1], { uniqueKeys: true });
    if (document.errors.length) throw document.errors[0];
    const metadata = metadataSchema.parse(document.toJS({ maxAliasCount: 0 }));
    if (metadata.workspaceId !== workspaceId || metadata.canvasId !== canvasId)
      throw new Error("Canvas ID does not match its path");
    return {
      metadata,
      content: contentSchema.parse(source.slice(match[0].length)),
    };
  } catch {
    throw new CanvasError(
      "CORRUPT_DOCUMENT",
      "Canvas frontmatter is invalid or does not match its path",
    );
  }
}
