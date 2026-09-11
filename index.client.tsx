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
import { CanvasPanel } from "./client/panel";
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
  const removePanel = client.addWorkspacePanel({
    id: "canvas",
    title: "Canvas",
    icon: "NotebookPen",
    context: "workspace",
    Component: CanvasPanel,
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
  return () => {
    removeCommand();
    removePanel();
  };
}
