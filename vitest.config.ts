import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["tests/setup.ts"],
    server: { deps: { inline: [/paseo-plugin-helper/] } },
  },
});
