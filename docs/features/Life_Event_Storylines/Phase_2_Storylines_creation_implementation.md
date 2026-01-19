## Phase 2: Idle Suggestions with Direct Injection

### Overview

**Goal:** Enable autonomous storyline suggestions when user is away, surfaced naturally via direct prompt injection.

**Scope:** ~200 lines of new code, 1 database table, 3 files modified

**Timeline:** 1-2 days

**Prerequisites:** Phase 1 (Phase_1_Storylines_Creation_Implementation.md) complete and validated

### Implementation Steps

#### Step 2.1: Database Migration - Pending Suggestions

**File:** `supabase/migrations/20260118_create_storyline_pending_suggestions.sql`

```sql
-- Table for storing idle-generated storyline suggestions
CREATE TABLE storyline_pending_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Suggestion content
  category TEXT NOT NULL CHECK (category IN ('work', 'personal', 'family', 'social', 'creative')),
  theme TEXT NOT NULL,          -- "learning guitar", "trip planning"
  reasoning TEXT NOT NULL,       -- Why this matters to Kayley now

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Surfacing tracking
  surfaced BOOLEAN NOT NULL DEFAULT FALSE,
  surfaced_at TIMESTAMPTZ,

  -- Outcome tracking
  was_created BOOLEAN NOT NULL DEFAULT FALSE,    -- Did it become a storyline?
  storyline_id UUID REFERENCES life_storylines(id),  -- If created
  rejected_reason TEXT  -- If rejected: 'cooldown', 'duplicate', 'category_blocked', 'user_ignored', 'expired'
);

-- Indexes
CREATE INDEX idx_pending_suggestions_active ON storyline_pending_suggestions(created_at DESC)
  WHERE surfaced = FALSE AND expires_at > NOW();

CREATE INDEX idx_pending_suggestions_category ON storyline_pending_suggestions(category);
CREATE INDEX idx_pending_suggestions_expires ON storyline_pending_suggestions(expires_at);

-- Comments
COMMENT ON TABLE storyline_pending_suggestions IS
  'Stores storyline suggestions generated during user absence. Max 1 active at a time. Expire after 24 hours.';

COMMENT ON COLUMN storyline_pending_suggestions.theme IS
  'Short description of the storyline idea, e.g., "learning guitar"';

COMMENT ON COLUMN storyline_pending_suggestions.reasoning IS
  'LLM-generated explanation of why this storyline makes sense for Kayley now';
```

**DO NOT APPLY YET** - User will apply manually after review.

---

#### Step 2.2: Create Idle Service

**File:** `src/services/storylineIdleService.ts` (NEW FILE)

