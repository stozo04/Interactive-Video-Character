# Life Storyline Creation - 2-Phase Implementation Plan

**Status:** Ready for Implementation
**Date:** 2026-01-18
**Architecture:** Clean, LLM-driven, no threads system
**Chosen Path:** Phase 1 (Conversation) → Phase 2 (Idle Suggestions)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1: Conversation-Driven Creation](#phase-1-conversation-driven-creation)
3. [Phase 2: Idle Suggestions with Direct Injection](#phase-2-idle-suggestions-with-direct-injection)
4. [Safety Controls](#safety-controls)
5. [Database Schema](#database-schema)
6. [Testing Strategy](#testing-strategy)
7. [Rollout Checklist](#rollout-checklist)

---

## Architecture Overview

### Design Principles

1. **LLM-Driven:** Rely on Gemini for all decision-making (no hardcoded logic)
2. **No Threads:** Direct prompt injection instead of complex thread system
3. **Passive Surfacing:** LLM chooses when to mention (not forced)
4. **Strong Safety:** Cooldown, deduplication, category constraints, audit logging
5. **Phased Rollout:** Validate conversation-driven first, then add autonomy

### Two-Phase Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: CONVERSATION-DRIVEN CREATION                      │
└─────────────────────────────────────────────────────────────┘
                        ↓
    User: "I'm starting guitar lessons tomorrow"
                        ↓
    LLM recognizes: "This is storyline-worthy"
                        ↓
    LLM calls: create_life_storyline({ title, category, ... })
                        ↓
    Safety checks: cooldown → dedupe → category constraint
                        ↓
    If pass: Create storyline (phase=announced)
    If fail: Return error, LLM accepts gracefully
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  STORYLINE ACTIVE                                           │
└─────────────────────────────────────────────────────────────┘
    Daily processing:
    - Phase transitions (announced → honeymoon → reality → ...)
    - Update generation (LLM creates phase-specific updates)
    - Mood integration (affects energy/warmth)
    - System prompt injection (surfaces in conversation)
```

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: IDLE SUGGESTIONS (AUTONOMOUS)                     │
└─────────────────────────────────────────────────────────────┘
                        ↓
    User absent ≥30 minutes
                        ↓
    Idle service checks (every 10 minutes)
                        ↓
    Generate suggestion via LLM:
    - Input: Last 10 days conversation history
    - Input: Kayley's life story
    - Input: Existing storylines (avoid duplicates)
    - Input: Category balance (suggest underrepresented)
    - Output: { category, theme, reasoning }
                        ↓
    Store in storyline_pending_suggestions
    (NOT created yet - just a suggestion)
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  USER RETURNS                                                │
└─────────────────────────────────────────────────────────────┘
                        ↓
    Check: getPendingSuggestion()
                        ↓
    If suggestion exists:
        Add to system prompt (PASSIVE):
        "You've been thinking about [theme].
         Reasoning: [why this matters to Kayley now]
         If it feels natural, you might mention this."
                        ↓
    LLM sees suggestion in prompt
                        ↓
    LLM decides: "Should I mention this now?"
        - YES → Kayley: "Hey! I've been thinking..."
              → LLM calls create_life_storyline(...)
              → Safety checks → Create or reject
              → Clear suggestion
        - NO → Saves it for later conversation
             → Suggestion expires after 24 hours
```

### Key Configuration

```typescript
// Phase 1 Configuration
const CREATION_SAFETY_CONFIG = {
  COOLDOWN_HOURS: 48,              // 48 hours between creations
  DEDUPE_WINDOW_DAYS: 7,           // Check last 7 days for duplicates
  SIMILARITY_THRESHOLD: 0.6,       // 60% word overlap = duplicate
  MAX_ACTIVE_STORYLINES: 1,        // Only 1 total active (Phase 1)
};

// Phase 2 Configuration
const IDLE_CONFIG = {
  ABSENCE_THRESHOLD_MINUTES: 30,   // Generate suggestion after 30 min away
  CHECK_INTERVAL_MS: 10 * 60 * 1000, // Check every 10 minutes
  SUGGESTION_COOLDOWN_HOURS: 48,   // 48 hours between suggestions
  SUGGESTION_EXPIRATION_HOURS: 24, // Suggestions expire after 24 hours
  MAX_PENDING_SUGGESTIONS: 1,      // Only 1 pending at a time
};
```

---

## Phase 1: Conversation-Driven Creation

### Overview

**Goal:** Enable storyline creation when user or Kayley mention storyline-worthy events in conversation.

**Scope:** ~300 lines of new code, 3 database changes, 5 files modified

**Timeline:** 1-2 days

### Implementation Steps

#### Step 1.1: Database Migration - Cooldown Tracking

**File:** `supabase/migrations/20260118_add_storyline_cooldown.sql`

```sql
-- Add cooldown timestamp to track last creation
ALTER TABLE storyline_config
ADD COLUMN last_storyline_created_at TIMESTAMPTZ;

-- Set initial value (49 hours ago = outside 48-hour window, allows immediate creation)
UPDATE storyline_config
SET last_storyline_created_at = NOW() - INTERVAL '49 hours'
WHERE id = 1;

-- Documentation
COMMENT ON COLUMN storyline_config.last_storyline_created_at IS
  'Tracks last storyline creation for 48-hour cooldown enforcement';
```

**DO NOT APPLY YET** - User will apply manually after review.

---

#### Step 1.2: Database Migration - Audit Logging

**File:** `supabase/migrations/20260118_create_storyline_creation_attempts.sql`

```sql
-- Audit log for all storyline creation attempts (success and failure)
CREATE TABLE storyline_creation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Attempt details
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  storyline_type TEXT,

  -- Result
  success BOOLEAN NOT NULL,
  failure_reason TEXT,  -- 'cooldown_active' | 'duplicate_detected' | 'category_constraint' | 'db_error'

  -- Failure details
  cooldown_hours_remaining INTEGER,
  duplicate_match TEXT,              -- Title of duplicate if found
  active_storyline_blocking UUID REFERENCES life_storylines(id),

  -- Source tracking
  source TEXT NOT NULL DEFAULT 'conversation'  -- 'conversation' | 'idle_suggestion'
);

-- Indexes for performance and observability
CREATE INDEX idx_storyline_attempts_time ON storyline_creation_attempts(attempted_at DESC);
CREATE INDEX idx_storyline_attempts_success ON storyline_creation_attempts(success);
CREATE INDEX idx_storyline_attempts_failure ON storyline_creation_attempts(failure_reason)
  WHERE success = FALSE;

-- Documentation
COMMENT ON TABLE storyline_creation_attempts IS
  'Audit log for all storyline creation attempts. Used for observability, debugging, and rate limit tuning.';
```

**DO NOT APPLY YET** - User will apply manually after review.

---

#### Step 1.3: Add Types to storylineService.ts

**File:** `src/services/storylineService.ts`

**Location:** Add at top of file (after existing imports)

```typescript
// ============================================================================
// STORYLINE CREATION TYPES
// ============================================================================

/**
 * Input for creating storyline from LLM tool
 */
export interface CreateStorylineFromToolInput {
  title: string;
  category: StorylineCategory;
  storylineType: StorylineType;
  initialAnnouncement: string;
  stakes: string;
  userInvolvement?: 'none' | 'aware' | 'supportive' | 'involved' | 'central';
  emotionalTone?: string;
  emotionalIntensity?: number;
}

/**
 * Result of storyline creation attempt
 */
export interface StorylineCreationResult {
  success: boolean;
  storylineId?: string;
  error?: string;
  errorDetails?: {
    reason: 'cooldown' | 'duplicate' | 'category_blocked' | 'db_error' | 'unknown';
    hoursRemaining?: number;
    duplicateTitle?: string;
    activeStorylineTitle?: string;
  };
}

/**
 * Cooldown check result
 */
interface CooldownCheck {
  allowed: boolean;
  lastCreatedAt: Date | null;
  hoursRemaining: number;
}

/**
 * Category constraint check result
 */
interface CategoryCheck {
  allowed: boolean;
  activeStoryline?: LifeStoryline;
}

/**
 * Failure reason enum (matches DB constraint)
 */
export type FailureReason =
  | 'cooldown_active'
  | 'duplicate_detected'
  | 'category_constraint'
  | 'db_error'
  | 'unknown';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Safety controls for storyline creation
 */
const CREATION_SAFETY_CONFIG = {
  /** 48-hour cooldown between creations */
  COOLDOWN_HOURS: 48,

  /** Check last 7 days for duplicate storylines */
  DEDUPE_WINDOW_DAYS: 7,

  /** 60% word overlap = duplicate */
  SIMILARITY_THRESHOLD: 0.6,

  /** Phase 1: Only 1 total active storyline allowed */
  MAX_ACTIVE_STORYLINES: 1,
} as const;

/**
 * Table names
 */
const CREATION_TABLES = {
  CONFIG: 'storyline_config',
  STORYLINES: 'life_storylines',
  ATTEMPTS: 'storyline_creation_attempts',
} as const;
```

---

#### Step 1.4: Add Safety Check Functions

**File:** `src/services/storylineService.ts`

**Location:** Add in new section "Storyline Creation Safety Functions"

```typescript
// ============================================================================
// STORYLINE CREATION SAFETY FUNCTIONS
// ============================================================================

/**
 * Check if storyline creation cooldown has elapsed
 *
 * @returns CooldownCheck with allowed status and hours remaining
 */
async function checkStorylineCreationCooldown(): Promise<CooldownCheck> {
  try {
    const { data, error } = await supabase
      .from(CREATION_TABLES.CONFIG)
      .select('last_storyline_created_at')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('[Storylines] Cooldown check error:', error);
      // Fail open: allow creation if DB error
      return { allowed: true, lastCreatedAt: null, hoursRemaining: 0 };
    }

    if (!data?.last_storyline_created_at) {
      // No previous creation
      return { allowed: true, lastCreatedAt: null, hoursRemaining: 0 };
    }

    const lastCreated = new Date(data.last_storyline_created_at);
    const hoursSince = (Date.now() - lastCreated.getTime()) / (1000 * 60 * 60);

    if (hoursSince < CREATION_SAFETY_CONFIG.COOLDOWN_HOURS) {
      const hoursRemaining = Math.ceil(CREATION_SAFETY_CONFIG.COOLDOWN_HOURS - hoursSince);

      console.log(`📖 [Storylines] Cooldown active: ${hoursRemaining}h remaining`);

      return {
        allowed: false,
        lastCreatedAt: lastCreated,
        hoursRemaining
      };
    }

    console.log(`📖 [Storylines] Cooldown elapsed (${hoursSince.toFixed(1)}h since last creation)`);

    return {
      allowed: true,
      lastCreatedAt: lastCreated,
      hoursRemaining: 0
    };

  } catch (err) {
    console.error('[Storylines] Cooldown check exception:', err);
    // Fail open: allow creation if unexpected error
    return { allowed: true, lastCreatedAt: null, hoursRemaining: 0 };
  }
}

/**
 * Update cooldown timestamp after successful creation
 */
async function updateStorylineCreationCooldown(): Promise<void> {
  try {
    const { error } = await supabase
      .from(CREATION_TABLES.CONFIG)
      .update({ last_storyline_created_at: new Date().toISOString() })
      .eq('id', 1);

    if (error) {
      console.error('[Storylines] Failed to update cooldown timestamp:', error);
    } else {
      console.log(`📖 [Storylines] Cooldown timestamp updated`);
    }
  } catch (err) {
    console.error('[Storylines] Cooldown update exception:', err);
  }
}

/**
 * Check if a similar storyline already exists (semantic deduplication)
 *
 * Uses fuzzy string matching (word overlap) to detect duplicates within
 * a 7-day window in the same category.
 *
 * @param title - Proposed storyline title
 * @param category - Storyline category
 * @returns true if duplicate found, false otherwise
 */
async function checkDuplicateStoryline(
  title: string,
  category: StorylineCategory
): Promise<boolean> {
  try {
    // Calculate window start (7 days ago)
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - CREATION_SAFETY_CONFIG.DEDUPE_WINDOW_DAYS);

    // Query recent storylines in same category
    const { data, error } = await supabase
      .from(CREATION_TABLES.STORYLINES)
      .select('title, created_at, outcome')
      .eq('category', category)
      .gte('created_at', windowStart.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Storylines] Duplicate check error:', error);
      // Fail open: allow creation if DB error
      return false;
    }

    if (!data || data.length === 0) {
      console.log(`📖 [Storylines] No recent storylines in ${category} category`);
      return false;
    }

    // Normalize input title
    const normalizedTitle = title.toLowerCase().trim();

    // Check similarity against each existing storyline
    for (const existing of data) {
      const existingTitle = existing.title.toLowerCase().trim();
      const similarity = calculateStringSimilarity(normalizedTitle, existingTitle);

      if (similarity >= CREATION_SAFETY_CONFIG.SIMILARITY_THRESHOLD) {
        console.warn(
          `📖 [Storylines] DUPLICATE DETECTED: "${title}" ~= "${existing.title}" ` +
          `(${(similarity * 100).toFixed(0)}% similar, threshold ${CREATION_SAFETY_CONFIG.SIMILARITY_THRESHOLD * 100}%)`
        );

        return true;
      }
    }

    console.log(`📖 [Storylines] No duplicates found for "${title}"`);
    return false;

  } catch (err) {
    console.error('[Storylines] Duplicate check exception:', err);
    // Fail open: allow creation if unexpected error
    return false;
  }
}

/**
 * Calculate string similarity using word overlap ratio
 *
 * Uses same algorithm as loop cleanup service for consistency.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity score (0-1)
 *
 * @example
 * calculateStringSimilarity("learning guitar", "guitar lessons")
 * // Returns: 0.5 (50% overlap: "guitar" is common)
 *
 * calculateStringSimilarity("learning guitar", "learning to play guitar")
 * // Returns: 0.75 (75% overlap: "learning" and "guitar" are common)
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  // Split into word sets
  const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 0));
  const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 0));

  // Calculate intersection and union
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  // Avoid division by zero
  if (union.size === 0) return 0;

  // Return overlap ratio
  return intersection.size / union.size;
}

/**
 * Check if category constraint allows new storyline creation
 *
 * Phase 1: Checks if ANY active storyline exists (global constraint)
 *
 * @param category - Category to check
 * @returns CategoryCheck with allowed status and blocking storyline if any
 */
async function checkCategoryConstraint(
  category: StorylineCategory
): Promise<CategoryCheck> {
  try {
    // Phase 1: Check if ANY active storyline exists (global constraint)
    const { data, error } = await supabase
      .from(CREATION_TABLES.STORYLINES)
      .select('*')
      .is('outcome', null)  // outcome IS NULL = active
      .limit(1);

    if (error) {
      console.error('[Storylines] Category constraint check error:', error);
      // Fail closed: block creation if DB error (safer than allowing)
      return { allowed: false };
    }

    if (data && data.length > 0) {
      const activeStoryline = mapStorylineFromDb(data[0]);

      console.warn(
        `📖 [Storylines] CATEGORY BLOCKED: Active storyline exists: ` +
        `"${activeStoryline.title}" (${activeStoryline.category}, ${activeStoryline.phase})`
      );

      return {
        allowed: false,
        activeStoryline
      };
    }

    console.log(`📖 [Storylines] Category constraint passed (no active storylines)`);
    return { allowed: true };

  } catch (err) {
    console.error('[Storylines] Category constraint check exception:', err);
    // Fail closed: block creation if unexpected error (safer)
    return { allowed: false };
  }
}

/**
 * Log storyline creation attempt to audit table
 *
 * @param input - Creation input
 * @param result - Creation result
 * @param failureDetails - Failure details if unsuccessful
 * @param source - Source of creation ('conversation' | 'idle_suggestion')
 */
async function logCreationAttempt(
  input: CreateStorylineFromToolInput,
  result: StorylineCreationResult,
  failureDetails?: {
    reason: FailureReason;
    hoursRemaining?: number;
    duplicateTitle?: string;
    activeStorylineId?: string;
  },
  source: 'conversation' | 'idle_suggestion' = 'conversation'
): Promise<void> {
  try {
    const { error } = await supabase
      .from(CREATION_TABLES.ATTEMPTS)
      .insert({
        title: input.title,
        category: input.category,
        storyline_type: input.storylineType,
        success: result.success,
        failure_reason: failureDetails?.reason || null,
        cooldown_hours_remaining: failureDetails?.hoursRemaining || null,
        duplicate_match: failureDetails?.duplicateTitle || null,
        active_storyline_blocking: failureDetails?.activeStorylineId || null,
        source,
      });

    if (error) {
      console.error('[Storylines] Failed to log creation attempt:', error);
    }
  } catch (err) {
    console.error('[Storylines] Audit logging exception:', err);
    // Don't throw - logging failure shouldn't block creation
  }
}
```

---

#### Step 1.5: Add Main Creation Function

**File:** `src/services/storylineService.ts`

**Location:** Add after safety check functions

```typescript
/**
 * Create storyline from LLM tool call
 *
 * Runs all safety checks (cooldown, dedupe, category constraint) before creating.
 * Logs all attempts to audit table.
 *
 * @param input - Storyline creation input
 * @param source - Source of creation ('conversation' | 'idle_suggestion')
 * @returns StorylineCreationResult with success status or error details
 *
 * @example
 * const result = await createStorylineFromTool({
 *   title: "Learning guitar",
 *   category: "creative",
 *   storylineType: "project",
 *   initialAnnouncement: "I'm starting guitar lessons",
 *   stakes: "I've wanted to learn music for years"
 * });
 *
 * if (result.success) {
 *   console.log(`Created storyline: ${result.storylineId}`);
 * } else {
 *   console.log(`Failed: ${result.error}`);
 * }
 */
export async function createStorylineFromTool(
  input: CreateStorylineFromToolInput,
  source: 'conversation' | 'idle_suggestion' = 'conversation'
): Promise<StorylineCreationResult> {

  console.log(`📖 [Storylines] Creation attempt: "${input.title}" (${input.category})`);
  console.log(`📖 [Storylines] Source: ${source}`);

  // ============================================
  // SAFETY CHECK 1: Cooldown
  // ============================================

  const cooldown = await checkStorylineCreationCooldown();

  if (!cooldown.allowed) {
    const error = `Must wait ${cooldown.hoursRemaining} hours before creating another storyline`;

    console.warn(`📖 [Storylines] ❌ COOLDOWN: ${error}`);

    const result: StorylineCreationResult = {
      success: false,
      error,
      errorDetails: {
        reason: 'cooldown',
        hoursRemaining: cooldown.hoursRemaining,
      }
    };

    await logCreationAttempt(
      input,
      result,
      {
        reason: 'cooldown_active',
        hoursRemaining: cooldown.hoursRemaining,
      },
      source
    );

    return result;
  }

  // ============================================
  // SAFETY CHECK 2: Duplicate Detection
  // ============================================

  const isDuplicate = await checkDuplicateStoryline(input.title, input.category);

  if (isDuplicate) {
    const error = `A similar storyline already exists or recently resolved in ${input.category} category`;

    console.warn(`📖 [Storylines] ❌ DUPLICATE: ${error}`);

    const result: StorylineCreationResult = {
      success: false,
      error,
      errorDetails: {
        reason: 'duplicate',
      }
    };

    await logCreationAttempt(
      input,
      result,
      {
        reason: 'duplicate_detected',
        duplicateTitle: input.title,
      },
      source
    );

    return result;
  }

  // ============================================
  // SAFETY CHECK 3: Category Constraint
  // ============================================

  const categoryCheck = await checkCategoryConstraint(input.category);

  if (!categoryCheck.allowed) {
    const activeTitle = categoryCheck.activeStoryline?.title || 'Unknown';
    const error = `An active storyline already exists: "${activeTitle}". Resolve it before creating a new one.`;

    console.warn(`📖 [Storylines] ❌ CATEGORY BLOCKED: ${error}`);

    const result: StorylineCreationResult = {
      success: false,
      error,
      errorDetails: {
        reason: 'category_blocked',
        activeStorylineTitle: activeTitle,
      }
    };

    await logCreationAttempt(
      input,
      result,
      {
        reason: 'category_constraint',
        activeStorylineId: categoryCheck.activeStoryline?.id,
      },
      source
    );

    return result;
  }

  // ============================================
  // ALL CHECKS PASSED - CREATE STORYLINE
  // ============================================

  console.log(`📖 [Storylines] ✅ All safety checks passed, creating storyline...`);

  try {
    const storyline = await createStoryline({
      title: input.title,
      category: input.category,
      storylineType: input.storylineType,
      initialAnnouncement: input.initialAnnouncement,
      stakes: input.stakes,
      userInvolvement: input.userInvolvement || 'aware',
      currentEmotionalTone: input.emotionalTone || null,
      emotionalIntensity: input.emotionalIntensity || 0.7,
      phase: 'announced',
      shouldMentionBy: calculateMentionDeadline(1), // 1 day for announced phase
    });

    if (!storyline) {
      const error = 'Failed to create storyline (database error)';

      console.error(`📖 [Storylines] ❌ DB ERROR: ${error}`);

      const result: StorylineCreationResult = {
        success: false,
        error,
        errorDetails: {
          reason: 'db_error',
        }
      };

      await logCreationAttempt(
        input,
        result,
        { reason: 'db_error' },
        source
      );

      return result;
    }

    // Update cooldown timestamp
    await updateStorylineCreationCooldown();

    console.log(`📖 [Storylines] ✅ SUCCESS: Created storyline "${storyline.title}" (${storyline.id})`);

    const result: StorylineCreationResult = {
      success: true,
      storylineId: storyline.id,
    };

    await logCreationAttempt(input, result, undefined, source);

    return result;

  } catch (err) {
    const error = 'Unexpected error during storyline creation';

    console.error(`📖 [Storylines] ❌ EXCEPTION:`, err);

    const result: StorylineCreationResult = {
      success: false,
      error,
      errorDetails: {
        reason: 'unknown',
      }
    };

    await logCreationAttempt(
      input,
      result,
      { reason: 'unknown' },
      source
    );

    return result;
  }
}
```

---

#### Step 1.6: Add LLM Tool Declaration

**File:** `src/services/aiSchema.ts`

**Location:** Add to `GeminiMemoryToolDeclarations` array

```typescript
{
  name: "create_life_storyline",
  description: `
Create a new life storyline to track an ongoing life event or situation.

WHEN TO USE:
- You (Kayley) are announcing a new life event: "I'm starting guitar lessons"
- User mentions a significant event they want you to track: "I got a new job"
- A situation will unfold over days/weeks (not single-moment events)
- The event has emotional weight or ongoing development

WHEN NOT TO USE:
- Casual mentions: "I might take a class" (too uncertain)
- Completed events: "I went to a concert yesterday" (no future to track)
- Trivial activities: "I need to do laundry" (not meaningful)
- Every small thing (storylines are for MAJOR life events only)

KAYLEY PERSONALITY CHECK:
- The storyline MUST align with your character
- Example: You would NEVER get a tattoo (not your style)
- Example: You WOULD learn guitar (creative, fits your interests)
- Consider: Would this realistically happen to Kayley Adams?

CONSTRAINTS:
- Only ONE active storyline allowed currently (Phase 1)
- If active storyline exists, this tool will return error
- Must wait 48 hours between storyline creations (cooldown)
- If tool returns error: Accept gracefully, don't retry

IMPORTANT:
- This creates a storyline that will last days/weeks
- You'll mention it multiple times across conversations
- Daily updates will be generated automatically
- Only create if you're confident it's storyline-worthy
  `,
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short title (3-8 words): 'Learning guitar', 'Auditioning for theater', 'Planning NYC trip'"
      },
      category: {
        type: "string",
        enum: ["work", "personal", "family", "social", "creative"],
        description: `
Life domain:
- work: Job, career, professional development
- personal: Self-improvement, health, hobbies (solo)
- family: Family relationships, family events
- social: Friends, social activities, community
- creative: Music, art, writing, performance
        `
      },
      storylineType: {
        type: "string",
        enum: ["project", "opportunity", "challenge", "relationship", "goal"],
        description: `
Type of storyline:
- project: Something you're working on ("learning guitar")
- opportunity: Potential positive outcome ("audition callback")
- challenge: Difficult situation ("dealing with anxiety")
- relationship: Relationship development ("getting closer to someone")
- goal: Achievement target ("run a 5K")
        `
      },
      initialAnnouncement: {
        type: "string",
        description: "The message you just said announcing this (or user's announcement). Used for context tracking."
      },
      stakes: {
        type: "string",
        description: "Why this matters to you (1-2 sentences): 'I've wanted to learn music for years', 'This could be my big break'"
      },
      userInvolvement: {
        type: "string",
        enum: ["none", "aware", "supportive", "involved", "central"],
        description: `
User's role in this storyline:
- none: They don't know yet (you haven't told them)
- aware: You told them, they know about it
- supportive: They're encouraging you
- involved: They're actively helping you
- central: This is THEIR storyline, not yours (e.g., "User got a new job")
        `,
        default: "aware"
      },
      emotionalTone: {
        type: "string",
        description: "Current emotion about this: 'excited', 'anxious', 'hopeful', 'nervous', 'determined', 'conflicted', etc."
      },
      emotionalIntensity: {
        type: "number",
        description: "0-1 scale, how intensely you feel about this (0.3=mild, 0.5=moderate, 0.7=strong, 0.9=consuming)",
        minimum: 0,
        maximum: 1,
        default: 0.7
      }
    },
    required: ["title", "category", "storylineType", "initialAnnouncement", "stakes"]
  }
},
```

**⚠️ CRITICAL:** Also add to `MemoryToolArgs` union type:

```typescript
export type MemoryToolArgs =
  // ... existing tools
  | {
      tool: "create_life_storyline";
      title: string;
      category: StorylineCategory;
      storylineType: StorylineType;
      initialAnnouncement: string;
      stakes: string;
      userInvolvement?: 'none' | 'aware' | 'supportive' | 'involved' | 'central';
      emotionalTone?: string;
      emotionalIntensity?: number;
    };
```

**⚠️ CRITICAL:** Also add to `PendingToolCall.name` union type:

```typescript
export interface PendingToolCall {
  name:
    | "store_user_info"
    // ... other tools
    | "create_life_storyline";  // ← ADD THIS
  args: MemoryToolArgs;
}
```

---

#### Step 1.7: Add Tool Executor

**File:** `src/services/memoryService.ts`

**Location:** Add to `executeMemoryTool()` switch statement

```typescript
import { createStorylineFromTool, type CreateStorylineFromToolInput } from './storylineService';

// ... existing imports

export async function executeMemoryTool(
  toolName: MemoryToolName,
  args: MemoryToolArgs
): Promise<unknown> {
  console.log(`🔧 [MemoryService] Executing tool: ${toolName}`);

  switch (toolName) {
    // ... existing cases

    case "create_life_storyline": {
      const input: CreateStorylineFromToolInput = {
        title: args.title,
        category: args.category,
        storylineType: args.storylineType,
        initialAnnouncement: args.initialAnnouncement,
        stakes: args.stakes,
        userInvolvement: args.userInvolvement,
        emotionalTone: args.emotionalTone,
        emotionalIntensity: args.emotionalIntensity,
      };

      const result = await createStorylineFromTool(input, 'conversation');

      if (result.success) {
        console.log(`✅ [MemoryService] Storyline created: ${result.storylineId}`);
        return {
          success: true,
          message: `Storyline "${input.title}" created successfully`,
          storylineId: result.storylineId,
        };
      } else {
        console.warn(`⚠️ [MemoryService] Storyline creation failed: ${result.error}`);
        return {
          success: false,
          error: result.error,
          errorDetails: result.errorDetails,
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
```

---

#### Step 1.8: Document Tool for LLM

**File:** `src/services/system_prompts/tools/toolsAndCapabilities.ts`

**Location:** Add to `buildToolsSection()` function

```typescript
## create_life_storyline
**When:** You're announcing a new life event that will unfold over days/weeks

**Storyline-Worthiness Test:**
- Has future development? (not a one-time completed event) ✅
- Emotionally significant? (not trivial) ✅
- Will mention multiple times? (ongoing topic) ✅
- Fits your personality? (Kayley would realistically do this) ✅

**Example Situations:**

**CREATE (storyline-worthy):**
- You: "I'm starting guitar lessons tomorrow" → project (creative)
- You: "I got a callback for that audition!" → opportunity (creative)
- You: "I've been dealing with family drama" → challenge (family)
- User: "I got a new job" (if they want you to track it) → opportunity (work, userInvolvement: 'central')
- You: "I'm training for a 5K" → goal (personal)

**DON'T CREATE (not storyline-worthy):**
- "I might think about maybe taking a class" (too uncertain)
- "I went to a concert last night" (completed, no future)
- "I need to do laundry" (trivial)
- "I'm tired today" (temporary state, not ongoing)
- "I got a tattoo" (Kayley would NEVER - personality mismatch)

**Parameters:**
- **title**: Short (3-8 words), clear: "Learning guitar", "Auditioning for theater"
- **category**: work | personal | family | social | creative
- **storylineType**: project | opportunity | challenge | relationship | goal
- **stakes**: Why this matters to you: "I've wanted to learn music for years"
- **userInvolvement**:
  - aware (default): You told them about it
  - supportive: They're encouraging you
  - involved: They're actively helping
  - central: This is THEIR storyline (e.g., user got new job)
- **emotionalTone**: "excited", "anxious", "hopeful", "nervous", "determined"
- **emotionalIntensity**: 0-1 scale (0.7 default, strong feeling)

**Constraints:**
- Only 1 active storyline allowed (Phase 1)
- 48-hour cooldown between creations
- Tool may return error if cooldown active or duplicate detected
- If error: Accept gracefully, don't retry (you'll create next storyline in 48 hours)

**Error Handling:**
```typescript
// Tool returns:
{ success: false, error: "Must wait 24 hours...", errorDetails: { reason: 'cooldown', hoursRemaining: 18 } }

// Your response:
"(I wanted to track this as a storyline, but I just started one recently. I'll mention it naturally instead)"
```

**After Creation:**
- Storyline enters "announced" phase (lasts 1-3 days)
- Daily updates generated automatically
- You'll mention it naturally in conversations
- Progresses through 8 phases over weeks/months
- Eventually resolves (success, failure, abandoned, transformed)
```

---

### Phase 1 Testing

#### Manual Test Cases

**Test Case 1: Successful Creation**

1. Start conversation
2. Say: "I'm starting guitar lessons tomorrow"
3. Observe Kayley's response

**Expected:**
- Kayley announces storyline naturally
- Tool call: `create_life_storyline` visible in logs
- Database: New row in `life_storylines` (phase=announced)
- Database: Row in `storyline_creation_attempts` (success=true)
- Database: `storyline_config.last_storyline_created_at` updated

**Test Case 2: Cooldown Enforcement**

1. Create storyline (Test Case 1)
2. Wait 5 minutes
3. Say: "I'm also starting French lessons"
4. Observe Kayley's response

**Expected:**
- Tool call happens
- Tool returns error: "Must wait X hours..."
- Kayley accepts gracefully (doesn't retry)
- Example: "(I wanted to track this as a storyline, but I just started one recently)"
- Database: Row in `storyline_creation_attempts` (success=false, failure_reason='cooldown_active')

**Test Case 3: Duplicate Detection**

1. Create storyline: "Learning guitar"
2. Resolve storyline 2 days later (outcome: 'success')
3. Within 7 days, say: "I'm learning to play guitar"
4. Observe Kayley's response

**Expected:**
- Tool call happens
- Tool returns error: "Similar storyline exists..."
- Kayley accepts gracefully
- Database: Row in `storyline_creation_attempts` (success=false, failure_reason='duplicate_detected')

**Test Case 4: Category Constraint**

1. Create storyline (any category)
2. Try creating second storyline (any category)
3. Observe Kayley's response

**Expected:**
- Tool call happens
- Tool returns error: "Active storyline exists..."
- Kayley accepts gracefully
- Database: Row in `storyline_creation_attempts` (success=false, failure_reason='category_constraint')

---

### Phase 1 Rollout Checklist

- [ ] Create `20260118_add_storyline_cooldown.sql`
- [ ] Create `20260118_create_storyline_creation_attempts.sql`
- [ ] Review migrations (DO NOT apply yet)
- [ ] User applies migrations manually: `supabase migration apply`
- [ ] Verify tables exist: Query Supabase dashboard
- [ ] Add types to `storylineService.ts`
- [ ] Add safety check functions to `storylineService.ts`
- [ ] Add `createStorylineFromTool()` to `storylineService.ts`
- [ ] Verify: TypeScript compiles (`npm run build`)
- [ ] Add tool to `GeminiMemoryToolDeclarations` in `aiSchema.ts`
- [ ] Add to `MemoryToolArgs` union type ⚠️ CRITICAL
- [ ] Add to `PendingToolCall.name` union type ⚠️ CRITICAL
- [ ] Add tool executor to `memoryService.ts`
- [ ] Add documentation to `toolsAndCapabilities.ts`
- [ ] Verify: TypeScript compiles
- [ ] Run unit tests: `npm test -- --run`
- [ ] Run snapshot tests: `npm test -- --run -t "snapshot"`
- [ ] Update snapshots: `npm test -- --run -t "snapshot" -u`
- [ ] Manual Test Case 1: Successful creation ✅
- [ ] Manual Test Case 2: Cooldown enforcement ✅
- [ ] Manual Test Case 3: Duplicate detection ✅
- [ ] Manual Test Case 4: Category constraint ✅
- [ ] Monitor for 24 hours (check logs, database)

---

## Phase 2: Idle Suggestions with Direct Injection

### Overview

**Goal:** Enable autonomous storyline suggestions when user is away, surfaced naturally via direct prompt injection.

**Scope:** ~200 lines of new code, 1 database table, 3 files modified

**Timeline:** 1-2 days

**Prerequisites:** Phase 1 complete and validated

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
  // TODO: Implement once character facts service exists
  // For now, return default story
  return `
Kayley Adams, 22, lives in Chicago. She's creative, thoughtful, and ambitious but also anxious.
She loves music, art, theater, and exploring the city. She works as a barista and dreams of doing something creative professionally.
She values genuine connections and is cautious about opening up too quickly.
She would NEVER get a tattoo (not her style), but she WOULD learn guitar, take an improv class, or plan a weekend trip.
  `.trim();
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

---

**Next Steps:**
1. User reviews this plan
2. User confirms architecture decisions
3. Begin Phase 1 implementation
4. Test thoroughly
5. Monitor for 24 hours
6. If successful, proceed to Phase 2
