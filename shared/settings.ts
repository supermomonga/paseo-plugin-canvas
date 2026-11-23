import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Host-scoped preferences shared by every client of the daemon. */
export const canvasSettings = defineSettings({
  id: "canvas",
  scope: "host",
  version: 2,
  schema: z.object({
    timelineNotifications: z.boolean().default(true),
  }),
  // Version 1 also held the link preference, which is now per device (ADR 18).
  migrate: (values) => {
    const { timelineNotifications } = (values ?? {}) as {
      timelineNotifications?: unknown;
    };
    return typeof timelineNotifications === "boolean"
      ? { timelineNotifications }
      : {};
  },
});
export type CanvasSettings = z.output<typeof canvasSettings.schema>;
export const defaultCanvasSettings: CanvasSettings =
  canvasSettings.schema.parse({});

/** Preferences of the device running the app. */
export const canvasDeviceSettings = defineSettings({
  id: "canvas-device",
  scope: "device",
  version: 1,
  schema: z.object({
    openLinksIn: z
      .enum(["workspace-browser", "system"])
      .default("workspace-browser"),
  }),
});
export type CanvasDeviceSettings = z.output<
  typeof canvasDeviceSettings.schema
>;
export const defaultCanvasDeviceSettings: CanvasDeviceSettings =
  canvasDeviceSettings.schema.parse({});
