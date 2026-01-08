<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1LmtG-2ZBmNS1apPZ-Ac80AgXcHAPEB6t

## Run Locally

**Prerequisites:**  Node.js and a Supabase project


1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory with the following values:
   ```env
   # Supabase Configuration
   VITE_SUPABASE_URL=your-supabase-url
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   
   # Google OAuth (Optional - for Gmail integration)
   VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
   ```

3. Run the app:
   ```bash
   npm run dev
   ```

### Google OAuth Setup (Required)

⚠️ **Authentication is now required** - Users must sign in with Google to access the app.

To enable authentication:

1. Follow the [Google OAuth Setup Guide](docs/GOOGLE_OAUTH_SETUP.md)
2. Add your Google Client ID to the `.env` file
3. Users will see a login page when opening the app

**Features:**
- Standalone OAuth flow (no backend required)
- Automatic token refresh
- Secure session management
- Professional login page
- Session persistence across page reloads
- Gmail integration (read email metadata)

**Important:** Without configuring the Google Client ID, users cannot access the application.

See [docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md) for detailed setup instructions.

## Project Structure

```
/
├─ docs/                  # Planning guides, relationship system notes, setup walkthroughs
├─ src/
│  ├─ App.tsx             # Root application component
│  ├─ main.tsx            # Vite entry point
│  ├─ components/         # UI building blocks (chat panel, selectors, media players, etc.)
│  ├─ services/           # Business logic (AI providers, state, prompts)
│  │  ├─ promptUtils.ts   # Barrel file re-exporting from system_prompts/
│  │  └─ system_prompts/  # 🆕 Modular system prompt architecture
│  │     ├─ builders/     # Main prompt assembly (buildSystemPrompt, etc.)
│  │     ├─ core/         # Identity, anti-assistant, opinions
│  │     ├─ behavior/     # Behavioral patterns (uncertainty, friction, etc.)
│  │     ├─ relationship/ # Tier behavior, dimension effects
│  │     ├─ context/      # Dynamic context (message analysis, style)
│  │     ├─ features/     # Feature rules (selfies, etc.)
│  │     ├─ soul/         # "Alive" components (mood, threads)
│  │     ├─ tools/        # Tool instructions
│  │     └─ format/       # Output format, JSON schema
│  └─ domain/
│     ├─ characters/      # Character-specific domain models (e.g., Kayley profile scaffold)
│     └─ relationships/   # Relationship insight schemas and helpers
├─ supabase/migrations/   # SQL migrations for tables, relationships, and insights
├─ index.html             # Vite HTML template (loads src/main.tsx)
└─ vite.config.ts         # Vite config with @ alias pointing to src/
```

## Claude Code Sub-Agents

This project includes **9 specialized sub-agents** for Claude Code that provide domain-specific expertise:

| Agent | Domain | Use For |
|-------|--------|---------|
| `prompt-architect` | System prompts | Character behavior, output format, prompt sections |
| `chat-engine-specialist` | AI providers | Response latency, new providers, tool calling |
| `intent-analyst` | Intent detection | Tone detection, mood knobs, new intent types |
| `state-manager` | Supabase/caching | Database tables, cache strategy, queries |
| `relationship-dynamics` | Relationships | Tier logic, milestones, pattern detection |
| `presence-proactivity` | Proactive behavior | Idle breaker, open loops, callbacks |
| `memory-knowledge` | Memory systems | Fact storage, semantic search, embeddings |
| `external-integrations` | External APIs | OAuth, Gmail, Calendar, TTS |
| `test-engineer` | Testing | Writing tests, coverage, fixing failures |

**Usage:**
```bash
# View available agents
/agents

# Explicit invocation
> Use the prompt-architect to add a new behavior section

# Automatic delegation (just ask naturally)
> I want to optimize response latency
  → Auto-delegates to chat-engine-specialist
```

Sub-agents are defined in `.claude/agents/` and can be customized per project.

## Documentation

Key developer documentation in the `docs/` folder:

