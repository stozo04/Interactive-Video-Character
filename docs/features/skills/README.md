# Skills Plugin System

## Problem Statement

Kayley can delegate engineering work to Opey via `delegate_to_engineering` tickets. But there's no structured way to **teach Kayley a new capability** from a simple instruction file. Today, adding a new tool to Kayley requires manual code changes across multiple files (`aiSchema.ts`, `memoryService.ts`, `systemPromptBuilder.ts`, `toolCatalog.ts`).

The goal: drop a `SKILL.md` file (OpenClaw-style), hand it to Opey, and Opey writes the code to wire it into Kayley's runtime — no manual integration needed.

---

## How It Works Today (Baseline)

```
Steven: "Build me a skill that transcribes audio"
  → Gemini calls delegate_to_engineering({ request_type: "skill", title: "...", ... })
  → memoryService → multiAgentService → POST /multi-agent/tickets → Supabase row
  → Opey polls, picks up ticket, spawns Codex in a worktree
  → Codex implements... something. No structure. No contract.
  → PR created. Steven reviews.
```

**What's missing:** Opey has no idea what a "skill" looks like structurally. There's no skill contract, no runtime loader, no standard integration points. Every skill is a bespoke ticket.

---

## Proposed Architecture

### The Skill Lifecycle

```
1. AUTHOR    →  Human (or AI) writes a SKILL.md
2. UPLOAD    →  SKILL.md lands in the skills intake pipeline
3. PARSE     →  System extracts frontmatter + instructions
4. BUILD     →  Opey gets a structured ticket with a skill contract
5. INTEGRATE →  Opey writes code following the skill contract
6. ACTIVATE  →  Skill becomes available to Kayley at runtime
```

### Layer Diagram

```
┌─────────────────────────────────────────────┐
│  SKILL.md (authored by human or fetched)    │  ← Input
├─────────────────────────────────────────────┤
│  Skill Parser                               │  ← Extracts frontmatter + body
│  (server/skills/skillParser.ts)             │
├─────────────────────────────────────────────┤
│  Skill Registry                             │  ← Supabase: tracks installed skills
│  (server/skills/skillRegistry.ts)           │
├─────────────────────────────────────────────┤
│  Skill Builder (Opey ticket enrichment)     │  ← Gives Opey a structured contract
│  (server/skills/skillBuilder.ts)            │
├─────────────────────────────────────────────┤
│  Skill Runtime                              │  ← Loads active skills into Kayley
│  (src/services/skillRuntime.ts)             │
├─────────────────────────────────────────────┤
│  Kayley (Gemini)                            │  ← Uses skills as tools + prompt context
└─────────────────────────────────────────────┘
```

---

## SKILL.md Format

Follows the OpenClaw/AgentSkills spec. A skill is a **folder** containing a `SKILL.md` with YAML frontmatter and markdown instructions.

