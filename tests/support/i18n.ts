// The SDK's own translation runtime (i18next), without a plugin surface.
import {
  PluginTranslationRuntime,
  defineTranslations,
} from "../../node_modules/@getpaseo/plugin/dist/client/translations.js";

/** The app language the mocked hooks report; tests may switch it. */
export const appLocale = { current: "en" };

const runtime = new PluginTranslationRuntime({
  getLocale: () => appLocale.current,
  subscribe: () => () => {},
});

type Messages = Parameters<typeof runtime.t>[0];

/** Drop-in replacements for the client SDK's translation exports. */
export const translationMocks = {
  defineTranslations,
  useTranslation: (messages: Messages) => ({
    locale: appLocale.current,
    t: (key: string, ...args: unknown[]) =>
      runtime.resolve(
        (messages.message as (key: string, ...args: unknown[]) => never)(
          key,
          ...args,
        ),
        appLocale.current,
      ),
  }),
};

/** Resolves a registration label (`messages.message(...)`) in the test locale. */
export function resolveText(text: unknown) {
  return runtime.resolve(text as string, appLocale.current);
}
