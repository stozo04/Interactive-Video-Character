/**
 * Node.js ESM loader hook
 *
 * Rewrites Vite-specific APIs in project source files so they work in Node/tsx:
 *   - `import.meta.env`  → `globalThis.__importMetaEnv`  (env vars)
 *   - `import.meta.glob` → no-op that returns `{}`       (Vite asset glob)
 *
 * Registered via `register()` in envShim.ts.
 */

export async function load(url, context, nextLoad) {
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
