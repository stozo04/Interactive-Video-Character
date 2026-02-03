# IdleThinkingService

## Core Responsibilities
- Run a single idle action (storyline, browse, question, or tool discovery) per idle session.
- Enforce per‑action daily caps via `idle_action_log`.
- Generate and store idle questions, browse notes, and tool suggestions.
- Build prompt sections for queued idle questions, browse notes, and tool suggestions.
- Update statuses via tool calls (`resolve_idle_question`, `resolve_idle_browse_note`, `tool_suggestion`).

---

## Workflow Interaction (ASCII)

```text
[App.tsx idle tick]
        |
        v
[runIdleThinkingTick]
   |   |   |
   |   |   +--> question -> idle_questions (queued)
   |   +------> browse   -> idle_browse_notes (queued)
   +----------> storyline -> storyline_pending_suggestions
   +----------> tool_discovery -> kayley_tool_suggestions (queued)
        |
        v
[systemPromptBuilder]
   |
   +--> buildIdleQuestionPromptSection()
   +--> buildIdleBrowseNotesPromptSection()
   +--> buildToolSuggestionsPromptSection()
```

---

## Key Types / Interfaces

```ts
export type IdleActionType = "storyline" | "browse" | "question" | "tool_discovery";

export type IdleQuestionStatus = "queued" | "asked" | "answered";

export interface IdleQuestion {
  id: string;
  question: string;
  status: IdleQuestionStatus;
  createdAt: Date;
  askedAt?: Date | null;
  answeredAt?: Date | null;
  answerText?: string | null;
}

export interface IdleBrowseNote {
  id: string;
  topic: string;
  summary: string;
  itemTitle?: string | null;
  itemUrl?: string | null;
  status: "queued" | "shared";
  createdAt: Date;
}
```

---

## Does it use an LLM?
**Yes.**
- Gemini is used to generate:
  - Deep curiosity questions
  - Browse topics and summaries
  - Tool suggestions (tool discovery)
- System prompts are built in `idleThinkingService.ts`.

---

## Logging
Prefix: **`[IdleThinking]`**

Logged events include:
- Action selection + daily cap checks
- Question generation + storage
- Browse topic/summary generation + storage
- Tool suggestion generation + storage
- Prompt section building counts
- Status updates for questions, browse notes, and tool suggestions

---

## Integration Points

**Inputs from:**
- `App.tsx` idle timer (calls `runIdleThinkingTick`)
- `memoryService.ts` (tool calls)

**Outputs to:**
- Supabase tables (`idle_action_log`, `idle_questions`, `idle_browse_notes`, `kayley_tool_suggestions`)
- `systemPromptBuilder.ts` (prompt sections)

---

## Testing
Manual checks:
1) Wait 2 minutes idle.
2) Verify logs and DB rows.
3) Confirm prompt injection on next message.

Automated tests (future):
```bash
npm test -- --run
```

---

## Common Patterns (How to Extend)

**Add a new idle action**
1) Add new action type to `IdleActionType`.
2) Add daily cap check in `runIdleThinkingTick`.
3) Implement storage + prompt injection logic.
4) Add tool calls if status tracking is needed.
5) Update prompt sections if the action injects context.

**Change idle timing**
- Update constants in `App.tsx` and `idleThinkingService.ts`.
