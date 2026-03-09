# Lessons Learned — Gmail Search Tool — 2026-03-05

## Gmail API Quirks

- **`from:` operator is unreliable with partial domain matches.**
  `from:atmos` does NOT reliably match `DoNotReply@atmosenergy.com`.
  Plain keyword queries (e.g., `atmos energy newer_than:1d`) search sender, subject,
  AND body — much more reliable for user-facing search.

- **Always guide the LLM toward keyword queries in tool descriptions.**
  The tool description and system prompt must steer the model away from `from:` filters
  unless the exact sender address is known. This was a real production bug.

## Adding New Gemini Function Tools (Checklist)

When adding a new function tool to the Kayley chat pipeline:

1. **`aiSchema.ts`** — Add Zod schema + type, add to `MemoryToolArgs` union, add to `GeminiMemoryToolDeclarations` array
2. **`memoryService.ts`** — Add to `MemoryToolName` union, add to `ToolCallArgs` interface, add `case` handler in `executeMemoryTool()` switch
3. **`toolsAndCapabilities.ts`** — Add usage policy/strategy section
4. **No changes needed** to `normalizeAiResponse()` or `geminiChatService.ts` (function tools are handled generically)

## Flat Tools vs Unified Classes

- Gemini has no namespace concept for function calling. Don't build `gmail { search, send }` — keep tools flat (`gmail_search`, `email_action`).
- Tools that return data for LLM reasoning = function tools.
- Fire-and-forget actions = JSON fields (or future function tool migration).
