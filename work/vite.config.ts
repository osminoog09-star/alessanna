import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Production default: `/` — deploy at subdomain root (e.g. https://work.alessannailu.com/).
 * Override only if the CRM is ever served under a subpath (not needed for work.alessannailu.com).
 */
function normalizeBase(raw: string | undefined): string {
  const fallback = "/";
  let b = (raw?.trim() || fallback).replace(/\/+/g, "/");
  if (!b.startsWith("/")) b = `/${b}`;
  if (b !== "/" && !b.endsWith("/")) b = `${b}/`;
  return b;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = normalizeBase(env.VITE_BASE_PATH);

  return {
    plugins: [react()],
    base,
    build: {
      outDir: "dist",
    },
    server: {
      port: 5173,
      open: true,
      fs: { allow: [path.resolve(__dirname, "..")] },
    },
    resolve: {
      alias: {
        "@locales": path.resolve(__dirname, "../locales"),
      },
    },
  };
});
