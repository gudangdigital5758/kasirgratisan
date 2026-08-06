import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "kasirgratisan-icon.png", "og-image.png"],
      manifest: {
        name: "Profitku - POS UMKM Gratis",
        short_name: "Profitku",
        description: "Aplikasi kasir gratis untuk UMKM Indonesia. Offline & tanpa biaya.",
        start_url: "/",
        display: "standalone",
        background_color: "#FFFFFF",
        theme_color: "#0060E0",
        orientation: "any",
        icons: [
          {
            src: "/kasirgratisan-icon.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/kasirgratisan-icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4000000,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        // Pecah hanya library berat & independen (ESM) yang di-lazy-load via route.
        // Ekosistem React/UI (react, react-dom, @radix-ui, dll — banyak yang CJS)
        // DIBIARKAN dikelompokkan Rollup: memecahnya manual menyebabkan duplikasi
        // modul / interop CJS rusak (mis. `createContext` undefined).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("exceljs")) return "exceljs";
          if (id.includes("html5-qrcode")) return "qrcode-scanner";
          if (id.includes("leaflet")) return "leaflet";
          if (id.includes("html2canvas")) return "html2canvas";
          if (
            id.includes("recharts") ||
            id.includes("d3-") ||
            id.includes("victory") ||
            id.includes("internmap") ||
            id.includes("delaunator")
          ) {
            return "charts";
          }
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
