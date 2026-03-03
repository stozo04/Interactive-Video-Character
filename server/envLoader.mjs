/**
 * Node.js ESM loader hook
 *
 * Rewrites Vite-specific APIs in project source files so they work in Node/tsx:
 *   - `import.meta.env`  → `globalThis.__importMetaEnv`  (env vars)
 *   - `import.meta.glob` → no-op that returns `{}`       (Vite asset glob)
 *   - `import x from '...?raw'` → reads file as UTF-8 string  (Vite raw imports)
 *
 * Registered via `register()` in envShim.ts.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

/**
 * Resolve hook: intercepts `?raw` specifiers before Node.js tries to determine
 * their format (which would fail for .md files).
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("?raw")) {
    const cleanSpecifier = specifier.slice(0, -4); // strip '?raw'
    const resolved = await nextResolve(cleanSpecifier, context);
    // Re-attach ?raw so the load hook can identify this as a raw import
    return { ...resolved, url: resolved.url + "?raw", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // Handle ?raw imports — return file content as a default-export string module.
  // Must short-circuit BEFORE calling nextLoad; .md has no known Node format.
  if (url.includes("?raw")) {
    const filePath = fileURLToPath(url.split("?")[0]);
    const content = readFileSync(filePath, "utf-8");
    return {
      format: "module",
      source: `export default ${JSON.stringify(content)};`,
      shortCircuit: true,
    };
  }

  const result = await nextLoad(url, context);

  // Only transform project files, skip node_modules and non-source
  if (url.includes("node_modules") || !result.source) {
    return result;
  }

  let source =
    typeof result.source === "string"
      ? result.source
      : Buffer.from(result.source).toString("utf-8");

  let modified = false;

  // Rewrite import.meta.env → globalThis.__importMetaEnv
  if (source.includes("import.meta.env")) {
    source = source.replaceAll("import.meta.env", "globalThis.__importMetaEnv");
    modified = true;
  }

  // Shim import.meta.glob → no-op returning empty object
  // Vite's import.meta.glob(...) is a compile-time feature that doesn't exist in Node.
  // Replace calls with a function that returns {} so modules load without error.
  if (source.includes("import.meta.glob")) {
    source = source.replaceAll("import.meta.glob", "(() => ({}))");
    modified = true;
  }

  if (modified) {
    return { ...result, source };
  }

  return result;
}
