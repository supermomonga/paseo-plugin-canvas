import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";
import { en } from "./en";
import { ja } from "./ja";

/** Interface text in the app's language; other languages fall back to English. */
export const messages = defineTranslations({ resources: { en, ja } });
export type CanvasMessages = typeof messages;
export type MessageKey = Parameters<CanvasMessages["message"]>[0];

/** Translates text in components rendered inside the plugin runtime. */
export const useText = () => useTranslation(messages);
