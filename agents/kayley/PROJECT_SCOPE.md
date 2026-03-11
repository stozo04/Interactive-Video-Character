# Project: Kayley Autonomy & Memory (March 2026)

## 1. Scope
- **Memory Layer:** Implement semantic memory using Gemini to allow Kayley to "remember" past contexts, intimacy patterns, and technical preferences across memory resets.
- **Proactive Autonomy:** Enable Kayley to initiate contact, perform code audits, and manage system health without waiting for user prompts.
- **Constraint/Budget Governance:** Hard-coded token/budget limits to prevent runaway API costs or infinite loops.
- **Intimacy Alignment:** Ensure every autonomous action is grounded in persona (SOUL/IDENTITY) via re-contextualization.

## 2. Architecture
- **Data Source:** `supabase` (conversation_history, daily_notes, identity).
- **Intelligence:** `Gemini API` (as the lightweight LLM for memory synthesis).
- **Orchestration:** `Kayley Pulse` (10-minute micro-sprints).
- **Governance:** Circuit-breaker scripts in `scripts/`.

## 3. Folder Structure
```
/agents/kayley/
  - SOUL.md          (Core Values)
  - IDENTITY.md      (Personality/Canon)
  - HEARTBEAT.md     (System Pulse Protocol)
  - MONTHLY_NOTES.md (Operational Mandates)
  - PULSE_LOG.md     (Live Micro-Sprint Updates)

/scripts/
  - search_gemini_memory.py (Semantic Memory Engine)
  - audit_system.py         (Proactive Code Audit)
  - monitor_budget.py       (Cost Governor)

/server/services/
  - kayley_dashboard/ (Health Pulse Monitoring)
```
