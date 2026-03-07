# Claude-Code-MCP Feasibility Report for Opey Dev

**Date:** 2026-03-07  
**Project:** `Interactive-Video-Character`  
**Authoring context:** local repo audit + upstream source audit

---

## 1) Executive Decision

`claude-code-mcp` is **not a better full replacement** for your current `server/agent/opey-dev` system.

It is a good tool in a different layer of the stack:

- Good at: exposing Claude Code as an MCP tool for an MCP-capable host.
- Not good at (by itself): ticket queueing, branch lifecycle, PR creation, clarification loops, and Opey-style self-healing.

### Final verdict

- **Do not remove your Opey implementation** for this.
- If desired, add `claude-code-mcp` as an **optional execution backend** behind a feature flag for specific workflows.

---

## 2) Scope and Research Method

I evaluated both:

1. **Your current implementation** in this repo.
2. **Upstream `steipete/claude-code-mcp`** (README + code + docs + changelog).

### Local files inspected

- `server/index.ts`
- `server/README.md`
- `server/routes/multiAgentRoutes.ts`
- `server/routes/workspaceAgentRoutes.ts`
- `server/services/engineeringTicketBridge.ts`
- `src/services/engineeringTicketWatcher.ts`
- `server/agent/opey-dev/main.ts`
- `server/agent/opey-dev/orchestrator.ts`
- `server/agent/opey-dev/orchestrator-openai.ts`
- `server/agent/opey-dev/branchManager.ts`
- `server/agent/opey-dev/githubOps.ts`
- `server/agent/opey-dev/ticketStore.ts`
- `server/agent/opey-dev/skillLoader.ts`
- `server/agent/opey-dev/SOUL.md`
- `server/agent/opey-dev/types.ts`

### External primary sources inspected

- `https://github.com/steipete/claude-code-mcp`
- `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/README.md`
- `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/src/server.ts`
- `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/package.json`
- `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/docs/local_install.md`
- `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/docs/e2e-testing.md`
- `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/CHANGELOG.md`
- OpenAI Codex docs pages (MCP usage references)
- Anthropic Claude Code docs pages (MCP configuration references)

---

## 3) Current Opey Architecture (What You Already Have)

Your Opey system is not just a CLI wrapper. It is a full autonomous SDLC pipeline.

### 3.1 Runtime topology

- `server/index.ts` boots the HTTP server and starts `startOpeyDev(...)`.
- Opey polls Supabase `engineering_tickets` and works tickets end-to-end.
- `multi-agent` routes create/manage tickets and clarification responses.
- Bridge services notify channels when ticket status changes.

### 3.2 Core flow in production

1. Ticket enters with status `created`.
2. Opey claims it (`implementing`).
3. Opey creates isolated ticket branch (`opey-dev/<ticketId>`).
4. Opey executes backend (`claude` or `openai`) via orchestrator.
5. Opey emits step events into `engineering_ticket_events`.
6. If no commits, Opey enters clarification loop (`needs_clarification`) up to max rounds.
7. If commits exist, Opey pushes and opens PR, then marks `completed`.
8. On infra failures, Opey can self-heal via meta-run and retry.

### 3.3 What is strong today

- Built-in ticket queueing and persistence.
- Built-in DB lifecycle/status modeling.
- Built-in branch + PR automation.
- Clarification loop integrated with frontend + messaging bridges.
- Event audit trail in Supabase.
- Infra self-healing behavior for launch/runtime failures.
- Multi-provider strategy (Claude path + Codex path).

### 3.4 Existing repo findings worth noting

- `main.ts` currently hardcodes `ORCHESTRATOR_BACKEND = "openai"` even though docs describe env-based backend selection.
- README and some comments mention worktree isolation, while current `BranchManager` is branch-on-root behavior (no separate physical worktree path).

These are internal consistency issues, but they do not invalidate the system’s core strengths.

---

## 4) What `claude-code-mcp` Actually Provides (As Implemented)

From upstream code (`src/server.ts`), this package currently does the following:

- Exposes one MCP tool: `claude_code`.
- Tool args:
  - `prompt` (required string)
  - `workFolder` (optional, relative to server start cwd)
- On call:
  - Spawns Claude CLI command.
  - Default command name from env `CLAUDE_CLI_NAME` (fallback: `claude`).
  - Uses args pattern: `--dangerously-skip-permissions -p <prompt>`.
  - Optional allowed-tools arg from env `CLAUDE_CLI_TOOLS_DEFAULT`.
  - Optional timeout from env `CLAUDE_CLI_TIMEOUT` (default 30 minutes).
- Returns stdout string or throws with stderr/error.

### Important capability boundaries

`claude-code-mcp` does **not** provide:

- Ticket table polling
- Status transitions in your DB
- Event persistence to `engineering_ticket_events`
- Clarification loop handling
- Branch and PR lifecycle
- Opey self-heal strategy
- Codex backend parity

It is a tool adapter, not an autonomous engineering queue system.

---

## 5) Critical Fit Gap: Why Full Replacement Is Not Better

### 5.1 Architectural mismatch

Your Opey runtime is orchestrator + process policy + git automation + ticket lifecycle.  
`claude-code-mcp` is a single MCP tool endpoint around Claude CLI.

Replacing Opey with only this MCP server would mean rebuilding most of Opey’s value anyway.

### 5.2 Windows prompt-length risk (high severity)

Your orchestrators explicitly solved Windows `ENAMETOOLONG` by writing full prompts to temp files and passing a short boot arg.  
`claude-code-mcp` passes prompt directly via `-p <prompt>`.

