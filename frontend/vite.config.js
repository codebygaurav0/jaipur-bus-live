import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

function preloadChunksPlugin() {
  return {
    name: "preload-chunks-plugin",
    transformIndexHtml(html, { bundle, path: htmlPath }) {
      if (!bundle) return html;
      const isMetro = htmlPath && htmlPath.includes("metro");
      const chunksToPreload = [];

      for (const [fileName] of Object.entries(bundle)) {
        if (isMetro) {
          if (fileName.includes("MetroHome")) {
            if (fileName.endsWith(".js")) {
              chunksToPreload.push(
                `<link rel="modulepreload" crossorigin href="/${fileName}">`
              );
            } else if (fileName.endsWith(".css")) {
              chunksToPreload.push(
                `<link rel="preload" as="style" href="/${fileName}">\n  <link rel="stylesheet" crossorigin href="/${fileName}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" crossorigin href="/${fileName}"></noscript>`
              );
            }
          }
        } else {
          if (fileName.includes("vendor-leaflet") || fileName.includes("LiveBusMap")) {
            if (fileName.endsWith(".js")) {
              chunksToPreload.push(
                `<link rel="modulepreload" crossorigin href="/${fileName}">`
              );
            } else if (fileName.endsWith(".css")) {
              chunksToPreload.push(
                `<link rel="stylesheet" crossorigin href="/${fileName}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" crossorigin href="/${fileName}"></noscript>`
              );
            }
          }
        }
      }

      let modifiedHtml = html;
      if (isMetro) {
        // Safely de-block entry main CSS for Metro to eliminate LCP render delay
        modifiedHtml = modifiedHtml.replace(
          /<link rel="stylesheet" crossorigin href="(\/assets\/main-[^"]+\.css)">/g,
          `<link rel="preload" as="style" href="$1">\n  <link rel="stylesheet" crossorigin href="$1" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" crossorigin href="$1"></noscript>`
        );
      }

      if (chunksToPreload.length > 0) {
        return modifiedHtml.replace(
          "</head>",
          `  ${chunksToPreload.join("\n  ")}\n</head>`
        );
      }
      return modifiedHtml;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadChunksPlugin()],
  server: {
    port: 1588,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:11000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        metro: resolve(import.meta.dirname, "metro/index.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks(id) {
          if (id.includes("node_modules/leaflet")) {
            return "vendor-leaflet";
          }
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/scheduler")
          ) {
            return "vendor-react";
          }
        },
      },
    },
  },
});
