import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