Given your long prompt assembly model (`SOUL.md` + concatenated lessons + ticket details), this reintroduces a known Windows failure class.

### 5.3 Provider lock-in regression

Current Opey supports Claude and Codex backends.  
`claude-code-mcp` is Claude-only by design.

### 5.4 Operational observability regression

Today you log lifecycle and step events to Supabase tables and bridges.  
`claude-code-mcp` returns command output but does not model your ticket/event lifecycle.

### 5.5 Security/policy regression risk

The server invocation uses `--dangerously-skip-permissions` when running Claude CLI.  
In your system, permission posture is constrained by your branching, ticket flow, and surrounding controls. Full replacement would collapse those controls unless rebuilt.

---

## 6) Comparison Matrix

| Capability | Current Opey | `claude-code-mcp` alone | Better? |
|---|---|---|---|
| Queue from `engineering_tickets` | Yes | No | Opey |
| Status lifecycle + clarification loop | Yes | No | Opey |
| Branch management + PR creation | Yes | No | Opey |
| Self-heal restart loop | Yes | No | Opey |
| Multi-provider (Codex + Claude) | Yes | No (Claude only) | Opey |
| MCP interoperability | No (direct CLI) | Yes | MCP |
| Simplicity for ad-hoc tool call | Medium | High | MCP |
| Fit for your autonomous ticket engine | High | Low | Opey |

---

## 7) Recommendation

### Recommended path (pragmatic)

Keep Opey architecture. If you want to test MCP benefits, add `claude-code-mcp` as a **new optional executor backend** and keep current direct backends as primary/fallback.

In short:

- Keep: ticket store, status model, branch/PR flow, clarification loop, bridges.
- Add: optional MCP-based executor for Claude.
- Do not delete direct executor paths until MCP path proves equal or better under real ticket load.

---

## 8) Implementation Plan (If You Want MCP Added Safely)

## 8.1 Phase 0 - Add as optional backend (no deletion)

1. Add new backend value:
   - `openai` (existing)
   - `claude` (existing)
   - `claude_mcp` (new)

2. Add `server/agent/opey-dev/orchestrator-claude-mcp.ts`:
   - Implement same `runOpeyLoop(ticket, workPath, log, onEvent)` signature.
   - Create MCP client connection to `claude-code-mcp` server process.
   - Call tool `claude_code` with prompt + work folder.

3. Keep existing prompt construction + temp-file boot prompt strategy:
   - Do **not** send giant prompt directly if avoidable.
   - Prefer short prompt that points to temp file path, mirroring your proven Windows-safe strategy.

4. Wire backend selection in `main.ts` to env var:
   - Use `process.env.OPEY_BACKEND` with default fallback.
   - Keep current direct backends available.

5. Add timeout + fallback policy:
   - If MCP invocation fails, optionally fallback to direct `orchestrator.ts` for same ticket.

6. Preserve all existing event/status semantics:
   - `implementation_started`, `*_step`, `implementation_completed`, `implementation_failed`.

## 8.2 Phase 1 - Harden and validate

Run staged validation with production-like tickets:

- Short tickets
- Long prompt tickets (high lessons + detail payload)
- Clarification cases
- PR creation path
- Infra failure path

Success gate before broader rollout:

- No increase in failed-ticket rate
- No increase in mean turnaround
- No regression in event trail completeness

## 8.3 Phase 2 - Decide deletion

Only after stable production behavior:

- Option A: Keep `claude_mcp` as optional forever (recommended).
- Option B: Remove direct Claude executor if MCP is demonstrably superior.
- Option C: Keep Codex direct path regardless unless equivalent MCP strategy exists and is validated.

---

## 9) If You Still Want Full Replacement: What You Would Need to Rebuild

If you remove your implementation and rely on `claude-code-mcp`, you still must recreate:

- Ticket queue polling
- Status and lifecycle transitions
- Clarification handoff contract
- Branching + commit + push + PR
- Event logging + channel bridge notifications
- Self-heal and restart policy
- Multi-provider behavior (or explicitly accept loss)

That is essentially re-implementing most of Opey around MCP.

So a full replacement is high-risk/high-effort with low net gain for your current architecture.

---

## 10) Risks and Edge Cases to Track (Any MCP Adoption)

- Windows command-line length (`ENAMETOOLONG`) risk if long prompt is passed directly.
- Claude binary path portability across machines (`CLAUDE_CLI_NAME`/path differences).
- Long-running tasks hitting timeout defaults.
- Potential divergence between README/docs and runtime env var names.
- Security posture when using dangerous bypass flags.

---

## 11) Final Answer to Your Question

You were absolutely right to question this after the `gogcli` success.  
`gogcli` worked great because it replaced a narrow integration layer cleanly.

`claude-code-mcp` is not the same category of replacement for Opey:

- It can enhance your system as an adapter.
- It is not a drop-in superior replacement for the autonomous Opey stack you already have.

**Best next move:** add it as an optional backend and compare with real ticket telemetry before removing anything.

---

## 12) Source Links

- Upstream repo: `https://github.com/steipete/claude-code-mcp`
- Upstream README: `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/README.md`
- Upstream server implementation: `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/src/server.ts`
- Upstream local install doc: `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/docs/local_install.md`
- Upstream changelog: `https://raw.githubusercontent.com/steipete/claude-code-mcp/main/CHANGELOG.md`
- Anthropic Claude Code docs: `https://docs.anthropic.com/en/docs/claude-code/mcp`
- OpenAI Codex MCP docs entry points: `https://developers.openai.com/codex/mcp/`

