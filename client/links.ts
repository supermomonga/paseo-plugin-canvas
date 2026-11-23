import { createContext, useContext } from "react";
import { Linking } from "react-native";
import {
  openExternalUrl,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import type { CanvasDeviceSettings } from "../shared/settings";

/** Opens an already validated external link (see externalLink). */
export type LinkOpener = (url: string) => Promise<void>;
type OpenBrowser = NonNullable<
  NonNullable<PluginWorkspacePanelProps["navigation"]>["openBrowser"]
>;

// Call openers synchronously from the press: browsers only allow a new tab
// from a user interaction.
export function openSystemLink(url: string) {
  // The host opener ignores non-HTTP(S) URLs; mail links use the OS handler.
  return /^mailto:/i.test(url) ? Linking.openURL(url) : openExternalUrl(url);
}

/** The workspace browser exists only in the Electron app; elsewhere links open
 * externally. The browser never falls back to an external open on its own. */
export function createLinkOpener(options: {
  preference: CanvasDeviceSettings["openLinksIn"];
  openBrowser: OpenBrowser | undefined;
  workspaceId: string;
  serverId: string;
}): LinkOpener {
  const { preference, openBrowser, workspaceId, serverId } = options;
  return async (url) => {
    if (
      preference === "workspace-browser" &&
      openBrowser &&
      /^https?:/i.test(url)
    )
      openBrowser({ url, workspaceId, serverId });
    else await openSystemLink(url);
  };
}

const LinkOpenerContext = createContext<LinkOpener>(openSystemLink);
export const LinkOpenerProvider = LinkOpenerContext.Provider;
export const useLinkOpener = () => useContext(LinkOpenerContext);
