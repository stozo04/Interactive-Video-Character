# Lessons Learned — image-system — 2026-03-05

## Ticket
Not a ticket — standing project convention discovered during session debugging.

## Codebase Discoveries

### Image generation has two providers: Gemini and Grok
Every function in the image generation pipeline comes in a pair:

| Gemini | Grok |
|--------|------|
| `selectReferenceImageForGemini` | `selectReferenceImageForGrok` |
| `getReferenceImageContentForGemini` | `getReferenceImageContentForGrok` |
| `fetchReferenceImageContentForGemini` | `fetchReferenceImageContentForGrok` |

Key files:
- `src/utils/referenceImages/index.ts` — registry + content functions
- `src/services/imageGeneration/referenceSelector.ts` — selectors (both providers)
- `src/services/imageGenerationService.ts` — call sites

**Rule: Any change to reference selection, content loading, fallback logic, or scoring MUST be applied to both providers. There is no shared code path at this layer.**

### import.meta.glob (Vite) does NOT work server-side
`src/utils/referenceImages/index.ts` uses `import.meta.glob('**/*.jpg', { query: '?base64' })` to pre-load images as base64 at build time. This only works in browser-compiled (Vite) code.

When image generation runs server-side (e.g. Telegram handler → Node.js):
- `imageModules` is empty
- `REFERENCE_IMAGE_REGISTRY` still populates (falls back to `config.json` metadata)
- `REFERENCE_IMAGE_CONTENT_GEMINI` stays `{}` — no base64 content
- `getReferenceImageContentForGemini/Grok` return `null` for every ID
- Selector throws "Reference not found: <id>" even though the ID is in the registry

### The fix pattern
Two server-compatible async fallback functions exist alongside the sync Vite ones:
- `fetchReferenceImageContentForGemini(id)` — fetches Supabase public URL, returns base64
- `fetchReferenceImageContentForGrok(id)` — returns `metadata.url` directly (Grok takes URLs, no fetch needed)

Selectors use: `syncResult ?? await fetchResult` at every content lookup point.
Selectors are `async` to support this pattern.

## Gotchas & Bugs

- The registry appears populated even on the server (config.json fallback works). So you'll see the reference ID in the log — it just has no content. The throw "Reference not found" is misleading; it means "content not found", not "ID not found".
- `getReferenceImageContentForGrok` actually DOES work server-side (its fallback uses config URLs). The Gemini one does NOT (no URL fallback for base64). Still add the async fetch pattern for both for safety and symmetry.

## What Future Opey Should Know

- If you touch anything image-related, check both the Gemini and Grok code paths. They are parallel, not shared.
- If a selfie fails server-side with "Reference not found" but the registry log shows the ID — it's the Vite/server context mismatch, not a bad ID.
- The `fetchReferenceImage*` functions are the server-compatible fallbacks. They are in `src/utils/referenceImages/index.ts`.
- Severity: fetch failures in `fetchReferenceImageContentForGemini` should be `log.error` (user-visible impact — no selfie generated). Fallbacks that degrade gracefully (empty registry → random fallback) are `log.warning`.