| Document | Purpose |
|----------|---------|
| **[System Prompt Guidelines](docs/System_Prompt_Guidelines.md)** | ⭐ **Required reading** before modifying the AI's system prompt. Covers token efficiency, conditional inclusion patterns, and testing requirements. |
| [Semantic Intent Detection](docs/Semantic_Intent_Detection.md) | LLM-based intent detection system. How messages are analyzed for mood, tone, topics, and relationship signals. |
| [Spontaneity Integration Guide](docs/Spontaneity_Integration_Guide.md) | Spontaneity system architecture, usage, and integration guide. |
| [Almost Moments Implementation](docs/implementation/03_Almost_Moments.md) | Guide for Kayley's "unsaid feelings" system and prompt integration. |
| [Reflection & Idle Thoughts](docs/Reflection_and_Idle_Thoughts.md) | Post-session reflection and idle thought generation during user absence. |
| [System Prompt Plan](docs/System_Prompt_Plan.md) | Original optimization plan with implementation details and lessons learned. |
| [Google OAuth Setup](docs/GOOGLE_OAUTH_SETUP.md) | Step-by-step guide for configuring Google authentication. |

## Architecture & State Management

### Fast Router Architecture

The app uses a "Fast Router" pattern that maintains sub-2-second response times despite complex database operations:

```
User Message
    ↓
┌─────────────────────────────────────┐
│  PARALLEL EXECUTION (Fast Path)     │
├─────────────────────────────────────┤
│  • Intent Detection: ~1.9s         │
│  • Main Chat: ~1.8s                 │
│  • Database Writes: ~150-300ms      │
│    (Background, non-blocking)       │
└─────────────────────────────────────┘
    ↓
Response in <2 seconds
```

**Key Principle:** Database operations happen in parallel or background, never blocking the user's response.

### State Management (Supabase Migration)

All character state is now persisted in Supabase, replacing localStorage for cloud persistence:

**State Tables:**
- `mood_states` - Daily energy, social battery, internal processing flags
- `emotional_momentum` - Current mood level, interaction streaks, genuine moment tracking
- `ongoing_threads` - Kayley's "mental weather" (3-5 things she's thinking about)
- `intimacy_states` - Vulnerability exchange tracking, recent tone modifiers
- `kayley_unsaid_feelings` - Almost moments: Unspoken feelings building over time
- `kayley_almost_moment_log` - Tracks when almost moments occur in conversation

**Key Services:**
- `src/services/stateService.ts` - Core Supabase operations (CRUD for all state)
- `src/services/moodKnobs.ts` - Calculates behavior parameters from state
- `src/services/ongoingThreads.ts` - Manages mental threads with decay/cleanup
- `src/services/relationshipService.ts` - Relationship metrics and intimacy state
- `src/services/almostMoments/` - Almost moments system: Unspoken feelings that build over time

**Unified State Fetch Optimization:**
Instead of 3-4 separate database calls, use the unified RPC function:

```typescript
// ❌ OLD: Multiple network roundtrips
const mood = await getMoodState(userId);
const momentum = await getEmotionalMomentum(userId);
const threads = await getOngoingThreads(userId);
const intimacy = await getIntimacyState(userId);

// ✅ NEW: Single RPC call
const context = await getFullCharacterContext(userId);
// Returns: { mood_state, emotional_momentum, ongoing_threads, intimacy_state }
```

**Migration:** Run `supabase/migrations/create_unified_state_fetch.sql` to create the RPC function.

### Caching Strategy

**Important:** Caching is for PERFORMANCE only, not correctness. Supabase is the single source of truth.

- **Cache TTL:** 30 seconds (reduced from 60s for single-user prototype)
- **Cache Invalidation:** Automatically cleared on writes
- **State Drift Risk:** Multiple tabs or serverless scaling can cause cache inconsistencies
- **Best Practice:** Trust Supabase for correctness. Only use cache if read volume is extremely high.

**Cache Locations:**
- `ongoingThreads.ts` - Threads cache (30s TTL)
- `moodKnobs.ts` - Mood state & momentum cache (30s TTL)
- `relationshipService.ts` - Intimacy state cache (30s TTL)

### Race Condition Protection

State updates use optimistic concurrency control to prevent data loss from rapid consecutive messages:

```typescript
// Optional: Pass expectedUpdatedAt to detect race conditions
await saveEmotionalMomentum(userId, momentum, expectedUpdatedAt);

// If updated_at changed since fetch, logs warning:
// "Race condition detected: updated_at mismatch"
```

**Current Implementation:**
- ✅ Detection: Logs warnings when race conditions occur
- ✅ Graceful Degradation: Proceeds with save (acceptable for single-user prototype)
- 🔄 Future Enhancement: For production, implement retry logic with fresh data fetch

