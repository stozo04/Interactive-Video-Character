# Server-Agent Architecture Refactor (2026-03-06)

## What Changed

The intelligence layer moved from the browser (src/services/) to the server (server/services/ai/).

**Before:** Browser called Gemini API directly via Interactions API. API key exposed to browser. Telegram/WhatsApp duplicated orchestration logic.

**After:** One `POST /agent/message` endpoint. Server holds all AI logic. Web/Telegram/WhatsApp are thin clients. API key never touches browser.

## Key Files

| File | Role |
|------|------|
| `server/services/ai/geminiClient.ts` | Singleton `GoogleGenAI` — server-only |
| `server/services/ai/chatSessionManager.ts` | SDK `Chat` sessions, TTL eviction |
| `server/services/ai/toolBridge.ts` | Wraps `executeMemoryTool` as `CallableTool` |
| `server/services/ai/serverGeminiService.ts` | `IAIChatService` using SDK Chat |
| `server/routes/agentRoutes.ts` | HTTP gateway |
| `src/services/agentClient.ts` | Browser-side fetch wrapper |

## Critical Lessons

### 1. `tsx watch` flag ordering matters on Windows
`--ignore` flags must come BEFORE `--import` in the `agent:dev` script.
```
npx tsx watch --ignore '.worktrees/**' --ignore 'node_modules/**' --ignore 'src/**' --import ./server/envShim.ts server/index.ts
```
If `--import` comes before `--ignore`, Node receives `--ignore` as an unknown flag and crashes with `bad option: --ignore`.

### 2. `envShim.ts` is required for `?raw` markdown imports
`serverGeminiService.ts` transitively imports files that use Vite `?raw` syntax (e.g. `import content from './SOUL.md?raw'`). Node.js doesn't understand this. The `--import ./server/envShim.ts` loader hook handles it.

### 3. SDK token field names differ from Interactions API
- `usageMetadata.promptTokenCount` → `total_input_tokens`
- `usageMetadata.candidatesTokenCount` → `total_output_tokens`
- `usageMetadata.totalTokenCount` → `total_tokens`
- `usageMetadata.thoughtsTokenCount` → `total_thought_tokens`

### 4. `CallableTool` is the correct SDK interface for auto function calling
Pass `tools: [toolBridgeInstance]` to `ai.chats.create()`. The SDK calls `tool.tool()` to get declarations and `tool.callTool(functionCalls)` to execute them. Zero need to write a manual tool loop.

### 5. Opey Tidy saved uncommitted work
During this refactor, `/compact` was run without committing. Opey Tidy had already auto-committed everything to branch `opey-dev/tidy-1772807258901`. Always commit before compacting or switching branches.

### 6. Deleted files
- `src/services/geminiChatService.ts` — 1600 lines, Interactions API, replaced by `serverGeminiService.ts`
- `src/contexts/AIServiceContext.tsx` — wrapper for geminiChatService
- `src/handlers/whiteboardHandler.ts` — whiteboard AI integration (feature removed)
- `server/types/chat.ts`, `server/types/orchestrator.ts` — unused placeholders

### 7. What stays client-side
- `elevenLabsService.ts` — needs `URL.createObjectURL(blob)`, browser-only
- `supabaseClient.ts` — real-time subscriptions require browser instance
- `clientLogger.ts` — browser instrumentation
- `agentClient.ts` — thin HTTP wrapper, browser-only