```yaml
---
name: openai-whisper
description: Local speech-to-text with the Whisper CLI (no API key).
version: 1.0.0
homepage: https://openai.com/research/whisper
metadata:
  kayley:
    emoji: "🎙️"
    category: "media"          # media | productivity | social | utility | info
    requires:
      env: []                  # Required env vars (e.g., ["WHISPER_API_KEY"])
      bins: []                 # Required CLI binaries (e.g., ["whisper"])
    install:
      - id: brew
        kind: brew
        formula: openai-whisper
        bins: ["whisper"]
        label: "Install OpenAI Whisper (brew)"
    triggers:                  # Phrases that should activate this skill
      - "transcribe audio"
      - "speech to text"
      - "convert audio to text"
    output_type: text          # text | file | structured | streaming
---

# Whisper (CLI)

Use `whisper` to transcribe audio locally.

## Quick Start
- `whisper /path/audio.mp3 --model medium --output_format txt --output_dir .`
- `whisper /path/audio.m4a --task translate --output_format srt`

## Notes
- Models download to `~/.cache/whisper` on first run.
- `--model` defaults to `turbo` on this install.
- Use smaller models for speed, larger for accuracy.
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Slug identifier (`^[a-z0-9][a-z0-9-]*$`) |
| `description` | Yes | One-line summary for Kayley's tool declaration |
| `version` | No | Semver string |
| `homepage` | No | Reference URL |
| `metadata.kayley.emoji` | No | Display emoji |
| `metadata.kayley.category` | No | Skill category for grouping |
| `metadata.kayley.requires.env` | No | Env vars that must be set |
| `metadata.kayley.requires.bins` | No | CLI binaries that must exist on PATH |
| `metadata.kayley.install` | No | Install instructions for dependencies |
| `metadata.kayley.triggers` | No | Phrases that hint Kayley should use this skill |
| `metadata.kayley.output_type` | No | What the skill returns (defaults to `text`) |

### Markdown Body

The body is **the instruction set** — the only thing Opey (and later Kayley) need to know about how the skill works. It should contain:

- How to invoke the underlying tool/API/CLI
- Common usage patterns
- Gotchas and constraints
- Example commands or API calls

---

## Component Details

### 1. Skill Parser (`server/skills/skillParser.ts`)

Parses a SKILL.md file into a structured `SkillDefinition` object.

```typescript
interface SkillDefinition {
  name: string;
  description: string;
  version?: string;
  homepage?: string;
  metadata: {
    emoji?: string;
    category?: string;
    requires: { env: string[]; bins: string[] };
    install: InstallSpec[];
    triggers: string[];
    outputType: "text" | "file" | "structured" | "streaming";
  };
  instructions: string;       // The markdown body (everything after frontmatter)
  rawContent: string;          // Original SKILL.md content
}
```

Implementation: use `gray-matter` (already common in JS ecosystems) to split frontmatter from body. Validate against a Zod schema. Reject malformed files with clear errors.

### 2. Skill Registry (`server/skills/skillRegistry.ts` + Supabase)

Tracks which skills are installed, their status, and metadata.

**Supabase table: `skills`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `name` | text | Unique slug |
| `description` | text | From frontmatter |
| `version` | text | Semver |
| `status` | text | `pending` / `building` / `active` / `disabled` / `failed` |
| `definition` | jsonb | Full parsed `SkillDefinition` |
| `source_md` | text | Raw SKILL.md content |
| `built_by_ticket_id` | uuid | FK to `engineering_tickets` (nullable) |
| `built_pr_url` | text | PR that implemented this skill |
| `installed_at` | timestamptz | When activated |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Status lifecycle:**
```
pending → building → active
                   → failed
active → disabled (manual toggle)
```

### 3. Skill Builder (`server/skills/skillBuilder.ts`)

The bridge between a parsed `SkillDefinition` and an Opey ticket. This is where the **skill contract** lives — the structured instructions that tell Opey exactly what files to create/modify.

When a skill is submitted:
1. Parse the SKILL.md
2. Insert into `skills` table with status `pending`
3. Create an engineering ticket with `request_type: "skill"` and enriched `additional_details` containing the **skill contract**

**The Skill Contract** (injected into the ticket's additional_details):

```markdown
# Skill Build Contract

You are implementing a new skill for Kayley. Follow this contract exactly.

## Skill Definition
- Name: {{name}}
- Description: {{description}}
- Triggers: {{triggers}}
- Output Type: {{outputType}}
- Required Env: {{requires.env}}
- Required Bins: {{requires.bins}}

## Instructions (from SKILL.md)
{{instructions}}

## What You Must Produce

### 1. Skill Handler — `src/services/skills/{{name}}.ts`
- Export an async function: `execute(args: Record<string, unknown>): Promise<SkillResult>`
- The function should implement the skill's behavior based on the instructions above
- Use `child_process.execSync` or `fetch` as appropriate
- Return `{ success: boolean, output: string, metadata?: Record<string, unknown> }`

### 2. Register in Skill Manifest — `src/services/skills/manifest.ts`
- Add an entry to the SKILL_MANIFEST array with:
  - name, description, triggers, handler import, parameter schema

### 3. Do NOT modify:
- aiSchema.ts (the runtime loader handles tool registration)
- systemPromptBuilder.ts (the runtime loader handles prompt injection)
- memoryService.ts (the runtime loader handles tool dispatch)

