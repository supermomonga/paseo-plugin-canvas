import { useRpc, type PluginClientContext } from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  useToast,
  ScrollView,
  FlatList,
  TextInput,
  copyText,
} from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "paseo-plugin-helper/client";
import { registerNativeCanvasHeaders } from "./client/header";
import { CanvasPanel } from "./client/panel";
import { CanvasActivityRow, startActivitySync } from "./client/activity";
import { createCanvasSelection } from "./client/selection";
import { canvasActivitySchema } from "./shared/activity";
export default function contribute(client: PluginClientContext) {
  initClientHelpers({
    Icon,
    Modal,
    useRpc,
    useToast,
    ScrollView,
    FlatList,
    TextInput,
    copyText,
  });
  const selection = createCanvasSelection();
  const stopActivitySync = startActivitySync(client);
  const removeActivity = client.addTimelineRenderer({
    kind: "canvas-activity",
    version: 1,
    schema: canvasActivitySchema,
    Component: (props) => (
      <CanvasActivityRow
        {...props}
        onOpen={(activity) => {
          selection.select(activity.workspaceId, activity.canvasId);
          client.openPanel("canvas", { workspaceId: activity.workspaceId });
        }}
      />
    ),
  });
  const removePanel = client.addWorkspacePanel({
    id: "canvas",
    title: "Canvas",
    icon: "NotebookPen",
    context: "workspace",
    Component: (props) => <CanvasPanel {...props} selection={selection} />,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-canvas",
    title: "Open Canvas",
    icon: "NotebookPen",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("canvas");
    },
  });
  const removeHeaders = registerNativeCanvasHeaders(client);
  return () => {
    removeHeaders();
    stopActivitySync();
    removeActivity();
    removeCommand();
    removePanel();
  };
}
