# App.tsx Developer Guide

This document explains the current client/server message architecture for `src/App.tsx`.

## Current Architecture

- `src/App.tsx` is a thin UI orchestrator.
- AI reasoning and tool execution run server-side through `/agent/message`.
- Function tools are declared in `src/services/aiSchema.ts` and executed in `src/services/memoryService.ts` via the server tool bridge.
- Google integrations (Gmail, Calendar, Tasks, etc.) are handled through `gogcli` using the `google_cli` function tool.

## Important Change (Tasks)

Legacy in-app checklist/task architecture was removed.

Current behavior:
- Routine task requests should use the `google_task_action` function tool.
- `google_cli` remains available for advanced/raw Google Tasks commands.
- Example `google_task_action` payloads:
  - `{ action: "create", title: "Buy groceries" }`
  - `{ action: "complete", title: "Buy groceries" }`
  - `{ action: "list" }`

## End-to-End Message Flow

1. User sends message in `ChatPanel`.
2. `src/App.tsx` calls `agentClient.sendMessage()`.
3. `server/routes/agentRoutes.ts` receives `POST /agent/message`.
4. `src/services/messageOrchestrator.ts` coordinates response generation.
5. `server/services/ai/serverGeminiService.ts` runs Gemini chat + function calling.
6. Tool calls execute through `server/services/ai/toolBridge.ts` -> `src/services/memoryService.ts`.
7. `src/App.tsx` renders returned chat/media updates.

## Key Files

- `src/App.tsx`: UI orchestration and rendering.
- `src/services/agentClient.ts`: thin HTTP client for `/agent/*` routes.
- `src/services/aiSchema.ts`: response schema + tool declarations.
- `src/services/memoryService.ts`: tool execution switch.
- `src/services/messageOrchestrator.ts`: orchestration pipeline.
- `src/services/system_prompts/**`: prompt builders and tool guidance.
- `server/routes/agentRoutes.ts`: server API gateway.
- `server/services/ai/serverGeminiService.ts`: server-side AI service.
- `server/services/gogService.ts`: `gogcli` wrapper used by `google_cli` and `google_task_action`.

## Adding a New Function Tool

1. Add the tool declaration in `src/services/aiSchema.ts`.
2. Add tool argument typing in `src/services/aiSchema.ts`.
3. Implement execution in `src/services/memoryService.ts`.
4. Update tool prompting in `src/services/system_prompts/tools/toolsAndCapabilities.ts`.
5. Validate via local build/test and real chat turn.

## Notes

- Keep App-side logic presentation-focused.
- Keep tool side effects server-side.
- Prefer function tools over fragile text parsing.
