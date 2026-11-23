import { defineAttachmentSource } from "@getpaseo/plugin";
import { useRpc, type PluginClientContext } from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  useToast,
  ScrollView,
  FlatList,
  TextInput,
  copyText,
} from "@getpaseo/plugin/client/ui";
import { initClientHelpers } from "paseo-plugin-helper/client";
import { CanvasPanel } from "./client/panel";
import { CanvasActivityRow } from "./client/activity";
import {
  CANVAS_SCREEN,
  CanvasScreen,
  canvasScreenParams,
} from "./client/screen";
import { CanvasSidebarItem } from "./client/sidebar";
import { CanvasSettingsScreen, SETTINGS_SCREEN } from "./client/settings";
import { createCanvasSelection } from "./client/selection";
import { findCanvas } from "./client/commands";
import { messages } from "./client/i18n";
import { canvasActivitySchema } from "./shared/activity";
import { searchCanvasAttachments } from "./shared/attachments";
import { listCanvases } from "./shared/contracts";

const PANEL = "canvas";

export default function contribute(client: PluginClientContext) {
  initClientHelpers({
    // The helper names icons; Paseo's Icon also accepts other icon forms.
    Icon: ({ name, size, color }) => (
      <Icon name={name} size={size} color={color} />
    ),
    Modal,
    useRpc,
    useToast,
    ScrollView,
    FlatList,
    TextInput,
    copyText,
  });
  const selection = createCanvasSelection();
  const removers = [
    client.addTimelineRenderer({
      kind: "canvas-activity",
      version: 1,
      schema: canvasActivitySchema,
      Component: (props) => (
        <CanvasActivityRow
          {...props}
          onOpen={(activity) => {
            selection.select(activity.workspaceId, activity.canvasId);
            client.openPanel(PANEL, { workspaceId: activity.workspaceId });
          }}
        />
      ),
    }),
    client.addWorkspacePanel({
      id: PANEL,
      title: messages.message("plugin.title"),
      icon: "NotebookPen",
      Component: (props) => (
        <CanvasPanel
          {...props}
          selection={selection}
          onOpenScreen={(canvasId) =>
            client.openScreen({
              screenId: CANVAS_SCREEN,
              params: canvasScreenParams(props.workspaceId, canvasId),
            })
          }
        />
      ),
    }),
    client.addScreen({
      id: CANVAS_SCREEN,
      title: messages.message("plugin.title"),
      Component: CanvasScreen,
    }),
    client.addSidebarHeaderItem({
      id: "canvas",
      title: messages.message("plugin.title"),
      Component: CanvasSidebarItem,
    }),
    client.addSettingsScreen({
      id: SETTINGS_SCREEN,
      title: messages.message("plugin.title"),
      icon: "NotebookPen",
      Component: CanvasSettingsScreen,
    }),
    client.addCommandCenterItem({
      id: "canvas-settings",
      title: messages.message("plugin.openSettings"),
      icon: "Settings",
      context: "global",
      onSelect({ openSettings }) {
        openSettings(SETTINGS_SCREEN);
      },
    }),
    client.addCommandCenterItem({
      id: "open-canvas",
      title: messages.message("plugin.openCanvas"),
      icon: "NotebookPen",
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(PANEL);
      },
    }),
    // `/canvas [title]` opens the panel, at the named canvas when one matches.
    client.addSlashCommand({
      name: "canvas",
      description: messages.message("plugin.slashDescription"),
      argumentHint: messages.message("plugin.slashHint"),
      context: "workspace",
      async onSubmit({ args, workspace, rpc, openPanel }) {
        openPanel(PANEL);
        if (!args) return;
        const { items } = await rpc(listCanvases, { workspaceId: workspace.id });
        const match = findCanvas(items, args);
        // Paseo shows a rejected command as an error toast.
        if (!match)
          throw new Error(
            client.i18n.t(messages, "plugin.noMatch", { query: args }),
          );
        selection.select(workspace.id, match.canvasId);
      },
    }),
    // The composer's attachment picker sends a canvas snapshot with a prompt.
    client.addAttachmentSource(
      defineAttachmentSource({
        id: "canvas",
        title: messages.message("plugin.attachmentTitle"),
        icon: "NotebookPen",
        pickerTitle: messages.message("plugin.attachmentPicker"),
        searchPlaceholder: messages.message("plugin.attachmentSearch"),
        search: searchCanvasAttachments,
      }),
    ),
  ];
  return () => {
    for (const remove of removers.reverse()) remove();
  };
}
