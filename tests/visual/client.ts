// Visual-test fixture for @getpaseo/plugin/client. Paseo's app adds these
// exports when it evaluates a plugin; the npm package only declares them.
export * from "../../node_modules/@getpaseo/plugin/dist/client/index.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { PluginTranslationRuntime } from "../../node_modules/@getpaseo/plugin/dist/client/translations.js";
import {
  defaultCanvasDeviceSettings,
  defaultCanvasSettings,
} from "../../shared/settings";

declare const window: {
  open(url: string, target: string, features: string): unknown;
  location: { search: string };
};

// `?locale=ja` previews the Japanese interface.
const locale =
  new URLSearchParams(window.location.search).get("locale") ?? "en";
const runtime = new PluginTranslationRuntime({
  getLocale: () => locale,
  subscribe: () => () => {},
});

export function useTranslation(messages: Parameters<typeof runtime.t>[0]) {
  return {
    locale,
    t: (key: string, ...args: unknown[]) =>
      runtime.resolve(
        (messages.message as (key: string, ...args: unknown[]) => never)(
          key,
          ...args,
        ),
        locale,
      ),
  };
}

/** Follows the fixture server's change cursor with long polls. */
export function useSubscription(
  contract: { name: string },
  input: { workspaceId: string },
  onEvent: (event: { cursor: string }) => void,
) {
  const listener = useRef(onEvent);
  listener.current = onEvent;
  const [state] = useState({ status: "live" as const });
  useEffect(() => {
    let stopped = false;
    let cursor: string | null = null;
    void (async () => {
      while (!stopped) {
        try {
          const response = await fetch(`/rpc/${contract.name}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...input, cursor }),
          });
          const event = (await response.json()) as { cursor: string };
          if (stopped) return;
          if (event.cursor !== cursor) listener.current(event);
          cursor = event.cursor;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [contract.name, input.workspaceId]);
  return state;
}

export function useSettings() {
  return {
    status: "ready" as const,
    values: { ...defaultCanvasSettings, ...defaultCanvasDeviceSettings },
    revision: "fixture",
    saving: false,
    saveError: null,
    save: async () => false,
    reset: async () => false,
    reload: async () => {},
  };
}

/** Calls the fixture server's handler for the contract. */
export function useRpc(contract: { name: string }) {
  return useCallback(
    async (input: unknown) => {
      const response = await fetch(`/rpc/${contract.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data;
    },
    [contract],
  );
}

export async function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
