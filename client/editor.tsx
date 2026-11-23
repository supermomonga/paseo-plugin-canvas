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
} from "@getpaseo/plugin/client/ui";
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
  type EditorText,
} from "./editing-state";
import { refreshCanvases } from "./updates";
import type { CanvasSelection } from "./selection";
import { Markdown } from "./markdown";
import type { Root as Document } from "hast";
import { ToolbarButton, titleText, metaText } from "./controls";
import { messages, useText } from "./i18n";

type Translation = ReturnType<typeof useText>;
const serverErrorCodes = [
  "LOCKED",
  "CONFLICT",
  "NOT_FOUND",
  "INVALID_INPUT",
  "STORE_UNAVAILABLE",
  "CORRUPT_DOCUMENT",
  "INVALID_STORAGE",
  "UNKNOWN",
] as const;
type ServerErrorCode = (typeof serverErrorCodes)[number];
const isServerErrorCode = (code: string | undefined): code is ServerErrorCode =>
  serverErrorCodes.includes(code as ServerErrorCode);

/** Whether the app language has its own text for a daemon error code. */
function translatesServerError(locale: string, code: ServerErrorCode) {
  const resources = messages.resources as Record<
    string,
    { editing?: { server?: Record<string, unknown> } } | undefined
  >;
  return [locale, locale.split("-")[0]].some(
    (language) =>
      language !== "en" &&
      typeof resources[language]?.editing?.server?.[code] === "string",
  );
}

/**
 * Daemon errors appear in the reader's language when it translates their code.
 * Otherwise the daemon's message, which is more specific, stays as it is.
 */
export function describeFailure(
  { t, locale }: Translation,
  error: { code?: string; message: string },
) {
  return isServerErrorCode(error.code) &&
    translatesServerError(locale, error.code)
    ? t(`editing.server.${error.code}`)
    : error.message;
}

/** Editor text that always follows the current app language. */
function translatedEditorText(current: {
  current: Translation;
}): EditorText {
  return {
    refreshFailed: () => current.current.t("editing.errors.refreshFailed"),
    changedWhileUnavailable: () =>
      current.current.t("editing.errors.changedWhileUnavailable"),
    paused: (reason) => current.current.t("editing.errors.paused", { reason }),
    saveUncertain: () => current.current.t("editing.errors.saveUncertain"),
    failure: (error) => describeFailure(current.current, error),
  };
}

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
  const text = useText();
  const currentText = useRef(text);
  currentText.current = text;
  const [editor] = useState(() =>
    createCanvasEditor(
      workspaceId,
      {
        begin,
        create,
        save,
        renew,
        cancel,
        delete: remove,
        refresh: () => refreshCanvases(queryClient, workspaceId),
        select: (id) => selection.selectDirect(workspaceId, id),
      },
      translatedEditorText(currentText),
    ),
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
  const { t } = useText();
  const preview = getClientHost().useRpc(previewCanvasDraft);
  const previewRpc = useRef(preview);
  previewRpc.current = preview;
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [rendered, setRendered] = useState<Document | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const current = ++request.current;
    if (mode !== "preview") return;
    setLoading(true);
    setPreviewFailed(false);
    setRendered(null);
    void previewRpc
      .current({ content: d.content })
      .then((result) => {
        if (request.current === current) setRendered(result.document);
      })
      .catch(() => {
        if (request.current === current)
          setPreviewFailed(true);
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
          {d.original ? t("editing.heading.edit") : t("editing.heading.new")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ToolbarButton
            icon="Save"
            label={state.busy ? t("editing.working") : t("editing.save")}
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
            label={t("editing.cancel")}
            disabled={state.busy}
            onPress={() => editor.cancel()}
          />
          <ToolbarButton
            icon={mode === "edit" ? "Eye" : "Code"}
            label={
              mode === "edit" ? t("editing.preview") : t("editing.markdown")
            }
            onPress={() => setMode(mode === "edit" ? "preview" : "edit")}
          />
        </View>
        {d.original && (
          <Text style={{ ...metaText, color: colors.foregroundMuted }}>
            {d.lost
              ? t("editing.lockUnavailable")
              : t("editing.editingRevision", {
                  revision: d.original.revision,
                })}
          </Text>
        )}
        {d.lost && !d.uncertain && (
          <ToolbarButton
            icon="LockKeyhole"
            label={t("editing.reacquire")}
            disabled={state.busy}
            onPress={() => void editor.reacquire()}
          />
        )}
        {d.uncertain && (
          <ToolbarButton
            icon="RefreshCw"
            label={t("editing.checkLatest")}
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
        <Text style={{ ...metaText, color: colors.foreground }}>
          {t("editing.titleLabel")}
        </Text>
        <TextInput
          accessibilityLabel={t("editing.titleInput")}
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
            {t("editing.titleTooLong")}
          </Text>
        )}
        {mode === "edit" ? (
          <>
            <Text style={{ ...metaText, color: colors.foreground }}>
              {t("editing.contentLabel")}
            </Text>
            <TextInput
              accessibilityLabel={t("editing.contentInput")}
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
                {t("editing.contentTooLong")}
              </Text>
            )}
          </>
        ) : (
          <>
            {loading && (
              <Text style={{ color: colors.foregroundMuted }}>
                {t("editing.loadingPreview")}
              </Text>
            )}
            {previewFailed && (
              <Text
                accessibilityRole="alert"
                style={{ color: colors.statusDanger }}
              >
                {t("editing.previewFailed")}
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
  const { t } = useText();
  return (
    <Modal
      title={
        deleting
          ? t("editing.confirm.deleteTitle")
          : t("editing.confirm.discardTitle")
      }
      open={state.confirmation !== null}
      onOpenChange={(open) => {
        if (!open && !state.busy) editor.dismissConfirmation();
      }}
    >
      <Modal.Content>
        <View style={{ gap: 16, padding: 16 }}>
          <Text style={{ color: theme.colors.foreground }}>
            {deleting
              ? t("editing.confirm.deleteBody", {
                  title: editor.deletionTitle(),
                })
              : t("editing.confirm.discardBody")}
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
              label={
                deleting
                  ? t("editing.confirm.cancel")
                  : t("editing.confirm.keepEditing")
              }
              disabled={state.busy}
              onPress={() => editor.dismissConfirmation()}
            />
            <ToolbarButton
              icon={deleting ? "Trash2" : "Undo2"}
              label={
                deleting
                  ? t("editing.confirm.deletePermanently")
                  : t("editing.confirm.discard")
              }
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
