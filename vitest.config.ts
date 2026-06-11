import path from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const webRoot = path.resolve(__dirname, "server-web");

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": webRoot,
      "@components": path.resolve(webRoot, "components"),
      "@composables": path.resolve(webRoot, "composables"),
      "@views": path.resolve(webRoot, "views"),
      "@lib": path.resolve(webRoot, "lib"),
      "@router": path.resolve(webRoot, "router"),
      "@types": path.resolve(webRoot, "types"),
    },
  },
  test: {
    include: [
      "tests/vitest/**/*.{test,spec}.{js,mjs,cjs,ts,tsx}",
      "tests/server/**/*.{test,spec}.{js,mjs,cjs,ts,tsx}"
    ],
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "build/coverage/node-vue",
      all: true,
      include: [
        "server/**/*.mjs",
        "server-web/**/*.ts",
        "server-web/**/*.vue",
      ],
      exclude: [
        "server/scripts/**",
        "server/config/**/*.json",
        "server/platform/modules/knowledge/runtime/**",
        "server/platform/modules/knowledge/tika/**",
        "server/platform/modules/knowledge/ocr/runtime/**",
        "server/protocols/**/*.md",
        "server-web/public/**",
        "server-web/**/*.d.ts",
        "server-web/index.html",
      ],
    },
  },
});
