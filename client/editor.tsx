import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from "react-native";
import {
  Modal,
  ScrollView,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { getClientHost } from "paseo-plugin-helper/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  beginCanvasEdit,
  cancelCanvasEdit,
  createUserCanvas,
  deleteUserCanvas,
  previewCanvasDraft,
  renewCanvasEdit,
  saveCanvasEdit,
} from "../shared/editing";
import {
  createCanvasEditor,
  draftChanged,
  type CanvasEditor,
  type EditorState,
} from "./editing-state";
import { refreshCanvases } from "./updates";
import type { CanvasSelection } from "./selection";
import { Markdown } from "./markdown";
import type { Root as Document } from "hast";
import { ToolbarButton, titleText, metaText } from "./controls";

export function useCanvasEditor(
  workspaceId: string,
  selection: CanvasSelection,
) {
  const host = getClientHost();
  const begin = host.useRpc(beginCanvasEdit),
    create = host.useRpc(createUserCanvas),
    save = host.useRpc(saveCanvasEdit),
    renew = host.useRpc(renewCanvasEdit),
    cancel = host.useRpc(cancelCanvasEdit),
    remove = host.useRpc(deleteUserCanvas);
  const queryClient = useQueryClient();
  const [editor] = useState(() =>
    createCanvasEditor(workspaceId, {
      begin,
      create,
      save,
      renew,
      cancel,
      delete: remove,
      refresh: () => refreshCanvases(queryClient, workspaceId),
      select: (id) => selection.selectDirect(workspaceId, id),
    }),
  );
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  useEffect(
    () => selection.guard(workspaceId, editor.navigate),
    [editor, selection, workspaceId],
  );
  useEffect(() => {
    editor.activate();
    let active =
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive";
    const interval = setInterval(() => {
      if (active) void editor.renew();
    }, 60_000);
    const subscription = AppState.addEventListener("change", (next) => {
      active = next === "active";
      if (active) void editor.renew();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
      editor.dispose();
    };
  }, [editor]);
  return { editor, state };
}

export function CanvasEditForm({
  editor,
  state,
  theme,
  workspaceId,
}: {
  editor: CanvasEditor;
  state: EditorState;
  theme: PluginTheme;
  workspaceId: string;
}) {
  const d = state.draft!;
  const colors = theme.colors;
  const toast = useToast();
  const preview = getClientHost().useRpc(previewCanvasDraft);
  const previewRpc = useRef(preview);
  previewRpc.current = preview;
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [rendered, setRendered] = useState<Document | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const current = ++request.current;
    if (mode !== "preview") return;
    setLoading(true);
    setPreviewError(null);
    setRendered(null);
    void previewRpc
      .current({ content: d.content })
      .then((result) => {
        if (request.current === current) setRendered(result.document);
      })
      .catch(() => {
        if (request.current === current)
          setPreviewError("Unable to preview this draft");
      })
      .finally(() => {
        if (request.current === current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [mode, d.content]);
  const invalidTitle = !d.title.trim() || d.title.trim().length > 240;
  const invalidBody =
    d.content.length > 1_000_000 || (!d.original && !d.content.trim());
  const inputStyle = {
    color: colors.foreground,
    backgroundColor: colors.surface1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, minHeight: 0 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View
        style={{
          padding: 16,
          gap: 12,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ ...titleText, color: colors.foreground }}
        >
          {d.original ? "Edit canvas" : "New canvas"}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ToolbarButton
            icon="Save"
            label={state.busy ? "Working…" : "Save"}
            disabled={
              state.busy ||
              d.lost ||
              d.uncertain ||
              invalidTitle ||
              invalidBody ||
              !draftChanged(d)
            }
            onPress={() => void editor.save()}
          />
          <ToolbarButton
            icon="X"
            label="Cancel"
            disabled={state.busy}
            onPress={() => editor.cancel()}
          />
          <ToolbarButton
            icon={mode === "edit" ? "Eye" : "Code"}
            label={mode === "edit" ? "Preview" : "Markdown"}
            onPress={() => setMode(mode === "edit" ? "preview" : "edit")}
          />
        </View>
        {d.original && (
          <Text style={{ ...metaText, color: colors.foregroundMuted }}>
            {d.lost
              ? "Edit lock unavailable"
              : `Editing revision ${d.original.revision}`}
          </Text>
        )}
        {d.lost && !d.uncertain && (
          <ToolbarButton
            icon="LockKeyhole"
            label="Reacquire lock"
            disabled={state.busy}
            onPress={() => void editor.reacquire()}
          />
        )}
        {d.uncertain && (
          <ToolbarButton
            icon="RefreshCw"
            label="Check latest canvases"
            disabled={state.busy}
            onPress={() => void editor.refresh()}
          />
        )}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
      >
        <Text style={{ ...metaText, color: colors.foreground }}>Title</Text>
        <TextInput
          accessibilityLabel="Canvas title"
          value={d.title}
          editable={!state.busy}
          onChangeText={(title) => editor.change({ title })}
          style={inputStyle}
        />
        {d.title.trim().length > 240 && (
          <Text
            accessibilityRole="alert"
            style={{ color: colors.statusDanger }}
          >
            Title must be at most 240 characters.
          </Text>
        )}
        {mode === "edit" ? (
          <>
            <Text style={{ ...metaText, color: colors.foreground }}>
              Markdown content
            </Text>
            <TextInput
              accessibilityLabel="Canvas Markdown content"
              multiline
              textAlignVertical="top"
              value={d.content}
              editable={!state.busy}
              onChangeText={(content) => editor.change({ content })}
              style={{
                ...inputStyle,
                minHeight: 280,
                flexGrow: 1,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              }}
            />
            {d.content.length > 1_000_000 && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.statusDanger }}
              >
                Content must be at most 1,000,000 characters.
              </Text>
            )}
          </>
        ) : (
          <>
            {loading && (
              <Text style={{ color: colors.foregroundMuted }}>
                Loading preview…
              </Text>
            )}
            {previewError && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.statusDanger }}
              >
                {previewError}
              </Text>
            )}
            {rendered && (
              <Markdown
                document={rendered}
                theme={theme}
                workspaceId={workspaceId}
                onError={(error) => toast.error(error)}
              />
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function EditConfirmation({
  editor,
  state,
  theme,
}: {
  editor: CanvasEditor;
  state: EditorState;
  theme: PluginTheme;
}) {
  const deleting = state.confirmation === "delete";
  return (
    <Modal
      title={deleting ? "Delete canvas?" : "Discard changes?"}
      open={state.confirmation !== null}
      onOpenChange={(open) => {
        if (!open && !state.busy) editor.dismissConfirmation();
      }}
    >
      <Modal.Content>
        <View style={{ gap: 16, padding: 16 }}>
          <Text style={{ color: theme.colors.foreground }}>
            {deleting
              ? `Permanently delete “${editor.deletionTitle()}” and all its reviews? This cannot be undone.`
              : "Your unsaved changes will be discarded and the edit lock will be released."}
          </Text>
          {state.error && (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.colors.statusDanger }}
            >
              {state.error}
            </Text>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <ToolbarButton
              icon="X"
              label={deleting ? "Cancel" : "Keep editing"}
              disabled={state.busy}
              onPress={() => editor.dismissConfirmation()}
            />
            <ToolbarButton
              icon={deleting ? "Trash2" : "Undo2"}
              label={deleting ? "Delete permanently" : "Discard changes"}
              disabled={state.busy}
              onPress={() => {
                void (deleting
                  ? editor.confirmDelete()
                  : editor.confirmDiscard());
              }}
            />
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
