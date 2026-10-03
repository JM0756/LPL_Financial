import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const base = "/ports/5176/";

export default defineConfig({
  base,
  plugins: [
    {
      name: "workshop-port-routing",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          // The workshop proxy can strip the public port prefix.
          // Restore it internally so Vite does not redirect.
          if (req.url && !req.url.startsWith(base)) {
            req.url = base + req.url.replace(/^\/+/, "");
          }
          next();
        });
      },
    },
    react(),
  ],
  server: {
    host: "0.0.0.0",
    port: 5176,
    strictPort: true,
    allowedHosts: ["dh133zzs2y30r.cloudfront.net"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
      },
    },
  },
});