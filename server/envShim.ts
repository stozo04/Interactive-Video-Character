/**
 * import.meta.env polyfill for Node/tsx
 *
 * Loaded via `tsx --import ./server/envShim.ts` BEFORE the main entry point.
 *
 * Two-part strategy:
 * 1. Load .env.local/.env into process.env, then build globalThis.__importMetaEnv
 * 2. Register a Node.js loader hook (envLoader.mjs) that rewrites
 *    `import.meta.env` → `globalThis.__importMetaEnv` in source code
 *
 * Result: all existing services that read import.meta.env.VITE_* work unchanged.
 */

import { config } from "dotenv";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { register } from "node:module";

// 1. Load env files (.env.local takes priority, .env as fallback)
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

// 2. Build the env object from all VITE_* process.env vars
const env: Record<string, string> = {};

for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("VITE_") && value !== undefined) {
    env[key] = value;
  }
}

// Server-only override: bypass Vite dev proxy for Gemini API
if (process.env.GEMINI_API_BASE_URL) {
  env.VITE_GEMINI_PROXY_URL = process.env.GEMINI_API_BASE_URL;
}

// 3. Set the global that the loader hook will rewrite references to
(globalThis as any).__importMetaEnv = env;

// 4. Shim browser-only globals that some services reference
// localStorage: used by newsService.ts for recent story cache
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  };
}

// 5. Register the loader hook that rewrites import.meta.env in source code
const loaderPath = pathToFileURL(
  resolve(process.cwd(), "server/envLoader.mjs")
).href;
register(loaderPath, import.meta.url);

console.log(
  "[envShim] Loaded",
  Object.keys(env).length,
  "VITE_* env vars + registered loader hook"
);