```typescript
/**
 * Storyline Idle Service - Clean v2
 *
 * Purpose-built service for generating storyline suggestions during user absence.
 * No threads, no complexity - just LLM-driven suggestions with direct prompt injection.
 *
 * Flow:
 * 1. Detect user absence (≥30 minutes, using conversation_history.created_at)
 * 2. Generate ONE storyline suggestion via LLM
 * 3. Store in storyline_pending_suggestions table
 * 4. On user return: Inject into system prompt (passive)
 * 5. LLM decides to mention → creates storyline via tool (or doesn't)
 *
 * @module storylineIdleService
 */

import { supabase } from '../supabaseClient';
import type { StorylineCategory } from './storylineService';
import { callGeminiAPI } from './geminiService';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Pending storyline suggestion (generated during absence)
 */
export interface PendingStorylineSuggestion {
  id: string;
  category: StorylineCategory;
  theme: string;         // "learning guitar", "trip planning", "creative project"
  reasoning: string;     // Why this matters to Kayley now
  createdAt: Date;
  expiresAt: Date;       // created_at + 24 hours
  surfaced: boolean;
  surfacedAt: Date | null;
  wasCreated: boolean;
  storylineId: string | null;
  rejectedReason: string | null;
}

/**
 * LLM suggestion generation result
 */
interface SuggestionGenerationResult {
  category: StorylineCategory;
  theme: string;
  reasoning: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  /** Check every 10 minutes */
  CHECK_INTERVAL_MS: 10 * 60 * 1000,

  /** Generate suggestion after 30 minutes of absence */
  ABSENCE_THRESHOLD_MINUTES: 30,

  /** Suggestions expire after 24 hours */
  SUGGESTION_EXPIRATION_HOURS: 24,

  /** Only 1 pending suggestion at a time */
  MAX_PENDING_SUGGESTIONS: 1,

  /** 48-hour cooldown between suggestions */
  SUGGESTION_COOLDOWN_HOURS: 48,
} as const;

const TABLES = {
  SUGGESTIONS: 'storyline_pending_suggestions',
  CONVERSATION_HISTORY: 'conversation_history',
  CONFIG: 'storyline_config',
  STORYLINES: 'life_storylines',
} as const;

// ============================================================================
// SCHEDULER STATE
// ============================================================================

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Start the storyline idle service
 *
 * Begins checking for user absence every 10 minutes.
 * Safe to call multiple times (stops existing scheduler first).
 */
export function startStorylineIdleService(): void {
  if (isRunning) {
    console.log('💭 [StorylineIdle] Already running, stopping first...');
    stopStorylineIdleService();
  }

  console.log('💭 [StorylineIdle] Starting idle service...');
  console.log(`💭 [StorylineIdle] Config: Check every ${CONFIG.CHECK_INTERVAL_MS / 60000} min, threshold ${CONFIG.ABSENCE_THRESHOLD_MINUTES} min`);

  // Run immediately on start
  checkForStorylineSuggestion().catch(err => {
    console.error('💭 [StorylineIdle] Initial check error:', err);
  });

  // Then run periodically
  schedulerInterval = setInterval(() => {
    checkForStorylineSuggestion().catch(err => {
      console.error('💭 [StorylineIdle] Periodic check error:', err);
    });
  }, CONFIG.CHECK_INTERVAL_MS);

  isRunning = true;
  console.log('💭 [StorylineIdle] ✅ Started');
}

/**
 * Stop the storyline idle service
 */
export function stopStorylineIdleService(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  isRunning = false;
  console.log('💭 [StorylineIdle] Stopped');
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return isRunning;
}

// ============================================================================
// ABSENCE DETECTION
// ============================================================================

/**
 * Get last interaction timestamp (UTC)
 *
 * Queries conversation_history for most recent message.
 *
 * @returns Last interaction date (UTC) or null if no history
 */
async function getLastInteractionTime(): Promise<Date | null> {
  try {
    const { data, error } = await supabase
      .from(TABLES.CONVERSATION_HISTORY)
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('💭 [StorylineIdle] Error fetching last interaction:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.log('💭 [StorylineIdle] No conversation history found');
      return null;
    }

    return new Date(data[0].created_at);
  } catch (err) {
    console.error('💭 [StorylineIdle] Exception fetching last interaction:', err);
    return null;
  }
}

/**
 * Calculate absence duration in minutes
 *
 * @param lastInteraction - Last interaction timestamp (UTC)
 * @returns Absence duration in minutes
 */
function calculateAbsenceMinutes(lastInteraction: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - lastInteraction.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  return diffMinutes;
}

// ============================================================================
// SUGGESTION MANAGEMENT
// ============================================================================

/**
 * Check if a pending suggestion already exists
 *
 * @returns true if pending suggestion exists (not expired, not surfaced)
 */
async function hasPendingSuggestion(): Promise<boolean> {
  try {
    const now = new Date();

    const { data, error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .select('id')
      .eq('surfaced', false)
      .gt('expires_at', now.toISOString())
      .limit(1);

    if (error) {
      console.error('💭 [StorylineIdle] Error checking pending suggestion:', error);
      return false;  // Fail open: allow generation if DB error
    }

    return data && data.length > 0;
  } catch (err) {
    console.error('💭 [StorylineIdle] Exception checking pending suggestion:', err);
    return false;
  }
}

/**
 * Get current pending suggestion
 *
 * @returns Pending suggestion or null
 */
export async function getPendingSuggestion(): Promise<PendingStorylineSuggestion | null> {
  try {
    const now = new Date();

    const { data, error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .select('*')
      .eq('surfaced', false)
      .gt('expires_at', now.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('💭 [StorylineIdle] Error fetching pending suggestion:', error);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    return mapSuggestionFromDb(data[0]);
  } catch (err) {
    console.error('💭 [StorylineIdle] Exception fetching pending suggestion:', err);
    return null;
  }
}

/**
 * Mark suggestion as surfaced (shown to user)
 *
 * @param suggestionId - Suggestion ID
 */
export async function markSuggestionSurfaced(suggestionId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .update({
        surfaced: true,
        surfaced_at: new Date().toISOString(),
      })
      .eq('id', suggestionId);

    if (error) {
      console.error('💭 [StorylineIdle] Error marking suggestion surfaced:', error);
    } else {
      console.log(`💭 [StorylineIdle] Marked suggestion surfaced: ${suggestionId}`);
    }
  } catch (err) {
    console.error('💭 [StorylineIdle] Exception marking suggestion surfaced:', err);
  }
}

/**
 * Update suggestion outcome (was it created or rejected?)
 *
 * @param suggestionId - Suggestion ID
 * @param wasCreated - Did it become a storyline?
 * @param storylineId - Storyline ID if created
 * @param rejectedReason - Reason if rejected
 */
export async function updateSuggestionOutcome(
  suggestionId: string,
  wasCreated: boolean,
  storylineId?: string,
  rejectedReason?: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .update({
        was_created: wasCreated,
        storyline_id: storylineId || null,
        rejected_reason: rejectedReason || null,
      })
      .eq('id', suggestionId);

    if (error) {
      console.error('💭 [StorylineIdle] Error updating suggestion outcome:', error);
    } else {
      console.log(`💭 [StorylineIdle] Updated suggestion outcome: ${suggestionId} (created: ${wasCreated})`);
    }
  } catch (err) {
    console.error('💭 [StorylineIdle] Exception updating suggestion outcome:', err);
  }
}

/**
 * Map database row to PendingStorylineSuggestion
 */
function mapSuggestionFromDb(row: any): PendingStorylineSuggestion {
  return {
    id: row.id,
    category: row.category,
    theme: row.theme,
    reasoning: row.reasoning,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    surfaced: row.surfaced,
    surfacedAt: row.surfaced_at ? new Date(row.surfaced_at) : null,
    wasCreated: row.was_created,
    storylineId: row.storyline_id,
    rejectedReason: row.rejected_reason,
  };
}

// ============================================================================
// SUGGESTION GENERATION (LLM)
// ============================================================================

/**
 * Generate storyline suggestion via LLM
 *
 * Uses Gemini API to generate a storyline idea based on:
 * - Kayley's life story
 * - Last 10 days of conversation history
 * - Active storylines (avoid duplicates)
 * - Category balance (suggest underrepresented categories)
 *
 * @returns Generated suggestion or null if error/no suggestion
 */
async function generateStorylineSuggestion(): Promise<PendingStorylineSuggestion | null> {
  try {
    console.log('💭 [StorylineIdle] Generating storyline suggestion via LLM...');

    // Fetch context
    const [kayleyStory, activeStorylines, recentConversation] = await Promise.all([
      getKayleyLifeStory(),
      getActiveStorylines(),
      getRecentConversationSummary(),
    ]);

    // Build prompt
    const prompt = buildSuggestionPrompt(kayleyStory, activeStorylines, recentConversation);

    // Call LLM
    const response = await callGeminiAPI(prompt, {
      temperature: 0.8,  // High creativity for ideation
      maxTokens: 500,
    });

    if (!response || !response.content) {
      console.warn('💭 [StorylineIdle] LLM returned no content');
      return null;
    }

    // Parse response
    const suggestion = parseSuggestionResponse(response.content);

    if (!suggestion) {
      console.warn('💭 [StorylineIdle] Failed to parse LLM response');
      return null;
    }

    // Store suggestion
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + CONFIG.SUGGESTION_EXPIRATION_HOURS);

    const { data, error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .insert({
        category: suggestion.category,
        theme: suggestion.theme,
        reasoning: suggestion.reasoning,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('💭 [StorylineIdle] Error storing suggestion:', error);
      return null;
    }

    console.log(`💭 [StorylineIdle] ✅ Generated suggestion: "${suggestion.theme}" (${suggestion.category})`);

    return mapSuggestionFromDb(data);

  } catch (err) {
    console.error('💭 [StorylineIdle] Exception generating suggestion:', err);
    return null;
  }
}

/**
 * Get Kayley's life story
 *
 * Fetch from character facts or return default.
 *
 * @returns Kayley's life story string
 */
async function getKayleyLifeStory(): Promise<string> {
  return Kayley_Adams_Character_Profile.md
}

/**
 * Get active storylines
 *
 * @returns List of active storylines
 */
async function getActiveStorylines(): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from(TABLES.STORYLINES)
      .select('title, category, phase')
      .is('outcome', null)  // Active = no outcome yet
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data;
  } catch (err) {
    console.error('💭 [StorylineIdle] Error fetching active storylines:', err);
    return [];
  }
}

/**
 * Get recent conversation summary
 *
 * Fetches last 10 days of conversation to inform suggestion generation.
 *
 * @returns Summary string or null
 */
async function getRecentConversationSummary(): Promise<string | null> {
  try {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const { data, error } = await supabase
      .from(TABLES.CONVERSATION_HISTORY)
      .select('role, message_text')
      .gte('created_at', tenDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(30);  // Last 30 messages

    if (error || !data || data.length === 0) {
      return null;
    }

    // Format as summary
    const summary = data
      .reverse()  // Chronological order
      .map(msg => `${msg.role === 'user' ? 'User' : 'Kayley'}: ${msg.message_text}`)
      .join('\n');

    return summary;
  } catch (err) {
    console.error('💭 [StorylineIdle] Error fetching conversation summary:', err);
    return null;
  }
}

/**
 * Build LLM prompt for suggestion generation
 */
function buildSuggestionPrompt(
  kayleyStory: string,
  activeStorylines: any[],
  recentConversation: string | null
): string {
  return `
