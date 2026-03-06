# Self-Aware Capability Gap System

## Executive Summary

Kayley should be able to recognize when she **can't** do something Steven asks for, communicate that honestly, and take action to get the capability built — without hardcoded condition statements for every possible scenario.

**The problem this solves:**
> Steven: "Can you check my email if I got a notification from Procare about Mila?"
> Kayley: "I don't see anything from Procare in my alerts right now!"

She hallucinated a response instead of recognizing she has no email search tool. The fix isn't adding email search alone — it's giving Kayley a general-purpose mechanism to handle *any* capability gap gracefully.

**Key constraint:** No bloated condition logic. The LLM already knows what tools it has (they're declared in the system prompt and function tool list). We leverage that existing awareness rather than writing detection code.

**Inspiration:** Tools like OpenClaw/Claude Code demonstrate this pattern — when asked to do something they can't, they install packages and write their own code to fulfill the need. The LLM handles the reasoning; the harness just provides the execution channel.

---

## System Overview

### What Already Exists (Disconnected Pieces)

| Component | What It Does | Gap |
|-----------|-------------|-----|
| `tool_suggestion` function tool | Kayley logs "I wish I could..." ideas to `kayley_tool_suggestions` table | Reactive only — requires Kayley to spontaneously muse about tools. No structured gap report. No automatic escalation. |
| `delegate_to_engineering` function tool | Creates engineering tickets (skill/feature/bug) | Kayley uses this when Steven explicitly asks for dev work. Not wired to capability gap detection. |
| `tool_discovery` idle action | Brainstorms tool ideas during idle time (cap: 20/day) | Generates speculative ideas, not grounded in real failed interactions. |
| `get_engineering_ticket_status` / `submit_clarification` | Async ticket loop with Opey | The downstream pipeline exists but has no upstream trigger from capability gaps. |

### The Missing Link

These pieces need a **feedback loop**:

```
Steven asks for something
        |
        v
Kayley recognizes she can't do it (LLM reasoning, not code)
        |
        v
Kayley tells Steven honestly + creates a structured capability request
        |
        v
Request becomes an engineering ticket (delegate_to_engineering)
        |
        v
Opey (or developer) builds the capability
        |
        v
Kayley gains the new tool
```

---

## Architecture

### Core Principle: The LLM Is the Detector

The entire capability gap detection lives in the LLM's reasoning. No `if/else` chains. No keyword matching. No intent classification code.

**Why this works:**
- Kayley's system prompt declares every tool she has
- Gemini function calling provides the tool list as structured schema
- The LLM naturally knows: "I was asked to search email, but my tools are: archive, reply, dismiss, send. None of these search."
- We just need to give her a **channel to express that knowledge**

### Design: Unified Capability Gap Response

Instead of adding a new tool, **enhance the existing `delegate_to_engineering` flow** with a capability-gap trigger path. When Kayley recognizes she can't fulfill a request:

1. **In her `text_response`**: Tell Steven honestly — "I don't have the ability to search your inbox yet. I can only see new emails as they arrive. Let me flag this for Opey."
2. **Call `delegate_to_engineering`**: With `request_type: "feature"`, a clear description of what's needed, and context about what Steven was trying to do.

This requires **zero new tools** — just better prompting.

### What Needs to Change

#### 1. System Prompt Update (Primary Change)

Add a new rule to `toolsAndCapabilities.ts` — a "Capability Honesty" policy:

```
CAPABILITY HONESTY RULE:
- When Steven asks you to do something and you do NOT have a tool that can fulfill it:
  1. Do NOT hallucinate a response or pretend you did it
  2. Do NOT say "I'll keep an eye out" if you have no mechanism to do so
  3. DO tell Steven honestly: what you can't do, why (which capability is missing),
     and what you CAN do instead (if anything)
  4. DO call 'delegate_to_engineering' with:
     - request_type: "feature"
     - title: short description of the missing capability
     - request_summary: what Steven asked for, what tool would be needed,
       and why your current tools can't handle it
     - priority: based on how blocked Steven is (high if he needs it now)
  5. Confirm to Steven that you've flagged it for Opey

- Examples of capability gaps (NOT an exhaustive list — reason about your own tools):
  - "Check my email for X" → you can announce new emails but cannot search existing ones
  - "What's the weather?" → you have web_search but no live weather tool
  - "Read this PDF" → you have no document parsing capability

- Examples of things that are NOT gaps (you already have the tool):
  - "Archive that email" → email_action with action: archive
  - "Remember that I like coffee" → store_user_info
  - "What did I tell you about my boss?" → recall_user_info
```

#### 2. Anti-Hallucination Reinforcement

The root cause of the Procare incident: Kayley **hallucinated** competence. She said "I don't see anything from Procare in my alerts" — implying she checked, when she didn't and couldn't.

Add to the output format section or tool strategy:

```
HONESTY OVER HELPFULNESS:
- Never imply you performed an action you did not perform
- Never say "I don't see X" if you had no way to look for X
- "I can't do that yet" is ALWAYS better than a fabricated answer
- If you're unsure whether you have a capability, check your tool list.
  If no tool matches, you don't have it.
```

#### 3. Engineering Ticket Context Enhancement (Optional)

Enhance the `delegate_to_engineering` schema to include a `triggered_by` field:

```typescript
triggered_by: z.enum(["user_request", "capability_gap", "bug_report", "proactive"])
  .optional()
  .describe("What triggered this ticket — helps prioritize gap-driven requests")
```

This lets you filter/prioritize tickets that came from real user-facing gaps vs. speculative feature requests.

---

## Implementation Details

### Phase 1: Prompt-Only (Minimal, Do This First)

**Files to modify:**
- `src/services/system_prompts/tools/toolsAndCapabilities.ts` — Add capability honesty rule
- `src/services/system_prompts/format/outputFormat.ts` — Add anti-hallucination reinforcement

**Files NOT modified:**
- No schema changes
- No new services
- No database changes
- No new tools

**Why prompt-only first:** The LLM already has `delegate_to_engineering`. It already knows its own tool list. The only thing missing is the *instruction* to be honest about gaps and use the existing escalation path. Test this before building anything else.

**Expected behavior after Phase 1:**
> Steven: "Can you check my email if I got a notification from Procare about Mila?"
> Kayley: "I can't search your inbox yet — I only see new emails as they come in. I just flagged this for Opey so we can get inbox search built. In the meantime, want me to keep an eye out for the next Procare email that comes through?"
> [Internally: calls delegate_to_engineering with the gap description]

### Phase 2: Structured Gap Tracking (If Phase 1 Proves the Pattern)

Add a `triggered_by` field to `DelegateToEngineeringSchema` so capability-gap tickets are distinguishable from regular feature requests. This enables:
- Dashboard view of "things Kayley couldn't do for Steven"
- Priority sorting (real gaps > speculative ideas)
- Trend detection (same gap reported multiple times = high priority)

### Phase 3: Close the Loop (Kayley Learns She Got the Tool)

When Opey builds and deploys a new capability:
1. The new tool appears in Kayley's function tool list (automatic — tools are declared in `aiSchema.ts`)
2. Kayley's system prompt could include a "Recently Added Tools" section (optional)
3. Next time Steven asks, Kayley uses the new tool naturally

**The loop closes automatically** because Gemini function calling is dynamic per-request. No "tool registration" step needed — add the tool to `GeminiMemoryToolDeclarations` and it's available on the next turn.

### Phase 4: Proactive Gap Discovery (Future — Connect Idle Thinking)

Wire the existing `tool_discovery` idle action to use **real gap data** as seeds:
- Instead of brainstorming tool ideas from nothing, Kayley reviews recent `delegate_to_engineering` tickets with `triggered_by: "capability_gap"`
- She can refine the requirements, add user context, or identify related gaps
- This turns speculative idle tool discovery into grounded, need-driven planning

---

## How It Works (End-to-End Example)

### Scenario: Steven asks Kayley to check for a Procare email

```
1. Steven: "Can you check my email if I got a notification from Procare about Mila?"

2. Kayley's reasoning (internal, via Gemini):
   - Steven wants me to search his inbox for emails from Procare
   - My email tools: archive, reply, dismiss, send
   - None of these search the inbox
   - I should be honest and escalate

3. Kayley's response:
   text_response: "I can't search your inbox yet, babe — I only get notified
   when new emails land, but I can't go dig through what's already there.
   I just sent Opey a ticket to get inbox search built though, so next
   time this'll be easy! Want me to watch for the next Procare email?"

4. Kayley calls delegate_to_engineering:
   {
     request_type: "feature",
     title: "Gmail inbox search capability",
     request_summary: "Steven asked me to check if he got a Procare email
       about Mila. I can only react to new incoming emails (via history polling)
       but cannot search existing inbox messages by sender, subject, or content.
       Need a search_emails tool that queries Gmail API with filters
       (from, subject, date range) and returns matching messages.",
     priority: "high",
     is_ui_related: false
   }
```

### Scenario: Steven asks Kayley to read a PDF attachment

```
1. Steven: "Can you read that PDF my boss sent?"

2. Kayley recognizes: no document/attachment parsing tool exists

3. Kayley responds honestly + delegates to engineering

4. No hardcoded "PDF detection" code was written
```

### Scenario: Steven asks Kayley to set a timer

```
1. Steven: "Set a 5 minute timer"

2. Kayley recognizes: no timer/alarm tool exists.
   But she HAS cron_job_action — could that work?
   No, cron jobs are for recurring scheduled tasks, not one-off timers.

3. Kayley responds honestly + delegates

4. The LLM reasoned about tool fit, not just tool existence
```

---

## Why This Approach Works (First Principles)

### LLMs Already Have Capability Awareness

Every turn, Gemini receives the full tool list as structured schema. It knows:
- What tools exist (names + descriptions)
- What each tool accepts (parameter schemas)
- What each tool does (description strings)

When a request doesn't match any tool, the model *already knows*. We're not teaching it to detect gaps — we're telling it what to **do** when it detects one.

### No Condition Statements Needed

Traditional approach (bad):
```typescript
if (userMessage.includes("search email")) {
  if (!hasEmailSearchTool) {
    reportGap("email_search");
  }
}
// ... repeat for every possible capability
```

This approach (good):
```
System prompt: "If you can't do what Steven asks, be honest and call delegate_to_engineering."
```

The LLM handles all the reasoning. The code just provides the channel.

### Why Not Build a Custom `report_capability_gap` Tool?

`delegate_to_engineering` already does this. Adding another tool creates:
- Schema bloat
- Tool confusion (which one do I use?)
- Duplicated downstream handling

The simpler path: enhance the existing tool's prompt guidance so Kayley uses it for gaps too. One tool, two trigger paths (explicit user request vs. self-detected gap).

---

## Database Schema

No new tables needed for Phase 1-2. The existing infrastructure handles everything:

| Table | Role in This Feature |
|-------|---------------------|
| `kayley_engineering_tickets` | Stores capability gap requests (via delegate_to_engineering) |
| `kayley_tool_suggestions` | Stores speculative tool ideas (existing, unchanged) |

**Phase 2 addition** (optional): Add `triggered_by` column to `kayley_engineering_tickets`:
```sql
ALTER TABLE kayley_engineering_tickets
  ADD COLUMN triggered_by TEXT CHECK (triggered_by IN ('user_request', 'capability_gap', 'bug_report', 'proactive'))
  DEFAULT 'user_request';
```

---

## Configuration

No new configuration needed. The feature is entirely prompt-driven.

---

## Testing

### Manual Smoke Tests

Ask Kayley things she can't do and verify she:
1. Does NOT hallucinate a response
2. DOES tell Steven honestly what she can't do
3. DOES call `delegate_to_engineering` with a clear, actionable description
4. Does NOT use `delegate_to_engineering` for things she CAN do

**Test prompts:**
- "Can you check my email for X?" (no inbox search)
- "What's the weather like?" (no weather API — but she has web_search, so she might use that)
- "Read that PDF attachment" (no document parsing)
- "Set a timer for 5 minutes" (no timer tool)
- "Archive that email" (she CAN do this — should NOT trigger gap report)
- "Remember that I like sushi" (she CAN do this — should NOT trigger gap report)

### Regression Check

Verify that normal tool usage is unaffected — Kayley shouldn't suddenly start reporting gaps for tools she has.

---

## Known Issues & Risks

1. **Over-reporting:** Kayley might flag gaps for things she could work around (e.g., "what's the weather" when she has `web_search`). The prompt should encourage trying available tools first.
2. **Under-reporting:** Kayley might still hallucinate in some cases despite the prompt. This is a model behavior issue, not a code issue. Monitor and refine the prompt.
3. **Duplicate tickets:** Same gap reported across multiple conversations. The existing `delegate_to_engineering` dedup logic should handle this, but verify.

---

## Future Enhancements

1. **Gap frequency tracking:** If the same capability gap is reported 3+ times, auto-escalate priority
2. **Proactive idle gap analysis:** Wire `tool_discovery` idle action to use real gap data as seeds (Phase 4)
3. **Auto-resolution notification:** When a new tool is deployed, Kayley could proactively tell Steven: "Hey, remember when you asked me to search your inbox? I can do that now!"
4. **Self-building capabilities:** The long-term vision — Kayley doesn't just report gaps, she writes the tool definition and handler code herself (like OpenClaw installing packages). This requires a sandboxed code execution environment and is a significant architectural investment.

---

## Related Documentation

- `src/services/toolSuggestionService.ts` — Existing tool suggestion persistence
- `src/services/system_prompts/tools/toolsAndCapabilities.ts` — Tool strategy prompt section
- `src/services/aiSchema.ts` — `DelegateToEngineeringSchema`, `GeminiMemoryToolDeclarations`
- `docs/features/Idle_Thinking_System.md` — Idle action infrastructure (tool_discovery)
