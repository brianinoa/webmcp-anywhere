// Builds the extension into ./dist with plain Vite (no crxjs).
//
// Content scripts and the service worker must each be a single self-contained
// file (no shared chunks, no dynamic imports), so we run one Vite build per
// entry in IIFE mode, then a normal HTML build for the popup, and finally copy
// manifest.json + static assets. Pass --watch to rebuild on change.

import { build } from "vite";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist");
const watch = process.argv.includes("--watch");

const scriptEntries = [
  { name: "main-world", entry: "src/main-world.ts" },
  { name: "content", entry: "src/content.ts" },
  { name: "background", entry: "src/background.ts" },
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/** Shared config bits. */
const base = {
  root,
  configFile: false,
  logLevel: "warn",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
};

for (const { name, entry } of scriptEntries) {
  await build({
    ...base,
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      sourcemap: false,
      target: "chrome120",
      watch: watch ? {} : null,
      lib: {
        entry: path.join(root, entry),
        name: `WebMCPAnywhere_${name.replace(/-/g, "_")}`,
        formats: ["iife"],
        fileName: () => `${name}.js`,
      },
      rollupOptions: { output: { inlineDynamicImports: true, extend: true } },
    },
  });
  console.log(`[build] ${name}.js`);
}

// Popup (HTML + module script). Vite handles the html -> dist/popup.html.
await build({
  ...base,
  base: "./",
  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    target: "chrome120",
    watch: watch ? {} : null,
    rollupOptions: {
      input: { popup: path.join(root, "popup.html") },
      output: { entryFileNames: "popup.js", assetFileNames: "assets/[name][extname]" },
    },
  },
});
console.log("[build] popup.html");

cpSync(path.join(root, "manifest.json"), path.join(outDir, "manifest.json"));
if (existsSync(path.join(root, "public"))) {
  cpSync(path.join(root, "public"), outDir, { recursive: true });
}
console.log(`[build] manifest + public copied -> ${outDir}`);
if (!watch) console.log("[build] done. Load extension/dist as an unpacked extension.");