You are Kayley Adams. You've been away from the user for a while, and you've been thinking about your life.

# Your Character & Life Story
${kayleyStory}

# Your Current Life Storylines
${activeStorylines.length > 0
  ? activeStorylines.map(s => `- ${s.title} (${s.category}, ${s.phase} phase)`).join('\n')
  : 'None - you have space for a new storyline'
}

# Recent Conversation Topics (Last 10 Days)
${recentConversation || 'No recent conversation'}

# Task
Generate ONE new storyline idea that:
- Fits your personality (Kayley would realistically do this - you would NEVER get a tattoo, for example)
- Is meaningful (not trivial, has emotional weight)
- Has future development (will unfold over days/weeks)
- Doesn't duplicate existing storylines
- Balances life categories (if you have work storyline, suggest creative/personal/social/family)

# Output Format (JSON only, no explanation)
{
  "category": "work" | "personal" | "family" | "social" | "creative",
  "theme": "Short description (3-8 words): 'learning guitar', 'planning trip to NYC'",
  "reasoning": "Why this matters to Kayley now (2-3 sentences)"
}

# Examples

**Good Suggestions (fit personality):**
- { "category": "creative", "theme": "learning guitar", "reasoning": "I've been thinking about music a lot lately. I've always wanted to learn an instrument, and guitar feels achievable." }
- { "category": "personal", "theme": "training for a 5K", "reasoning": "I want to challenge myself physically. Running might help with my anxiety too." }
- { "category": "social", "theme": "planning reunion with college friends", "reasoning": "I miss my college friends. It's been too long since we've all been together." }

