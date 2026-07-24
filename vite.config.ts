/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/src-tauri/**"],
    // A CPU-starved vitest fork can take several seconds to flush a synchronous
    // render under the full parallel suite; give tests headroom above Testing
    // Library's asyncUtilTimeout so findBy*/waitFor can complete rather than the
    // test being killed at the default 5s.
    testTimeout: 20000,
  },
});
