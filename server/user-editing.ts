import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  createUserCanvas,
  beginCanvasEdit,
  renewCanvasEdit,
  cancelCanvasEdit,
  saveCanvasEdit,
  deleteUserCanvas,
  previewCanvasDraft,
} from "../shared/editing";
import { CanvasError } from "./errors";
import type { CanvasStore } from "./store";
import { parseDocument } from "./document";

export async function editResult<T>(action: () => Promise<T>) {
  try {
    return { ok: true as const, value: await action() };
  } catch (error) {
    if (error instanceof CanvasError)
      return { ok: false as const, code: error.code, message: error.message };
    console.error("[paseo-canvas] User canvas operation failed", error);
    return {
      ok: false as const,
      code: "UNKNOWN",
      message:
        "The operation could not be confirmed. Check the latest canvas before trying again.",
    };
  }
}
export function registerUserEditing(
  server: Pick<PluginServerContext, "handle">,
  ready: () => Promise<CanvasStore>,
) {
  server.handle(createUserCanvas, (input) =>
    editResult(async () => {
      const saved = await (
        await ready()
      ).createUser(input.workspaceId, input.title, input.content);
      return { canvasId: saved.canvasId, revision: saved.revision };
    }),
  );
  server.handle(beginCanvasEdit, (input) =>
    editResult(async () => {
      const edit = await (
        await ready()
      ).beginUserEdit(input.workspaceId, input.canvasId);
      return { canvas: edit.canvas, lockToken: edit.lockToken };
    }),
  );
  server.handle(renewCanvasEdit, (input) =>
    editResult(async () =>
      (await ready()).renewUser(
        input.workspaceId,
        input.canvasId,
        input.lockToken,
      ),
    ),
  );
  server.handle(cancelCanvasEdit, (input) =>
    editResult(async () =>
      (await ready()).cancelUser(
        input.workspaceId,
        input.canvasId,
        input.lockToken,
      ),
    ),
  );
  server.handle(saveCanvasEdit, (input) =>
    editResult(async () => {
      const saved = await (await ready()).saveUser(input.workspaceId, input);
      return { canvasId: saved.canvasId, revision: saved.revision };
    }),
  );
  server.handle(deleteUserCanvas, (input) =>
    editResult(async () =>
      (await ready()).deleteUser(
        input.workspaceId,
        input.canvasId,
        input.expectedRevision,
      ),
    ),
  );
  server.handle(previewCanvasDraft, (input) => ({
    document: parseDocument(input.content),
  }));
}
