import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
    plugins: [vue()],

    // Assets are served by Frappe from /assets/entre_erp/support/
    base: "/assets/entre_erp/support/",

    resolve: {
        alias: {
            "@": resolve(__dirname, "./src"),
        },
    },

    build: {
        outDir: "../entre_erp/public/support",
        emptyOutDir: true,
        rollupOptions: {
            // Use JS as the entry point so Vite does not emit index.html into public/
            // The HTML shell is provided by Frappe via www/support.html
            input: resolve(__dirname, "src/main.js"),
            output: {
                entryFileNames: "index.js",
                chunkFileNames: "chunks/[name]-[hash].js",
                assetFileNames: (info) => {
                    if (info.name?.endsWith(".css")) return "index.css";
                    return info.name ?? "asset";
                },
            },
        },
    },

    server: {
        // Proxy API calls to the local Frappe dev server during development
        proxy: {
            "/api": { target: "http://localhost:8000", changeOrigin: true },
            "/assets": { target: "http://localhost:8000", changeOrigin: true },
        },
    },
});
