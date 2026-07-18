import path from "node:path";
import type { ViteDevServer } from "vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [localFirebaseHealthPlugin()],
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

function localFirebaseHealthPlugin() {
  return {
    name: "local-firebase-health",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__local/firebase-auth-health", (_req, res) => {
        void respondWithHealth(
          res,
          process.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? "http://localhost:9099",
        );
      });
      server.middlewares.use("/__local/firestore-health", (_req, res) => {
        const host = process.env.VITE_FIRESTORE_EMULATOR_HOST ?? "localhost";
        const port = process.env.VITE_FIRESTORE_EMULATOR_PORT ?? "8080";
        void respondWithHealth(res, `http://${host}:${port}`);
      });
    },
  };
}

async function respondWithHealth(res: { statusCode: number; end: (body?: string) => void }, url: string) {
  try {
    const response = await fetch(url);
    res.statusCode = response.ok || response.status < 500 ? 200 : 503;
    res.end(res.statusCode === 200 ? "ok" : "unavailable");
  } catch {
    res.statusCode = 503;
    res.end("unavailable");
  }
}
