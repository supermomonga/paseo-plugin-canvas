import { vi } from "vitest";

// Components translate through the SDK hook, which needs a plugin surface.
// Test files that mock the module themselves spread `translationMocks`.
vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  ...(await import("./support/i18n")).translationMocks,
}));
