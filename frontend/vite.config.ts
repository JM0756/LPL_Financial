import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const isProd = process.env.NODE_ENV === "production";
const base = isProd ? "/" : "/ports/5176/";

export default defineConfig({
  base,
  define: {
    global: "globalThis",
  },
  plugins: [
    ...(!isProd
      ? [
          {
            name: "workshop-port-routing",
            configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
              server.middlewares.use((req, _res, next) => {
                if (req.url && !req.url.startsWith(base)) {
                  req.url = base + req.url.replace(/^\/+/, "");
                }
                next();
              });
            },
          },
        ]
      : []),
    react(),
  ],
  server: {
    host: "0.0.0.0",
    port: 5176,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/ports/5176/api": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ports\/5176/, ""),
      },
    },
  },
});