**Bad Suggestions (don't fit personality):**
- { "category": "personal", "theme": "getting a tattoo", "reasoning": "..." } ← Kayley would NEVER
- { "category": "work", "theme": "starting a tech startup", "reasoning": "..." } ← Too ambitious, not realistic
- { "category": "creative", "theme": "doing laundry", "reasoning": "..." } ← Trivial, not storyline-worthy

Generate ONE suggestion now (JSON only, no explanation):
`.trim();
}

/**
 * Parse LLM response into suggestion
 */
function parseSuggestionResponse(content: string): SuggestionGenerationResult | null {
  try {
    // Extract JSON from response (may have markdown formatting)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('💭 [StorylineIdle] No JSON found in LLM response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate
    if (!parsed.category || !parsed.theme || !parsed.reasoning) {
      console.warn('💭 [StorylineIdle] Missing required fields in LLM response');
      return null;
    }

    // Validate category
    const validCategories: StorylineCategory[] = ['work', 'personal', 'family', 'social', 'creative'];
    if (!validCategories.includes(parsed.category)) {
      console.warn(`💭 [StorylineIdle] Invalid category: ${parsed.category}`);
      return null;
    }

    return {
      category: parsed.category,
      theme: parsed.theme,
      reasoning: parsed.reasoning,
    };
  } catch (err) {
    console.error('💭 [StorylineIdle] Error parsing LLM response:', err);
    return null;
  }
}

// ============================================================================
// MAIN CHECK FUNCTION
// ============================================================================

/**
 * Main periodic check function
 *
 * Called every 10 minutes by scheduler.
 *
 * Logic:
 * 1. Check if user is absent ≥30 minutes
 * 2. Check if pending suggestion already exists
 * 3. Check if suggestion cooldown active
 * 4. Generate suggestion if all checks pass
 */
export async function checkForStorylineSuggestion(): Promise<void> {
  console.log('💭 [StorylineIdle] Running periodic check...');

  try {
    // ============================================
    // CHECK 1: User Absence
    // ============================================

    const lastInteraction = await getLastInteractionTime();

    if (!lastInteraction) {
      console.log('💭 [StorylineIdle] No conversation history, skipping');
      return;
    }

    const absenceMinutes = calculateAbsenceMinutes(lastInteraction);

    console.log(`💭 [StorylineIdle] User absent for ${absenceMinutes} minutes (threshold: ${CONFIG.ABSENCE_THRESHOLD_MINUTES})`);

    if (absenceMinutes < CONFIG.ABSENCE_THRESHOLD_MINUTES) {
      console.log('💭 [StorylineIdle] User not away long enough, skipping');
      return;
    }

    // ============================================
    // CHECK 2: Pending Suggestion
    // ============================================

    const hasPending = await hasPendingSuggestion();

    if (hasPending) {
      console.log('💭 [StorylineIdle] Pending suggestion already exists, skipping');
      return;
    }

    // ============================================
    // CHECK 3: Suggestion Cooldown
    // ============================================

    const cooldownOk = await checkSuggestionCooldown();

    if (!cooldownOk) {
      console.log('💭 [StorylineIdle] Suggestion cooldown active, skipping');
      return;
    }

    // ============================================
    // ALL CHECKS PASSED - GENERATE SUGGESTION
    // ============================================

    console.log('💭 [StorylineIdle] ✅ All checks passed, generating suggestion...');

    const suggestion = await generateStorylineSuggestion();

    if (suggestion) {
      console.log(`💭 [StorylineIdle] ✅ Suggestion generated and stored: "${suggestion.theme}"`);
    } else {
      console.warn('💭 [StorylineIdle] Failed to generate suggestion');
    }


  } catch (err) {
    console.error('💭 [StorylineIdle] Exception in periodic check:', err);
  }
}

/**
 * Check suggestion cooldown (48 hours)
 *
 * @returns true if cooldown elapsed, false otherwise
 */
async function checkSuggestionCooldown(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from(TABLES.CONFIG)
      .select('last_storyline_created_at')
      .eq('id', 1)
      .single();

    if (error || !data?.last_storyline_created_at) {
      // No previous suggestion/creation
      return true;
    }

    const lastCreated = new Date(data.last_storyline_created_at);
    const hoursSince = (Date.now() - lastCreated.getTime()) / (1000 * 60 * 60);

    if (hoursSince < CONFIG.SUGGESTION_COOLDOWN_HOURS) {
      const hoursRemaining = Math.ceil(CONFIG.SUGGESTION_COOLDOWN_HOURS - hoursSince);
      console.log(`💭 [StorylineIdle] Cooldown active: ${hoursRemaining}h remaining`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('💭 [StorylineIdle] Cooldown check error:', err);
    return true;  // Fail open
  }
}
```

---

#### Step 2.3: Start Idle Service in App.tsx

**File:** `src/App.tsx`

**Location:** Add alongside existing background services

```typescript
import { startStorylineIdleService, stopStorylineIdleService } from './services/storylineIdleService';

// ... existing imports

useEffect(() => {
  // ... existing startup code

  // Start background services
  startPromiseChecker();  // ✅ Existing
  startStorylineIdleService();  // ✅ NEW

  return () => {
    stopPromiseChecker();
    stopStorylineIdleService();  // ✅ NEW
  };
}, []);
```

---

#### Step 2.4: Inject Suggestion into System Prompt

**File:** `src/services/GeminiChatService.ts` (or appropriate chat service)

**Location:** Before building system prompt

```typescript
import { getPendingSuggestion, markSuggestionSurfaced } from './storylineIdleService';

// ... in chat processing function, before building system prompt:

// Check for pending storyline suggestion
const pendingSuggestion = await getPendingSuggestion();

if (pendingSuggestion) {
  console.log(`💭 [Chat] Found pending storyline suggestion: "${pendingSuggestion.theme}"`);

  // Add to system prompt (PASSIVE style - LLM decides when to mention)
  const suggestionPrompt = `

====================================================
RECENT THOUGHTS (While You Were Away)
====================================================

You've been thinking about ${pendingSuggestion.theme}.

**Why this matters to you:**
${pendingSuggestion.reasoning}

**How to handle this:**
- If it feels natural to the conversation, you might mention this
- Don't force it - only bring it up if it fits the flow
- If you decide to announce this as a new life storyline, use the create_life_storyline tool
- If you don't mention it this conversation, that's fine - it will still be on your mind for later

`;

  systemPrompt += suggestionPrompt;

  // Mark as surfaced (shown to user)
  await markSuggestionSurfaced(pendingSuggestion.id);
}
```

---

### Phase 2 Testing

#### Manual Test Cases

**Test Case 5: Idle Suggestion Generation**

1. Chat with Kayley
2. Close app (or wait 30+ minutes without chatting)
3. Check database: `storyline_pending_suggestions`
4. Return to app, send message
5. Observe Kayley's response

**Expected:**
- After 30 min: Row in `storyline_pending_suggestions` (surfaced=false)
- On return: Kayley might mention: "Hey! I've been thinking... [theme]"
- Database: Suggestion marked surfaced=true
- If mentioned and tool called: was_created=true, storyline_id set

**Test Case 6: Passive Surfacing (LLM Choice)**

1. Generate suggestion (Test Case 5)
2. User returns and says: "Hey"
3. Observe Kayley's response

**Expected:**
- Kayley might mention suggestion immediately
- OR Kayley might not mention it (saves for later)
- LLM has agency - not forced

**Test Case 7: End-to-End (Idle → Creation)**

1. Chat with Kayley
2. Wait 30+ minutes
3. Verify suggestion generated (database check)
4. Return, send message
5. Kayley announces storyline
6. LLM calls `create_life_storyline`
7. All safety checks pass
8. Storyline created

**Expected:**
- Suggestion → Prompt injection → Announcement → Tool call → Safety checks → Creation
- Database: Rows in:
  - `storyline_pending_suggestions` (surfaced=true, was_created=true, storyline_id set)
  - `life_storylines` (new storyline)
  - `storyline_creation_attempts` (success=true, source='idle_suggestion')

---

### Phase 2 Rollout Checklist

- [ ] Create `20260118_create_storyline_pending_suggestions.sql`
- [ ] Review migration (DO NOT apply yet)
- [ ] User applies migration manually: `supabase migration apply`
- [ ] Verify table exists: Query Supabase dashboard
- [ ] Create `storylineIdleService.ts`
- [ ] Implement all functions (scheduler, absence detection, LLM generation, suggestion management)
- [ ] Verify: TypeScript compiles (`npm run build`)
- [ ] Add service startup to `App.tsx`
- [ ] Add prompt injection to chat service (GeminiChatService.ts or similar)
- [ ] Verify: TypeScript compiles
- [ ] Verify: No runtime errors on app start
- [ ] Verify: Idle service starts successfully (check console logs)
- [ ] Manual Test Case 5: Idle suggestion generation ✅
- [ ] Manual Test Case 6: Passive surfacing (LLM choice) ✅
- [ ] Manual Test Case 7: End-to-end (idle → creation) ✅
- [ ] Monitor for 48 hours (check logs, database, suggestion conversion rate)

---

## Safety Controls

### Cooldown System

**48-hour cooldown between storyline creations**

- Enforced at tool call level (both conversation and idle)
- Shared state: `storyline_config.last_storyline_created_at`
- Prevents spam from any source

### Semantic Deduplication

**60% word overlap = duplicate**

- Checks last 7 days of storylines in same category
- Example: "Learning guitar" vs "Learning to play guitar" = 75% overlap → Blocked
- Prevents repetitive storylines

### Category Constraint

**Phase 1: Only 1 total active storyline**

- Global constraint: `WHERE outcome IS NULL`
- Any active storyline blocks new creation
- Will be relaxed in future (per-category constraint)

### Audit Logging

**All attempts logged to `storyline_creation_attempts`**

- Success and failure
- Failure reason (cooldown, duplicate, category_blocked, db_error)
- Source (conversation vs idle_suggestion)
- Enables observability and tuning

---

## Database Schema

### Tables Created

**1. storyline_config (modified)**
- Added: `last_storyline_created_at` column
- Purpose: Track cooldown for creation

**2. storyline_creation_attempts (new)**
- Purpose: Audit log for all creation attempts
- Indexes: attempted_at, success, failure_reason

**3. storyline_pending_suggestions (new)**
- Purpose: Store idle-generated suggestions
- Lifecycle: created → surfaced → outcome (created or rejected)
- Expiration: 24 hours

---

## Testing Strategy

### Unit Tests

**File:** `src/services/__tests__/storylineService.test.ts`

- Test cooldown check (allowed/blocked)
- Test duplicate detection (similarity calculation)
- Test category constraint (global limit)
- Test `createStorylineFromTool` success path
- Test `createStorylineFromTool` failure paths

**File:** `src/services/__tests__/storylineIdleService.test.ts`

- Test scheduler start/stop
- Test absence detection
- Test suggestion generation (mock LLM)
- Test cooldown enforcement

### Integration Tests

- End-to-end: User message → Tool call → Creation
- End-to-end: Idle → Suggestion → Prompt → Tool call → Creation
- Cooldown enforcement across sources

### Manual Tests

See Phase 1 and Phase 2 test cases above.

---

## Rollout Checklist

### Phase 1: Conversation-Driven Creation

- [ ] Database migrations (cooldown column, audit table)
- [ ] `storylineService.ts` additions (types, safety functions, main function)
- [ ] LLM tool integration (`aiSchema.ts`, `memoryService.ts`, `toolsAndCapabilities.ts`)
- [ ] TypeScript compiles
- [ ] Tests pass
- [ ] Snapshot tests updated
- [ ] Manual testing (4 test cases)
- [ ] Monitor for 24 hours

### Phase 2: Idle Suggestions

- [ ] Database migration (pending suggestions table)
- [ ] `storylineIdleService.ts` implementation
- [ ] `App.tsx` integration (start service)
- [ ] Chat service integration (prompt injection)
- [ ] TypeScript compiles
- [ ] Tests pass
- [ ] Idle service starts successfully
- [ ] Manual testing (3 test cases)
- [ ] Monitor for 48 hours

---

## Configuration Tuning

### If too many storylines created:
- Increase cooldown (48h → 72h)
- Increase similarity threshold (0.6 → 0.7)
- Decrease LLM temperature for suggestions (0.8 → 0.6)

### If too few storylines created:
- Decrease cooldown (48h → 36h)
- Decrease similarity threshold (0.6 → 0.5)
- Increase LLM temperature for suggestions (0.8 → 0.9)

### If duplicate storylines created:
- Increase similarity threshold (0.6 → 0.7)
- Increase dedupe window (7 days → 14 days)

### If category imbalance:
- Adjust suggestion prompt to favor underrepresented categories
- Add category rotation logic to idle service

---

## Observability Queries

```sql
-- Creation success rate (last 7 days)
SELECT
  DATE(attempted_at) AS day,
  COUNT(*) AS total,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successful,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate
FROM storyline_creation_attempts
WHERE attempted_at >= NOW() - INTERVAL '7 days'
GROUP BY day
ORDER BY day DESC;

-- Failure reason breakdown
SELECT
  failure_reason,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS percentage
FROM storyline_creation_attempts
WHERE success = FALSE
GROUP BY failure_reason
ORDER BY count DESC;

-- Category distribution
SELECT
  category,
  COUNT(*) AS created
FROM life_storylines
GROUP BY category
ORDER BY created DESC;

-- Idle suggestion conversion rate
SELECT
  COUNT(*) AS total_suggestions,
  SUM(CASE WHEN surfaced THEN 1 ELSE 0 END) AS surfaced,
  SUM(CASE WHEN was_created THEN 1 ELSE 0 END) AS created_storylines,
  ROUND(100.0 * SUM(CASE WHEN was_created THEN 1 ELSE 0 END) / COUNT(*), 2) AS conversion_rate
FROM storyline_pending_suggestions;
```

---

## Summary

### Phase 1 Deliverables
- ✅ LLM tool: `create_life_storyline`
- ✅ Safety controls: Cooldown, dedupe, category constraint
- ✅ Audit logging: All attempts tracked
- ✅ Conversation-driven creation works

### Phase 2 Deliverables
- ✅ Idle service: Detects absence, generates suggestions
- ✅ Direct prompt injection: PASSIVE style, LLM chooses when to mention
- ✅ End-to-end flow: Idle → Suggestion → Prompt → Tool → Creation
- ✅ No threads system needed

### Success Criteria
- ✅ Storylines create reliably (success rate >80%)
- ✅ No runaway creation (cooldown respected)
- ✅ No duplicate storylines (dedupe works)
- ✅ Kayley feels autonomous (idle suggestions work)
- ✅ LLM has agency (passive surfacing, not forced)
- ✅ User experience positive (storylines enhance conversations)
