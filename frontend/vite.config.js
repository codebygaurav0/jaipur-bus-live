import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1588,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        busRoutes: resolve(import.meta.dirname, "pages/jaipur-bus-routes/index.html"),
        metroGuide: resolve(import.meta.dirname, "pages/jaipur-metro-guide/index.html"),
        liveTracking: resolve(import.meta.dirname, "pages/jctsl-live-bus-tracking/index.html"),
      },
    },
  },
});
