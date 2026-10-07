import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const PANEL_PORT = Number(process.env.PANEL_PORT ?? 7178);
const DEV_PORT = Number(process.env.PANEL_DEV_PORT ?? 7177);
const DEV_HOST = process.env.PANEL_DEV_HOST ?? "0.0.0.0";

/**
 * Vite dev server proxies every /api and /admin call to the Node sidecar.
 * The browser never talks to the Python relay directly.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: DEV_HOST,
    port: DEV_PORT,
    strictPort: true,
    // Termux / phone previews need the dev server to accept any Host header.
    allowedHosts: true,
    proxy: {
      "/api": { target: `http://127.0.0.1:${PANEL_PORT}`, changeOrigin: true },
      "/admin": { target: `http://127.0.0.1:${PANEL_PORT}`, changeOrigin: true },
    },
  },
  preview: {
    host: DEV_HOST,
    port: DEV_PORT,
    allowedHosts: true,
  },
  build: {
    // Older WebView builds on Termux/Android: keep the target conservative.
    target: "es2019",
    cssCodeSplit: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});