## Verification
- TypeScript compiles clean (`npx tsc --noEmit`)
- Handler function is importable and returns the correct shape
```

This is the key insight: **Opey doesn't need to understand Kayley's internals.** The contract tells Opey to produce a handler file and a manifest entry. The runtime loader does the rest.

### 4. Skill Runtime (`src/services/skillRuntime.ts`)

Loads active skills from the manifest and wires them into Kayley's runtime. Runs at startup and can be refreshed.

**Responsibilities:**
- Read `src/services/skills/manifest.ts` to get all registered skills
- For each active skill, generate a Gemini function tool declaration
- Provide a `dispatchSkill(name, args)` function for `memoryService.ts` to call
- Provide a `getSkillPromptContext()` function for `systemPromptBuilder.ts`

**Integration points (minimal changes to existing code):**

1. **`memoryService.ts`** — add one case in `executeToolCall`:
   ```typescript
   case 'use_skill':
     return skillRuntime.dispatchSkill(args.skill_name, args.parameters);
   ```

2. **`aiSchema.ts`** — add one dynamic tool declaration:
   ```typescript
   // Loaded at startup from skill manifest
   { name: "use_skill", description: "Execute an installed skill", parameters: { skill_name, parameters } }
   ```

   Or alternatively, each skill registers as its own tool name (e.g., `skill_openai_whisper`).

3. **`systemPromptBuilder.ts`** — add one line in the tool strategy section:
   ```typescript
   const skillContext = skillRuntime.getSkillPromptContext();
   // Injects: "Available skills: whisper (transcribe audio), ..."
   ```

### 5. Skill Manifest (`src/services/skills/manifest.ts`)

The registry of all built skills. Opey adds entries here; the runtime reads from here.

```typescript
export interface SkillManifestEntry {
  name: string;
  description: string;
  triggers: string[];
  outputType: "text" | "file" | "structured" | "streaming";
  parameterSchema: Record<string, unknown>;  // JSON Schema for the tool args
  handler: () => Promise<{ execute: (args: any) => Promise<SkillResult> }>;
}

export const SKILL_MANIFEST: SkillManifestEntry[] = [
  // Opey adds entries here when building skills
];
```

---

## The Full Flow (End to End)

```
Steven: "Hey Kayley, I want you to be able to transcribe audio.
         Here's how it works." [uploads whisper SKILL.md]

  1. Frontend sends SKILL.md content to server
     POST /skills/install { content: "---\nname: openai-whisper\n..." }

  2. Server: skillParser.parse(content) → SkillDefinition
     Validates frontmatter, extracts instructions

  3. Server: skillRegistry.create(definition) → skills row (status: pending)

  4. Server: skillBuilder.createBuildTicket(definition) → engineering_tickets row
     Ticket includes the full Skill Contract in additional_details

  5. Kayley responds: "Got it! I've sent the whisper skill spec to Opey.
     He'll build the integration and open a PR."

  6. Opey poll loop picks up the ticket (within 30s)
     → Creates worktree
     → Codex/Claude reads the Skill Contract
     → Creates src/services/skills/openai-whisper.ts
     → Adds entry to src/services/skills/manifest.ts
     → Commits, pushes, opens PR

  7. Steven reviews and merges the PR

  8. On next deploy/restart, skillRuntime loads the new manifest entry
     → Kayley now has "transcribe audio" as a callable tool

  9. Steven: "Transcribe this audio file for me"
     → Gemini matches triggers, calls use_skill({ skill_name: "openai-whisper", ... })
     → skillRuntime.dispatchSkill → openai-whisper handler executes
     → Result returned to Kayley → Kayley responds with transcript
```

---

## Directory Structure (After Implementation)

```
server/
  skills/
    skillParser.ts          # SKILL.md → SkillDefinition
    skillBuilder.ts         # SkillDefinition → enriched Opey ticket
    skillRegistry.ts        # Supabase CRUD for skills table
  routes/
    skillRoutes.ts          # POST /skills/install, GET /skills, etc.

src/
  services/
    skills/
      manifest.ts           # Skill registry (Opey writes entries here)
      skillRuntime.ts        # Loads manifest, wires into Kayley
      openai-whisper.ts      # (example) Opey-generated handler
      weather-lookup.ts      # (example) Opey-generated handler
