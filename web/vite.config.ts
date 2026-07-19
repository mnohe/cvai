import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../core-web/src"),
      "@branding": path.resolve(__dirname, "src/branding"),
      "@cvai/core-web/styles.css": path.resolve(__dirname, "../core-web/src/index.css"),
      "@cvai/core-web": path.resolve(__dirname, "../core-web/src/index.ts"),
      firebase: path.resolve(__dirname, "node_modules/firebase"),
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom/client": path.resolve(__dirname, "node_modules/react-dom/client.js"),
      "react/jsx-runtime": path.resolve(__dirname, "node_modules/react/jsx-runtime.js"),
      "react-router-dom": path.resolve(__dirname, "node_modules/react-router-dom/dist/index.mjs"),
    },
  },
  server: {
    watch: {
      ignored: ["**/playwright-report/**", "**/test-results/**", "**/dist/**"],
    },
    proxy: {
      "/api": {
        target: process.env.DEV_API_PROXY_TARGET ?? "http://127.0.0.1:8081",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