**Affected Functions:**
- `saveEmotionalMomentum()` - Optional `expectedUpdatedAt` parameter
- `saveIntimacyState()` - Optional `expectedUpdatedAt` parameter

### Intent Calculation Optimization

The system uses a unified intent detection system to avoid redundant LLM calls:

```typescript
// BaseAIService.ts calculates intent ONCE
const preCalculatedIntent = await detectFullIntentLLMCached(message, context);

// Then passes it to messageAnalyzer (no re-calculation)
analyzeUserMessageBackground(userId, message, count, context, preCalculatedIntent);
```

**Key Functions:**
- `detectFullIntentLLMCached()` - Single LLM call returns: tone, topics, genuine moments, open loops, relationship signals
- `analyzeUserMessageBackground()` - Uses pre-calculated intent if provided, otherwise calculates

**Performance:** Reduces from 5 separate LLM calls to 1 unified call (~2s → ~1.9s).

### Timezone Handling

Calendar events are formatted using the user's timezone (not server timezone):

```typescript
// buildSystemPrompt accepts optional userTimeZone parameter
const prompt = await buildSystemPrompt(
  character,
  relationship,
  upcomingEvents,
  characterContext,
  tasks,
  relationshipSignals,
  toneIntent,
  fullIntent,
  userId,
  userTimeZone // Defaults to 'America/Chicago' if not provided
);
```

**Implementation:** Calendar event formatting in `system_prompts/builders/systemPromptBuilder.ts` uses `timeZone` option in `toLocaleString()`.

### Spontaneity System

The Spontaneity System makes Kayley feel alive by enabling spontaneous behaviors - sharing things, making jokes, forming associations, and surprising the user.

**Core Components:**
- `src/services/spontaneity/spontaneityTracker.ts` - Tracks conversation state and probabilities
- `src/services/spontaneity/visualStateMapper.ts` - Maps emotional states to video manifests
- `src/services/spontaneity/sessionReflection.ts` - Post-conversation synthesis
- `src/services/spontaneity/idleThoughts.ts` - Dream/thought generation during absence

**Key Features:**
- **Probability-based spontaneity** (10-40% based on relationship, energy, conversation length)
- **Selfie spontaneity** (2-15% for friend+ tiers, with 24-hour cooldown)
- **Visual-emotional bridge** - Video manifests change based on emotional state
- **Independent reflection** - Kayley "thinks" after conversations and has things to share

**Database Tables:**
- `kayley_pending_shares` - Things Kayley wants to share
- `spontaneous_selfie_history` - Selfie cooldown tracking
- `session_reflections` - Post-session synthesis
- `idle_thoughts` - Thoughts during user absence
- `visual_state_mapping` - Emotional state to video manifest mapping

**Usage:**
```typescript
import { integrateSpontaneity } from '@/services/spontaneity';

const spontaneity = await integrateSpontaneity(
  userId,
  conversationalMood,
  moodKnobs,
  relationshipTier,
  currentTopics,
  userInterests
);

// Returns: { promptSection, humorGuidance, selfiePrompt, suggestedAssociation, suggestedSelfie }
```

See [Spontaneity Integration Guide](docs/Spontaneity_Integration_Guide.md) for detailed usage.

### Almost Moments System

The Almost Moments System tracks "unsaid feelings" and injects subtle, withheld expressions into the prompt when relationship and warmth allow it.

**Core Components:**
- `src/services/almostMoments/almostMomentsService.ts` - CRUD + trigger logic for unsaid feelings
- `src/services/almostMoments/almostMomentsPromptBuilder.ts` - Prompt section builder (deterministic)
- `src/services/almostMoments/expressionGenerator.ts` - Stage-appropriate expressions
- `src/services/almostMoments/integrate.ts` - Prompt integration entry point

**Database Tables:**
- `kayley_unsaid_feelings` - Active unspoken feelings per user
- `kayley_almost_moment_log` - Log of "almost said it" moments

**Usage (prompt integration):**
```typescript
import { integrateAlmostMoments } from "@/services/almostMoments";

const almostMoments = await integrateAlmostMoments(userId, relationship, {
  conversationDepth: "deep",
  recentSweetMoment: true,
  vulnerabilityExchangeActive: false
});

// Use almostMoments.promptSection in buildSystemPrompt
```

### Working with State: Best Practices