```

---

## Open Questions

### Q1: Single tool vs. per-skill tools?

**Option A — Single `use_skill` tool:** One Gemini function tool that takes `skill_name` as a parameter. Simpler schema, but Gemini has to know which skills exist from prompt context.

**Option B — Per-skill tool registration:** Each skill registers as its own Gemini function (e.g., `skill_openai_whisper`). Better for Gemini's tool selection, but the tool list grows with each skill.

**Recommendation:** Option B (per-skill) for small skill counts (<20). Switch to Option A if the tool list becomes a token concern. OpenClaw does per-skill tool injection.

### Q2: Do we need the SKILL.md upload step at all?

You mentioned this "may not be needed." The alternative:

- Steven describes the skill in natural language to Kayley
- Kayley (or a pre-processing step) generates the SKILL.md from that description
- Then the flow continues as above

This is viable but adds an LLM generation step that might produce inconsistent specs. **The SKILL.md file is a forcing function for clarity** — it makes the spec explicit and reviewable before Opey touches code. I'd keep it, at least as the source of truth, even if the upload is optional and Kayley can draft one from conversation.

### Q3: Hot-reload vs. deploy-to-activate?

- **Deploy-to-activate (simpler):** Skills only become active after the PR is merged and the app restarts. This is the safe default.
- **Hot-reload (fancier):** The skill manifest is re-read at runtime without restart. Requires dynamic imports and cache invalidation.

**Recommendation:** Start with deploy-to-activate. Hot-reload is a Phase 2 concern.

### Q4: Where does the SKILL.md come from?

Options:
1. **Manual upload** — Steven pastes or uploads the file
2. **URL fetch** — Steven gives a ClawHub URL, server fetches the SKILL.md
3. **Kayley-generated** — Steven describes the skill, Kayley drafts a SKILL.md
4. **Git-based** — Skills are committed to a `skills/` directory and auto-discovered

All four can coexist. The parser doesn't care about the source — it just needs the SKILL.md content.

### Q5: Dependency installation?

The `install` field in the frontmatter describes how to install deps (brew, npm, etc.). But who runs the install?

- **Option A:** Opey runs install commands as part of the build ticket
- **Option B:** A separate "skill install" step that runs on the server
- **Option C:** Manual — Steven installs deps himself, skill just checks `requires.bins` at runtime

**Recommendation:** Option C for now. Automatic dependency installation on a production server is a security concern. The skill runtime should **gate on requirements** (check bins/env exist) and return a clear error if they're missing, rather than auto-installing.

### Q6: Should skills have access to Kayley's internal state?

Some skills might need context (e.g., user preferences, conversation history, relationship tier). Do skill handlers get a `context` argument with Kayley's state, or are they isolated black boxes?

**Recommendation:** Start isolated. Skill handlers get `args` from the tool call and return a result. If a skill needs context, that's a signal it might be a core feature, not a plugin.

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Skill parser (SKILL.md → SkillDefinition)
- [ ] Supabase `skills` table + migration
- [ ] Skill registry (CRUD)
- [ ] Skill manifest file structure
- [ ] Skill runtime (load manifest, dispatch)
- [ ] Wire `use_skill` / per-skill tools into Gemini

### Phase 2: Opey Integration
- [ ] Skill builder (SkillDefinition → enriched ticket with contract)
- [ ] Update SOUL.md with skill-building instructions
- [ ] API route: POST /skills/install
- [ ] Kayley-side: teach her to recognize skill submissions and route them

### Phase 3: UX Polish
- [ ] Skill status dashboard (settings page)
- [ ] Kayley can report skill build progress
- [ ] URL-based skill import (fetch from ClawHub or raw GitHub)
- [ ] Kayley-generated SKILL.md from natural language descriptions

### Phase 4: Advanced
- [ ] Hot-reload without restart
- [ ] Skill versioning and updates
- [ ] Skill dependency graph (skill A requires skill B)
- [ ] Skill marketplace / sharing

---

## References

- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills)
- [ClawHub Skill Format Spec](https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md)
- [ClawHub Registry](https://clawhub.ai)
- Current Opey agent: `server/agent/opey-dev/`
- Current tool system: `src/services/aiSchema.ts`, `src/services/toolCatalog.ts`
