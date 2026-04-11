import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, "../../"), "");

  return {
  base: "/app",

  define: {
    "import.meta.env.VITE_SIGNUP_DISABLED": JSON.stringify(env.SIGNUP_DISABLED || "false"),
    "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(env.VITE_GOOGLE_CLIENT_ID || ""),
  },

  plugins: [
    react(),
    tailwindcss(),
    process.env.ANALYZE && visualizer({
      open: true,
      gzipSize: true,
      brotliSize: true,
      template: "treemap",
      filename: "dist/stats.html",
    }),
  ].filter(Boolean) as any,

  server: {
    proxy: {
      "/trpc": "http://localhost:3333",
      "/auth": "http://localhost:3333",
    },
  },

  optimizeDeps: {
    include: [
      "react", "react-dom",
      "react-router",
      "@trpc/client", "@trpc/react-query",
      "@tanstack/react-query",
      "marked", "highlight.js", "react-hook-form",
    ],
  },

  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/react-router")) {
            return "vendor-router";
          }
          if (id.includes("node_modules/@trpc/") || id.includes("node_modules/@tanstack/")) {
            return "vendor-data";
          }
          if (id.includes("node_modules/highlight.js") || id.includes("node_modules/marked")) {
            return "vendor-markdown";
          }
          if (id.includes("node_modules/")) {
            return "vendor-misc";
          }
        },
      },
    },
  },
  };
});