**1. Always use async functions:**
```typescript
// ✅ Correct
const moodKnobs = await getMoodKnobsAsync(userId);
const threads = await getOngoingThreadsAsync(userId);

// ❌ Avoid (sync fallbacks exist for backwards compatibility only)
const moodKnobs = getMoodKnobs(userId);
```

**2. Use unified fetch when possible:**
```typescript
// ✅ Best: Single RPC call
const context = await getFullCharacterContext(userId);

// ✅ Good: Individual calls (if you only need one piece)
const mood = await getMoodStateAsync(userId);
```

**3. Cache is automatic:**
- No need to manually manage cache
- Cache invalidates on writes
- Supabase is always source of truth

**4. State updates are non-blocking:**
- Saves happen in background after response generation
- User sees response in <2s even with complex state updates

**5. Race conditions:**
- For single-user: Current implementation is fine (warnings logged)
- For production: Implement retry logic with `expectedUpdatedAt` parameter

### Developer Workflow

When working on AI behavior:

1. **Modifying the system prompt?** → Read [System Prompt Guidelines](docs/System_Prompt_Guidelines.md) first
   - Find the right file in `src/services/system_prompts/` (folder names guide you)
   - Run `npm test -- --run -t "snapshot"` to see what changed
2. **Adding intent detection?** → See [Semantic Intent Detection](docs/Semantic_Intent_Detection.md)
3. **Modifying state management?** → See [Architecture & State Management](#architecture--state-management) section above
4. **Running tests:** `npm test -- --run` (1000+ tests should pass)

### Adding New Features

**State Management:**
- Add new state tables in `supabase/migrations/`
- Create service functions in `src/services/stateService.ts`
- Use unified fetch pattern if fetching multiple state slices
- Add caching only if read volume is extremely high

**AI Behavior (System Prompt):**
- The system prompt is modular - find the right file in `src/services/system_prompts/`
- **Identity changes:** `system_prompts/core/`
- **Behavioral changes:** `system_prompts/behavior/`
- **Relationship-dependent:** `system_prompts/relationship/`
- **New features:** Create a new file, export from folder's `index.ts`, wire into `builders/systemPromptBuilder.ts`
- **Testing:** Run `npm test -- --run -t "snapshot"` to see changes
- See [System Prompt Guidelines](docs/System_Prompt_Guidelines.md) for detailed guide

**Intent Detection:**
- Update `src/services/intentService.ts` for new intent types
- Test with `npm test -- --run`

**Performance:**
- Keep database operations parallel or background
- Use unified RPC functions for multiple fetches
- Monitor response times (target: <2s)

## Supabase Schema Setup

1. Create three storage buckets:
   - `character-videos` – stores the character idle video files
   - `character-action-videos` – stores short clips for each character action
   - `video-cache` – caches legacy generated assets (optional)
2. Create a table named `characters` with the following columns:
   - `id` (text, primary key)
   - `image_base64` (text)
   - `image_mime_type` (text)
   - `image_file_name` (text, nullable)
   - `idle_video_path` (text)
   ```sql
   create table public.characters (
     id text primary key,
     image_base64 text not null,
     image_mime_type text not null,
     image_file_name text,
     idle_video_path text not null
   );
   ```
3. Create a table named `character_actions` to describe each saved action:
   ```sql
   create table public.character_actions (
     id text primary key,
     character_id text not null references public.characters(id) on delete cascade,
     action_key text unique,
     display_name text,
     video_path text not null,
     command_phrases text[],
     sort_order int,
     created_at timestamptz default now()
   );
   ```

Ensure the client that uses the anon key has `select`, `insert`, `update`, and `delete` privileges on the `characters` table and `read`/`write` access to both storage buckets.

### Populating Action Videos

1. Upload each action clip to the `character-action-videos` bucket. Recommended path format:
   ```
   <character_id>/actions/<action_id>.webm
   ```
2. Insert a row into `character_actions` for every action, setting `video_path` to the object path created above and `command_phrases` to the list of trigger phrases. Example:
   ```sql
   insert into public.character_actions (
     id,
     character_id,
     action_key,
     display_name,
     video_path,
     command_phrases,
     sort_order
   )
   values (
     'wave',
     'hero-123',
     'wave',
     'Wave',
     'hero-123/actions/wave.webm',
     array['wave', 'wave to the camera'],
     1
   );
   ```

Once the table rows and storage objects are in place, the app will automatically load the actions and make them available from the in-app Action Manager.
