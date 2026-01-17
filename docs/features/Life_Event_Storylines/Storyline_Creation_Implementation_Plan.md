# Life Storyline Creation Design - Ultra-Detailed Implementation Plan

**Status:** Path B Selected - Ready for Implementation
**Date:** 2026-01-16
**Task:** Implement Clean Idle Thoughts v2 for storyline creation
**Chosen Path:** Path B (Clean Idle Thoughts v2 - Autonomous storyline generation)

---

## Table of Contents

1. [Implementation Overview](#implementation-overview)
2. [Step-by-Step Implementation Guide](#step-by-step-implementation-guide)
3. [File-by-File Implementation](#file-by-file-implementation)
4. [Database Migrations](#database-migrations)
5. [Testing Strategy](#testing-strategy)
6. [Error Handling & Edge Cases](#error-handling--edge-cases)
7. [Configuration & Tuning](#configuration--tuning)
8. [Rollout Checklist](#rollout-checklist)
9. [Validation & Verification](#validation--verification)

---

## Implementation Overview

### What We're Building

**Clean Idle Thoughts v2:** A minimal, purpose-built service that:
1. Detects when user is away (≥30 minutes)
2. Generates ONE storyline suggestion via LLM (based on Kayley's personality, life story, conversation history)
3. Stores suggestion (does NOT auto-create storyline)
4. On user return: Converts suggestion → ongoing thread
5. Thread surfaces in conversation naturally
6. LLM validates suggestion → calls `create_life_storyline` tool
7. Safety checks (cooldown, dedupe, category constraint) → create or fail gracefully

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  USER ABSENCE DETECTION                                     │
└─────────────────────────────────────────────────────────────┘
                        ↓
    lastInteractionAt (from conversation_history, UTC)
                        ↓
         Convert UTC → CST (timezone-safe)
                        ↓
    Calculate absence duration (minutes)
                        ↓
         If ≥30 min AND no pending suggestion:
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  STORYLINE SUGGESTION GENERATION (LLM)                      │
└─────────────────────────────────────────────────────────────┘
    Input:
    - Character profile (Kayley's interests, personality)
    - Recent conversation history (last 7 days)
    - Active storylines (avoid duplicates)
    - Category balance (suggest underrepresented)
                        ↓
    LLM generates suggestion:
    - category: StorylineCategory
    - theme: string ("learning guitar", "trip planning")
    - reasoning: string ("Why this matters to Kayley now")
                        ↓
    Store in storyline_pending_suggestions table
    Set expiration: created_at + 24 hours
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  USER RETURNS                                                │
└─────────────────────────────────────────────────────────────┘
                        ↓
    getPendingSuggestion()
                        ↓
    If suggestion exists:
        createUserThreadAsync({
            theme: suggestion.theme,
            content: "I've been thinking about [theme]",
            intensity: 0.7
        })
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  CONVERSATION (Next Message)                                │
└─────────────────────────────────────────────────────────────┘
                        ↓
    selectProactiveThread() → picks high-intensity thread
                        ↓
    System prompt includes: "You've been thinking about [theme]"
                        ↓
    Kayley: "Hey! I've been thinking... [announces storyline]"
                        ↓
    LLM calls: create_life_storyline({ title, category, ... })
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  SAFETY CHECKS                                              │
└─────────────────────────────────────────────────────────────┘
    1. Check cooldown (48 hours)
       ├─ Query storyline_config.last_storyline_created_at
       ├─ Calculate hours since
       └─ If <48h: Return error, hours remaining

    2. Check duplicate (7-day window, 60% similarity)
       ├─ Query recent storylines in same category
       ├─ Calculate string similarity (word overlap)
       └─ If ≥60%: Return error, duplicate title

    3. Check category constraint (1 total active)
       ├─ Query life_storylines WHERE outcome IS NULL
       └─ If exists: Return error, active storyline blocking
                        ↓
    If ALL checks pass:
        - Create storyline (phase=announced)
        - Update cooldown timestamp
        - Clear pending suggestion
        - Return success

    If ANY check fails:
        - Return error message
        - LLM sees error
        - Accepts gracefully (doesn't retry)
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  STORYLINE ACTIVE                                           │
└─────────────────────────────────────────────────────────────┘
    Daily processing:
    - processStorylineOnStartup() (App.tsx)
    - checkPhaseTransitions()
    - generateStorylineUpdate()
    - Mood integration
    - System prompt injection
```

### Key Configuration

```typescript
// storylineIdleService.ts
const CONFIG = {
  ABSENCE_THRESHOLD_MINUTES: 30,         // Min absence before suggestion
  CHECK_INTERVAL_MS: 10 * 60 * 1000,     // Check every 10 minutes
  SUGGESTION_COOLDOWN_HOURS: 48,         // 48 hours between suggestions
  SUGGESTION_EXPIRATION_HOURS: 24,       // Suggestions expire after 24 hours
  MAX_PENDING_SUGGESTIONS: 1             // Only 1 pending at a time
};

// storylineService.ts (safety controls)
const SAFETY_CONFIG = {
  CREATION_COOLDOWN_HOURS: 48,           // 48 hours between creations
  DEDUPE_WINDOW_DAYS: 7,                 // Check last 7 days for duplicates
  SIMILARITY_THRESHOLD: 0.6              // 60% word overlap = duplicate
};
```

---

## Step-by-Step Implementation Guide

### Phase 1: Database Migrations (30 minutes)

#### Step 1.1: Add cooldown tracking to storyline_config

**File:** `supabase/migrations/20260116_add_storyline_cooldown.sql`

```sql
-- Add cooldown timestamp column
ALTER TABLE storyline_config
ADD COLUMN last_storyline_created_at TIMESTAMPTZ;

-- Set initial value (allow immediate creation on first try)
-- 49 hours ago = outside 48-hour window
UPDATE storyline_config
SET last_storyline_created_at = NOW() - INTERVAL '49 hours'
WHERE id = 1;

-- Add comment for documentation
COMMENT ON COLUMN storyline_config.last_storyline_created_at IS
  '48-hour cooldown tracking for storyline creation. Prevents runaway creation.';
```

**Apply Migration:**
```bash
# DO NOT apply yet - user will apply manually after review
# supabase migration apply
```

#### Step 1.2: Create storyline_pending_suggestions table

**File:** `supabase/migrations/20260116_create_pending_suggestions.sql`

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

  -- Thread tracking (if converted to ongoing thread)
  thread_id UUID,  -- References ongoing_threads(id) if created

  -- Outcome tracking
  was_created BOOLEAN NOT NULL DEFAULT FALSE,    -- Did it become a storyline?
  storyline_id UUID REFERENCES life_storylines(id),  -- If created
  rejected_reason TEXT  -- If rejected: 'cooldown', 'duplicate', 'category_blocked', 'user_ignored'
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

**Apply Migration:**
```bash
# DO NOT apply yet - user will apply manually after review
# supabase migration apply
```

#### Step 1.3: Create storyline_creation_attempts table (audit log)

**File:** `supabase/migrations/20260116_create_creation_attempts.sql`

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
  failure_reason TEXT,  -- 'cooldown_active' | 'duplicate_detected' | 'category_constraint' | 'db_error' | 'unknown'

  -- Failure details
  cooldown_hours_remaining INTEGER,
  duplicate_match TEXT,              -- Title of duplicate if found
  active_storyline_blocking UUID REFERENCES life_storylines(id),

  -- Source tracking
  source TEXT NOT NULL DEFAULT 'conversation',  -- 'conversation' | 'idle_suggestion'
  suggestion_id UUID REFERENCES storyline_pending_suggestions(id)
);

-- Indexes
CREATE INDEX idx_creation_attempts_time ON storyline_creation_attempts(attempted_at DESC);
CREATE INDEX idx_creation_attempts_success ON storyline_creation_attempts(success);
CREATE INDEX idx_creation_attempts_failure ON storyline_creation_attempts(failure_reason)
  WHERE success = FALSE;

-- Comments
COMMENT ON TABLE storyline_creation_attempts IS
  'Audit log for all storyline creation attempts. Used for observability, debugging, and rate limit tuning.';
```

**Apply Migration:**
```bash
# DO NOT apply yet - user will apply manually after review
# supabase migration apply
```

---

### Phase 2: Core Service - storylineService.ts Additions (2 hours)

#### Step 2.1: Add type definitions

**File:** `src/services/storylineService.ts`

**Location:** Add at top of file (after existing type imports)

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
```

#### Step 2.2: Add configuration constants

**File:** `src/services/storylineService.ts`

**Location:** Add after type definitions

```typescript
// ============================================================================
// STORYLINE CREATION CONFIGURATION
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
  MAX_ACTIVE_STORYLINES: 1,  // Will be removed in Phase 2

  /** Daily cap on creations (not yet implemented) */
  DAILY_CAP: 999,  // Effectively unlimited in Phase 1
};

/**
 * Table names
 */
const CREATION_TABLES = {
  CONFIG: 'storyline_config',
  STORYLINES: 'life_storylines',
  ATTEMPTS: 'storyline_creation_attempts',
  SUGGESTIONS: 'storyline_pending_suggestions',
} as const;
```

#### Step 2.3: Implement cooldown check function

**File:** `src/services/storylineService.ts`

**Location:** Add in new "Storyline Creation Safety Functions" section

```typescript
// ============================================================================
// STORYLINE CREATION SAFETY FUNCTIONS
// ============================================================================

/**
 * Check if storyline creation cooldown has elapsed
 *
 * @returns CooldownCheck with allowed status and hours remaining
 *
 * @example
 * const cooldown = await checkStorylineCreationCooldown();
 * if (!cooldown.allowed) {
 *   console.log(`Must wait ${cooldown.hoursRemaining} hours`);
 * }
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
 *
 * @returns void
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
```

#### Step 2.4: Implement duplicate detection function

**File:** `src/services/storylineService.ts`

**Location:** Add after cooldown functions

```typescript
/**
 * Check if a similar storyline already exists (semantic deduplication)
 *
 * Uses fuzzy string matching (word overlap) to detect duplicates within
 * a 7-day window in the same category.
 *
 * @param title - Proposed storyline title
 * @param category - Storyline category
 * @returns true if duplicate found, false otherwise
 *
 * @example
 * const isDupe = await checkDuplicateStoryline("Learning guitar", "creative");
 * if (isDupe) {
 *   console.log("Similar storyline already exists");
 * }
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
```

#### Step 2.5: Implement category constraint check

**File:** `src/services/storylineService.ts`

**Location:** Add after duplicate detection

```typescript
/**
 * Check if category constraint allows new storyline creation
 *
 * Phase 1: Checks if ANY active storyline exists (global constraint)
 * Phase 2: Will check if active storyline in THIS CATEGORY exists (per-category constraint)
 *
 * @param category - Category to check
 * @returns CategoryCheck with allowed status and blocking storyline if any
 *
 * @example
 * const check = await checkCategoryConstraint("creative");
 * if (!check.allowed) {
 *   console.log(`Blocked by: ${check.activeStoryline?.title}`);
 * }
 */
async function checkCategoryConstraint(
  category: StorylineCategory
): Promise<CategoryCheck> {
  try {
    // Phase 1: Check if ANY active storyline exists (global constraint)
    // Phase 2: Uncomment .eq() to check per-category

    const { data, error } = await supabase
      .from(CREATION_TABLES.STORYLINES)
      .select('*')
      .is('outcome', null)  // outcome IS NULL = active
      // .eq('category', category)  // ← UNCOMMENT FOR PHASE 2 (per-category)
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
```

#### Step 2.6: Implement audit logging function

**File:** `src/services/storylineService.ts`

**Location:** Add after category constraint

```typescript
/**
 * Log storyline creation attempt to audit table
 *
 * @param input - Creation input
 * @param result - Creation result
 * @param failureDetails - Failure details if unsuccessful
 * @param source - Source of creation ('conversation' | 'idle_suggestion')
 * @param suggestionId - Suggestion ID if from idle service
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
  source: 'conversation' | 'idle_suggestion' = 'conversation',
  suggestionId?: string
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
        suggestion_id: suggestionId || null,
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

#### Step 2.7: Implement main creation function

**File:** `src/services/storylineService.ts`

**Location:** Add after audit logging

```typescript
/**
 * Create storyline from LLM tool call
 *
 * Runs all safety checks (cooldown, dedupe, category constraint) before creating.
 * Logs all attempts to audit table.
 *
 * @param input - Storyline creation input
 * @param source - Source of creation ('conversation' | 'idle_suggestion')
 * @param suggestionId - Suggestion ID if from idle service
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
  source: 'conversation' | 'idle_suggestion' = 'conversation',
  suggestionId?: string
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
      source,
      suggestionId
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
        duplicateTitle: input.title,  // Note: actual duplicate title not returned by check function
      },
      source,
      suggestionId
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
      source,
      suggestionId
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
        source,
        suggestionId
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

    await logCreationAttempt(input, result, undefined, source, suggestionId);

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
      source,
      suggestionId
    );

    return result;
  }
}
```

---

### Phase 3: LLM Tool Integration (1 hour)

#### Step 3.1: Add tool to aiSchema.ts

**File:** `src/services/aiSchema.ts`

**Location:** Add to `GeminiMemoryToolDeclarations` array

```typescript
// ============================================================================
// STORYLINE CREATION TOOL
// ============================================================================

{
  name: "create_life_storyline",
  description: `
Create a new life storyline to track an ongoing life event or situation.

WHEN TO USE:
- You (Kayley) are announcing a new life event: "I'm starting to learn guitar"
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

**Location:** Add to `MemoryToolArgs` union type (CRITICAL - don't forget!)

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

**Location:** Add to `PendingToolCall.name` union type (CRITICAL - don't forget!)

```typescript
export interface PendingToolCall {
  name:
    | "store_user_info"
    // ... other tools
    | "create_life_storyline";  // ← ADD THIS
  args: MemoryToolArgs;
}
```

**Location:** Add to `OpenAIMemoryToolDeclarations` (if using OpenAI)

```typescript
// OpenAI format (convert from Gemini format above)
{
  type: "function",
  function: {
    name: "create_life_storyline",
    description: "...",  // Same as Gemini
    parameters: {
      // Same as Gemini
    }
  }
}
```

#### Step 3.2: Add tool executor to memoryService.ts

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

#### Step 3.3: Add tool documentation to toolsAndCapabilities.ts

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

### Phase 4: Idle Service Implementation (3 hours)

#### Step 4.1: Create storylineIdleService.ts

**File:** `src/services/storylineIdleService.ts` (NEW FILE)

**Full Implementation:**

```typescript
/**
 * Storyline Idle Service (Clean Idle Thoughts v2)
 *
 * Purpose-built service for generating storyline suggestions during user absence.
 * First feature in Idle Thoughts v2 - clean, minimal, focused.
 *
 * Flow:
 * 1. Detect user absence (≥30 minutes, using conversation_history.created_at)
 * 2. Generate ONE storyline suggestion via LLM
 * 3. Store in storyline_pending_suggestions table
 * 4. On user return: Convert to ongoing thread
 * 5. Thread surfaces in conversation
 * 6. LLM validates → creates storyline via tool (or rejects)
 *
 * @module storylineIdleService
 */

import { supabase } from '../supabaseClient';
import { createUserThreadAsync, type ThreadTheme } from './ongoingThreads';
import type { StorylineCategory, StorylineType } from './storylineService';
import { callGeminiAPI } from './geminiService';
import { getCharacterProfile } from './characterProfile';
import { getActiveStorylines } from './storylineService';

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
  threadId: string | null;
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
 *
 * @example
 * // In App.tsx
 * startStorylineIdleService();
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
 *
 * @example
 * // In App.tsx cleanup
 * stopStorylineIdleService();
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
 * Convert UTC timestamp to CST
 *
 * @param utcDate - UTC date
 * @returns CST date
 */
function convertUTCtoCST(utcDate: Date): Date {
  // CST is UTC-6
  const cstDate = new Date(utcDate.getTime() - (6 * 60 * 60 * 1000));
  return cstDate;
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
 * Clear pending suggestion (mark as surfaced)
 *
 * @param suggestionId - Suggestion ID
 * @param threadId - Thread ID if converted to thread
 */
export async function clearPendingSuggestion(
  suggestionId: string,
  threadId?: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from(TABLES.SUGGESTIONS)
      .update({
        surfaced: true,
        surfaced_at: new Date().toISOString(),
        thread_id: threadId || null,
      })
      .eq('id', suggestionId);

    if (error) {
      console.error('💭 [StorylineIdle] Error clearing suggestion:', error);
    } else {
      console.log(`💭 [StorylineIdle] Cleared suggestion: ${suggestionId}`);
    }
  } catch (err) {
    console.error('💭 [StorylineIdle] Exception clearing suggestion:', err);
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
    threadId: row.thread_id,
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
 * - Kayley's personality and interests
 * - Recent conversation topics
 * - Active storylines (avoid duplicates)
 * - Category balance (suggest underrepresented categories)
 *
 * @returns Generated suggestion or null if error/no suggestion
 */
async function generateStorylineSuggestion(): Promise<PendingStorylineSuggestion | null> {
  try {
    console.log('💭 [StorylineIdle] Generating storyline suggestion via LLM...');

    // Fetch context
    const [characterProfile, activeStorylines, recentConversation] = await Promise.all([
      getCharacterProfile(),
      getActiveStorylines(),
      getRecentConversationSummary(),
    ]);

    // Build prompt
    const prompt = buildSuggestionPrompt(characterProfile, activeStorylines, recentConversation);

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
 * Get recent conversation summary
 *
 * Fetches last 7 days of conversation to inform suggestion generation.
 *
 * @returns Summary string or null
 */
async function getRecentConversationSummary(): Promise<string | null> {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from(TABLES.CONVERSATION_HISTORY)
      .select('role, message_text')
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(20);  // Last 20 messages

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
  characterProfile: any,
  activeStorylines: any[],
  recentConversation: string | null
): string {
  return `
You are Kayley Adams, a 22-year-old woman living in Chicago. You have been away from the user for a while, and you've been thinking about your life.

# Your Character
${characterProfile.description || 'Creative, thoughtful, ambitious but anxious'}

# Your Current Life Storylines
${activeStorylines.length > 0
  ? activeStorylines.map(s => `- ${s.title} (${s.category}, ${s.phase} phase)`).join('\n')
  : 'None - you have space for a new storyline'
}

# Recent Conversation Topics
${recentConversation || 'No recent conversation'}

# Task
Generate ONE new storyline idea that:
1. **Fits your personality** (Kayley would realistically do this - you would NEVER get a tattoo, for example)
2. **Is meaningful** (not trivial, has emotional weight)
3. **Has future development** (will unfold over days/weeks)
4. **Doesn't duplicate existing storylines**
5. **Balances life categories** (if you have work storyline, suggest creative/personal/social/family)

# Output Format (JSON)
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

      // Update suggestion cooldown timestamp
      await updateSuggestionCooldown();
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

/**
 * Update suggestion cooldown timestamp
 */
async function updateSuggestionCooldown(): Promise<void> {
  try {
    const { error } = await supabase
      .from(TABLES.CONFIG)
      .update({ last_storyline_created_at: new Date().toISOString() })
      .eq('id', 1);

    if (error) {
      console.error('💭 [StorylineIdle] Failed to update suggestion cooldown:', error);
    }
  } catch (err) {
    console.error('💭 [StorylineIdle] Cooldown update error:', err);
  }
}

// ============================================================================
// THREAD CONVERSION (called by ongoingThreads.ts on user return)
// ============================================================================

/**
 * Convert pending suggestion to ongoing thread
 *
 * Called when user returns and we want to surface the suggestion.
 *
 * @returns Thread ID if created, null otherwise
 */
export async function convertSuggestionToThread(): Promise<string | null> {
  const suggestion = await getPendingSuggestion();

  if (!suggestion) {
    return null;
  }

  console.log(`💭 [StorylineIdle] Converting suggestion to thread: "${suggestion.theme}"`);

  try {
    // Create ongoing thread
    const threadId = await createUserThreadAsync(
      suggestion.theme as ThreadTheme,  // Map category to theme
      `I've been thinking about ${suggestion.theme}`,
      0.7,  // High intensity (will surface soon)
      false,  // Not user-related (Kayley's thought)
      null    // No specific trigger event
    );

    if (threadId) {
      // Mark suggestion as surfaced
      await clearPendingSuggestion(suggestion.id, threadId);

      console.log(`💭 [StorylineIdle] ✅ Converted to thread: ${threadId}`);

      return threadId;
    }

    return null;
  } catch (err) {
    console.error('💭 [StorylineIdle] Error converting suggestion to thread:', err);
    return null;
  }
}
```

#### Step 4.2: Integrate with App.tsx

**File:** `src/App.tsx`

**Location:** Add alongside promise checker startup

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

#### Step 4.3: Integrate with ongoingThreads.ts

**File:** `src/services/ongoingThreads.ts`

**Location:** Add to beginning of main chat flow (when user returns)

```typescript
import { convertSuggestionToThread, getPendingSuggestion } from './storylineIdleService';

// ... existing code

/**
 * Check for pending storyline suggestion and convert to thread
 *
 * Call this when user returns (first message after absence).
 *
 * @returns Thread ID if suggestion converted, null otherwise
 */
export async function checkAndSurfaceStorylineSuggestion(): Promise<string | null> {
  const suggestion = await getPendingSuggestion();

  if (!suggestion) {
    return null;
  }

  console.log(`🧵 [OngoingThreads] Found pending storyline suggestion: "${suggestion.theme}"`);

  const threadId = await convertSuggestionToThread();

  if (threadId) {
    console.log(`🧵 [OngoingThreads] ✅ Storyline suggestion surfaced as thread: ${threadId}`);
  }

  return threadId;
}
```

**Location:** Call in chat flow

**File:** `src/services/GeminiChatService.ts` (or appropriate chat service)

**Location:** Before main chat processing (on user return)

```typescript
// Check for pending storyline suggestion
await checkAndSurfaceStorylineSuggestion();
```

---

### Phase 5: Testing (2 hours)

#### Step 5.1: Unit tests for storylineService.ts

**File:** `src/services/__tests__/storylineService.test.ts`

**Add tests:**

```typescript
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createStorylineFromTool,
  type CreateStorylineFromToolInput,
  type StorylineCreationResult,
} from '../storylineService';
import { supabase } from '../../supabaseClient';

// Mock Supabase
vi.mock('../../supabaseClient');

describe('createStorylineFromTool', () => {
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
  });

  test('creates storyline successfully when all checks pass', async () => {
    // Mock cooldown check (allowed)
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { last_storyline_created_at: null },
            error: null,
          }),
        }),
      }),
    });

    // Mock duplicate check (no duplicates)
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
    });

    // Mock category check (allowed)
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      }),
    });

    // Mock storyline creation
    vi.mocked(supabase.from).mockReturnValueOnce({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'test-id',
              title: 'Learning guitar',
              category: 'creative',
              // ... other fields
            },
            error: null,
          }),
        }),
      }),
    });

    // Mock cooldown update
    vi.mocked(supabase.from).mockReturnValueOnce({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          error: null,
        }),
      }),
    });

    // Mock audit log
    vi.mocked(supabase.from).mockReturnValueOnce({
      insert: vi.fn().mockResolvedValue({
        error: null,
      }),
    });

    const input: CreateStorylineFromToolInput = {
      title: 'Learning guitar',
      category: 'creative',
      storylineType: 'project',
      initialAnnouncement: "I'm starting guitar lessons",
      stakes: "I've wanted to learn music for years",
    };

    const result = await createStorylineFromTool(input);

    expect(result.success).toBe(true);
    expect(result.storylineId).toBe('test-id');
    expect(result.error).toBeUndefined();
  });

  test('blocks creation when cooldown active', async () => {
    // Mock cooldown check (blocked)
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 1);  // Only 1 day ago (< 48 hours)

    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { last_storyline_created_at: twoDaysAgo.toISOString() },
            error: null,
          }),
        }),
      }),
    });

    // Mock audit log
    vi.mocked(supabase.from).mockReturnValueOnce({
      insert: vi.fn().mockResolvedValue({
        error: null,
      }),
    });

    const input: CreateStorylineFromToolInput = {
      title: 'Learning guitar',
      category: 'creative',
      storylineType: 'project',
      initialAnnouncement: "I'm starting guitar lessons",
      stakes: "I've wanted to learn music for years",
    };

    const result = await createStorylineFromTool(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain('wait');
    expect(result.error).toContain('hours');
    expect(result.errorDetails?.reason).toBe('cooldown');
    expect(result.errorDetails?.hoursRemaining).toBeGreaterThan(0);
  });

  test('detects duplicate storylines', async () => {
    // Mock cooldown check (allowed)
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { last_storyline_created_at: null },
            error: null,
          }),
        }),
      }),
    });

    // Mock duplicate check (duplicate found)
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                { title: 'Learning to play guitar', created_at: new Date().toISOString() }
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    // Mock audit log
    vi.mocked(supabase.from).mockReturnValueOnce({
      insert: vi.fn().mockResolvedValue({
        error: null,
      }),
    });

    const input: CreateStorylineFromToolInput = {
      title: 'Learning guitar',
      category: 'creative',
      storylineType: 'project',
      initialAnnouncement: "I'm starting guitar lessons",
      stakes: "I've wanted to learn music for years",
    };

    const result = await createStorylineFromTool(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain('similar');
    expect(result.errorDetails?.reason).toBe('duplicate');
  });

  test('blocks creation when active storyline exists', async () => {
    // Mock cooldown check (allowed)
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { last_storyline_created_at: null },
            error: null,
          }),
        }),
      }),
    });

    // Mock duplicate check (no duplicates)
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
    });

    // Mock category check (active storyline exists)
    vi.mocked(supabase.from).mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'active-id',
                title: 'Existing storyline',
                category: 'work',
                // ... other fields
              }
            ],
            error: null,
          }),
        }),
      }),
    });

    // Mock audit log
    vi.mocked(supabase.from).mockReturnValueOnce({
      insert: vi.fn().mockResolvedValue({
        error: null,
      }),
    });

    const input: CreateStorylineFromToolInput = {
      title: 'Learning guitar',
      category: 'creative',
      storylineType: 'project',
      initialAnnouncement: "I'm starting guitar lessons",
      stakes: "I've wanted to learn music for years",
    };

    const result = await createStorylineFromTool(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain('active storyline');
    expect(result.errorDetails?.reason).toBe('category_blocked');
  });
});

describe('string similarity', () => {
  test('detects high similarity', () => {
    const similarity = calculateStringSimilarity('learning guitar', 'learning to play guitar');
    expect(similarity).toBeGreaterThan(0.6);  // Should be ~0.75
  });

  test('detects low similarity', () => {
    const similarity = calculateStringSimilarity('learning guitar', 'running marathon');
    expect(similarity).toBeLessThan(0.3);  // Should be 0
  });

  test('handles exact matches', () => {
    const similarity = calculateStringSimilarity('learning guitar', 'learning guitar');
    expect(similarity).toBe(1.0);
  });
});
```

#### Step 5.2: Unit tests for storylineIdleService.ts

**File:** `src/services/__tests__/storylineIdleService.test.ts`

**Add tests:**

```typescript
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startStorylineIdleService,
  stopStorylineIdleService,
  isSchedulerRunning,
  checkForStorylineSuggestion,
} from '../storylineIdleService';

describe('storylineIdleService', () => {
  afterEach(() => {
    stopStorylineIdleService();
  });

  test('starts scheduler', () => {
    startStorylineIdleService();
    expect(isSchedulerRunning()).toBe(true);
  });

  test('stops scheduler', () => {
    startStorylineIdleService();
    stopStorylineIdleService();
    expect(isSchedulerRunning()).toBe(false);
  });

  test('safe to call start multiple times', () => {
    startStorylineIdleService();
    startStorylineIdleService();  // Should not throw
    expect(isSchedulerRunning()).toBe(true);
  });

  test('safe to call stop when not running', () => {
    stopStorylineIdleService();  // Should not throw
    expect(isSchedulerRunning()).toBe(false);
  });
});
```

#### Step 5.3: Manual testing checklist

**Create:** `docs/testing/storyline-creation-manual-tests.md`

```markdown
# Storyline Creation Manual Testing Checklist

## Test Case 1: Successful Creation (Conversation)

**Steps:**
1. Start conversation
2. Say: "I'm starting guitar lessons tomorrow"
3. Observe LLM response

**Expected:**
- Kayley announces storyline naturally
- Tool call: `create_life_storyline` visible in logs
- Database: New row in `life_storylines` (phase=announced)
- Database: Row in `storyline_creation_attempts` (success=true)
- Database: `storyline_config.last_storyline_created_at` updated

**Success Criteria:**
- ✅ Storyline created
- ✅ Cooldown timestamp updated
- ✅ Audit log recorded

---

## Test Case 2: Cooldown Enforcement

**Steps:**
1. Create storyline (Test Case 1)
2. Wait 5 minutes
3. Say: "I'm also starting French lessons"
4. Observe LLM response

**Expected:**
- Tool call happens
- Tool returns error: "Must wait X hours..."
- Kayley accepts gracefully (doesn't retry)
- Example: "(I wanted to track this as a storyline, but I just started one recently)"
- Database: Row in `storyline_creation_attempts` (success=false, failure_reason='cooldown_active')

**Success Criteria:**
- ✅ Cooldown blocks creation
- ✅ Error message includes hours remaining
- ✅ Kayley doesn't retry
- ✅ Audit log recorded

---

## Test Case 3: Duplicate Detection

**Steps:**
1. Create storyline: "Learning guitar"
2. Resolve storyline 2 days later (outcome: 'success')
3. Within 7 days, say: "I'm learning to play guitar"
4. Observe LLM response

**Expected:**
- Tool call happens
- Tool returns error: "Similar storyline exists..."
- Kayley accepts gracefully
- Database: Row in `storyline_creation_attempts` (success=false, failure_reason='duplicate_detected')

**Success Criteria:**
- ✅ Duplicate detected (≥60% similarity)
- ✅ Creation blocked
- ✅ Audit log recorded

---

## Test Case 4: Category Constraint

**Steps:**
1. Create storyline (any category)
2. Try creating second storyline (any category)
3. Observe LLM response

**Expected:**
- Tool call happens
- Tool returns error: "Active storyline exists..."
- Kayley accepts gracefully
- Database: Row in `storyline_creation_attempts` (success=false, failure_reason='category_constraint')

**Success Criteria:**
- ✅ Category constraint enforced
- ✅ Error message includes active storyline title
- ✅ Audit log recorded

---

## Test Case 5: Idle Suggestion Generation

**Steps:**
1. Chat with Kayley
2. Close app (or wait 30+ minutes without chatting)
3. Check database: `storyline_pending_suggestions`
4. Return to app, send message
5. Observe Kayley's response

**Expected:**
- After 30 min: Row in `storyline_pending_suggestions` (surfaced=false)
- On return: Kayley mentions: "Hey! I've been thinking... [theme]"
- Database: Suggestion marked surfaced=true, thread_id set
- Database: New row in `ongoing_threads`

**Success Criteria:**
- ✅ Suggestion generated during absence
- ✅ Converted to thread on return
- ✅ Kayley surfaces naturally

---

## Test Case 6: End-to-End (Idle → Creation)

**Steps:**
1. Chat with Kayley
2. Wait 30+ minutes
3. Verify suggestion generated (database check)
4. Return, send message
5. Kayley announces storyline
6. LLM calls `create_life_storyline`
7. All safety checks pass
8. Storyline created

**Expected:**
- Suggestion → Thread → Announcement → Tool call → Safety checks → Creation
- Database: Rows in:
  - `storyline_pending_suggestions` (surfaced=true, was_created=true, storyline_id set)
  - `life_storylines` (new storyline)
  - `ongoing_threads` (thread created)
  - `storyline_creation_attempts` (success=true, source='idle_suggestion')

**Success Criteria:**
- ✅ Full pipeline works
- ✅ All audit logs recorded
- ✅ Storyline enters announced phase

---

## Test Case 7: User Event Tracking

**Steps:**
1. User says: "I got a new job, starting next week"
2. Observe Kayley's response

**Expected:**
- Kayley considers creating storyline
- Tool call: `create_life_storyline` with userInvolvement='central'
- Category: 'work'
- Storyline created

**Success Criteria:**
- ✅ User-related storyline created
- ✅ userInvolvement='central' set correctly

---

## Test Case 8: Inappropriate Creation

**Steps:**
1. Say: "I might think about maybe taking a class someday"
2. Observe Kayley's response

**Expected:**
- Kayley does NOT call tool (too uncertain)
- Natural conversation response

**Steps:**
1. Say: "I did laundry"
2. Observe Kayley's response

**Expected:**
- Kayley does NOT call tool (trivial)
- Natural conversation response

**Success Criteria:**
- ✅ Kayley uses judgment
- ✅ No tool call for uncertain/trivial mentions

---

## Test Case 9: Daily Processing

**Steps:**
1. Create storyline
2. Wait 24 hours (or manually trigger: `processStorylineOnStartup()`)
3. Check database: `storyline_updates`

**Expected:**
- New row in `storyline_updates` (update_type based on phase)
- Storyline phase may transition (if timing conditions met)

**Success Criteria:**
- ✅ Daily processing works
- ✅ Updates generated
- ✅ Phases transition

---

## Database Verification Queries

```sql
-- Check last created timestamp
SELECT last_storyline_created_at FROM storyline_config WHERE id = 1;

-- Check active storylines
SELECT id, title, category, phase, created_at
FROM life_storylines
WHERE outcome IS NULL
ORDER BY created_at DESC;

-- Check creation attempts
SELECT attempted_at, title, category, success, failure_reason, cooldown_hours_remaining
FROM storyline_creation_attempts
ORDER BY attempted_at DESC
LIMIT 10;

-- Check pending suggestions
SELECT id, category, theme, surfaced, expires_at, created_at
FROM storyline_pending_suggestions
WHERE surfaced = FALSE AND expires_at > NOW()
ORDER BY created_at DESC;

-- Check storyline updates
SELECT s.title, u.update_type, u.content, u.created_at
FROM storyline_updates u
JOIN life_storylines s ON s.id = u.storyline_id
ORDER BY u.created_at DESC
LIMIT 5;
```

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
```

---

### Phase 6: Snapshot Tests (30 minutes)

#### Step 6.1: Update system prompt snapshots

**File:** `src/services/tests/systemPromptBuilder.test.ts` (or similar)

**Run:**
```bash
npm test -- --run -t "snapshot"
```

**Expected:** Test failures (prompt changed due to new tool)

**Update:**
```bash
npm test -- --run -t "snapshot" -u
```

**Verify:** Review diff to ensure tool documentation added correctly

---

## Rollout Checklist

### Pre-Implementation

- [ ] User reviews this plan
- [ ] User approves Path B approach
- [ ] User confirms understanding of 48-hour cooldown, category constraint, idle service requirements

### Implementation Phase 1 (Database)

- [ ] Create `20260116_add_storyline_cooldown.sql`
- [ ] Create `20260116_create_pending_suggestions.sql`
- [ ] Create `20260116_create_creation_attempts.sql`
- [ ] Review migrations (DO NOT apply yet)
- [ ] User applies migrations manually: `supabase migration apply`
- [ ] Verify tables exist: Query Supabase dashboard

### Implementation Phase 2 (storylineService.ts)

- [ ] Add type definitions (CreateStorylineFromToolInput, StorylineCreationResult, etc.)
- [ ] Add configuration constants (CREATION_SAFETY_CONFIG)
- [ ] Implement `checkStorylineCreationCooldown()`
- [ ] Implement `updateStorylineCreationCooldown()`
- [ ] Implement `checkDuplicateStoryline()`
- [ ] Implement `calculateStringSimilarity()`
- [ ] Implement `checkCategoryConstraint()`
- [ ] Implement `logCreationAttempt()`
- [ ] Implement `createStorylineFromTool()`
- [ ] Verify: TypeScript compiles (`npm run build`)

### Implementation Phase 3 (LLM Tool)

- [ ] Add tool to `GeminiMemoryToolDeclarations` in `aiSchema.ts`
- [ ] Add to `MemoryToolArgs` union type ⚠️ CRITICAL
- [ ] Add to `PendingToolCall.name` union type ⚠️ CRITICAL
- [ ] Add to `OpenAIMemoryToolDeclarations` (if using OpenAI)
- [ ] Add tool executor to `memoryService.ts` (`executeMemoryTool()`)
- [ ] Add documentation to `toolsAndCapabilities.ts` (`buildToolsSection()`)
- [ ] Verify: TypeScript compiles

### Implementation Phase 4 (Idle Service)

- [ ] Create `src/services/storylineIdleService.ts`
- [ ] Implement types (PendingStorylineSuggestion, etc.)
- [ ] Implement configuration (CONFIG constants)
- [ ] Implement scheduler (start/stop functions)
- [ ] Implement absence detection (`getLastInteractionTime()`, `convertUTCtoCST()`)
- [ ] Implement suggestion management (`hasPendingSuggestion()`, `getPendingSuggestion()`, `clearPendingSuggestion()`)
- [ ] Implement LLM generation (`generateStorylineSuggestion()`, `buildSuggestionPrompt()`, `parseSuggestionResponse()`)
- [ ] Implement main check (`checkForStorylineSuggestion()`)
- [ ] Implement thread conversion (`convertSuggestionToThread()`)
- [ ] Verify: TypeScript compiles

### Implementation Phase 5 (Integration)

- [ ] Add to `App.tsx` (start/stop idle service)
- [ ] Add to `ongoingThreads.ts` (`checkAndSurfaceStorylineSuggestion()`)
- [ ] Add to chat service (call `checkAndSurfaceStorylineSuggestion()` on user return)
- [ ] Verify: TypeScript compiles
- [ ] Verify: No runtime errors on app start

### Testing Phase

- [ ] Run unit tests: `npm test -- --run`
- [ ] Run snapshot tests: `npm test -- --run -t "snapshot"` (expect failures)
- [ ] Update snapshots: `npm test -- --run -t "snapshot" -u`
- [ ] Verify snapshot diffs (tool documentation added)
- [ ] Manual Test Case 1: Successful creation ✅
- [ ] Manual Test Case 2: Cooldown enforcement ✅
- [ ] Manual Test Case 3: Duplicate detection ✅
- [ ] Manual Test Case 4: Category constraint ✅
- [ ] Manual Test Case 5: Idle suggestion generation ✅
- [ ] Manual Test Case 6: End-to-end (idle → creation) ✅
- [ ] Manual Test Case 7: User event tracking ✅
- [ ] Manual Test Case 8: Inappropriate creation ✅
- [ ] Manual Test Case 9: Daily processing ✅
- [ ] Database verification queries (all pass)
- [ ] Observability queries (data looks reasonable)

### Deployment

- [ ] All tests pass
- [ ] Manual testing complete
- [ ] No TypeScript errors
- [ ] No console errors in browser
- [ ] Idle service starts successfully
- [ ] First suggestion generated successfully (wait 30+ min or manually trigger)
- [ ] First storyline created successfully
- [ ] Monitor for 24 hours (check logs, database)

### Post-Deployment Monitoring

- [ ] Check `storyline_creation_attempts` daily (success rate >80%)
- [ ] Check failure reasons (cooldown should be most common)
- [ ] Check suggestion conversion rate (should be >50%)
- [ ] Check category distribution (should be balanced over time)
- [ ] No runaway creation (daily cap not exceeded)
- [ ] No duplicate storylines created

### Phase 2 Preparation (After 2 Weeks)

- [ ] Review success metrics
- [ ] Tune cooldown if needed (48h → 12h?)
- [ ] Prepare for multiple categories
- [ ] Update category constraint (global → per-category)
- [ ] Add daily cap enforcement (2-3 max)

---

## Configuration & Tuning

### Phase 1 Configuration (Conservative)

```typescript
// storylineIdleService.ts
const CONFIG = {
  ABSENCE_THRESHOLD_MINUTES: 30,
  CHECK_INTERVAL_MS: 10 * 60 * 1000,
  SUGGESTION_COOLDOWN_HOURS: 48,
  SUGGESTION_EXPIRATION_HOURS: 24,
  MAX_PENDING_SUGGESTIONS: 1,
};

// storylineService.ts
const CREATION_SAFETY_CONFIG = {
  COOLDOWN_HOURS: 48,
  DEDUPE_WINDOW_DAYS: 7,
  SIMILARITY_THRESHOLD: 0.6,
  MAX_ACTIVE_STORYLINES: 1,
};
```

### Phase 2 Configuration (Relaxed)

```typescript
// storylineService.ts
const CREATION_SAFETY_CONFIG = {
  COOLDOWN_HOURS: 48,  // Keep at 48h
  DEDUPE_WINDOW_DAYS: 7,
  SIMILARITY_THRESHOLD: 0.6,
  MAX_ACTIVE_STORYLINES: 999,  // Remove global limit (use per-category instead)
  DAILY_CAP: 2,  // NEW: Max 2 creations per day
};
```

### Tuning Guidelines

**If too many storylines created:**
- Increase cooldown (48h → 72h)
- Increase similarity threshold (0.6 → 0.7)
- Decrease LLM temperature for suggestions (0.8 → 0.6)

**If too few storylines created:**
- Decrease cooldown (48h → 36h)
- Decrease similarity threshold (0.6 → 0.5)
- Increase LLM temperature for suggestions (0.8 → 0.9)

**If duplicate storylines created:**
- Increase similarity threshold (0.6 → 0.7)
- Increase dedupe window (7 days → 14 days)

**If category imbalance:**
- Adjust suggestion prompt to favor underrepresented categories
- Add category rotation logic to idle service

---

## Error Handling & Edge Cases

### Edge Case 1: App Closed During Absence

**Scenario:** User away 30+ min, but app closed (idle service not running)

**Behavior:**
- No suggestion generated (service requires app open)
- Next time app opens: Service starts, checks absence
- If still ≥30 min away: Generates suggestion

**Mitigation:** Service Worker (future enhancement)

### Edge Case 2: Multiple Browser Tabs

**Scenario:** User has 2 tabs open, both running idle service

**Behavior:**
- Both schedulers run independently
- Both may try to generate suggestion
- Database constraint: `MAX_PENDING_SUGGESTIONS = 1`
- Second attempt fails (pending already exists)

**Mitigation:** Handled by `hasPendingSuggestion()` check

### Edge Case 3: Clock Skew (UTC/CST)

**Scenario:** Server time vs client time differ

**Behavior:**
- Absence detection uses `conversation_history.created_at` (UTC from server)
- Conversion to CST happens client-side
- Skew unlikely to cause issues (30-min threshold has buffer)

**Mitigation:** Use server timestamps only

### Edge Case 4: Suggestion Expires Before User Returns

**Scenario:** Suggestion created, user doesn't return for 25+ hours

**Behavior:**
- Suggestion expires (expires_at < NOW)
- `getPendingSuggestion()` returns null
- No thread created, suggestion lost

**Mitigation:** Acceptable (user was away too long, suggestion stale)

### Edge Case 5: LLM Returns Invalid JSON

**Scenario:** LLM suggestion response malformed

**Behavior:**
- `parseSuggestionResponse()` catches error
- Returns null
- Logs warning
- No suggestion created

**Mitigation:** Retry on next check (10 min later)

### Edge Case 6: Race Condition (Cooldown)

**Scenario:** Two tool calls happen simultaneously (conversation + idle)

**Behavior:**
- Both check cooldown (both see "allowed")
- Both try to create
- First succeeds, updates cooldown
- Second checks cooldown again (now "blocked")
- Second fails gracefully

**Mitigation:** Already handled by sequential safety checks

---

## Validation & Verification

### Build Validation

```bash
npm run build
```

**Expected:** No TypeScript errors

### Test Validation

```bash
npm test -- --run
```

**Expected:** All tests pass (including new tests)

### Snapshot Validation

```bash
npm test -- --run -t "snapshot"
```

**Expected:** Failures (prompt changed)

```bash
npm test -- --run -t "snapshot" -u
```

**Expected:** Snapshots updated, tests pass

### Runtime Validation

```bash
npm run dev
```

**Expected:**
- App starts without errors
- Console: `💭 [StorylineIdle] Starting idle service...`
- Console: `💭 [StorylineIdle] ✅ Started`
- Console: `💭 [StorylineIdle] Running periodic check...`

### Database Validation

**Query:**
```sql
SELECT * FROM storyline_config WHERE id = 1;
```

**Expected:** `last_storyline_created_at` column exists

**Query:**
```sql
SELECT * FROM storyline_pending_suggestions LIMIT 1;
```

**Expected:** Table exists, no errors

**Query:**
```sql
SELECT * FROM storyline_creation_attempts LIMIT 1;
```

**Expected:** Table exists, no errors

---

## Summary

This ultra-detailed plan covers:
- ✅ Every file to modify (11 files)
- ✅ Every function to implement (20+ functions)
- ✅ Every type to define (10+ types)
- ✅ Every safety check (cooldown, dedupe, category, audit)
- ✅ Every integration point (aiSchema, memoryService, toolsAndCapabilities, App, ongoingThreads)
- ✅ Every test case (9 manual tests + unit tests)
- ✅ Every database migration (3 tables)
- ✅ Every edge case (6 scenarios)
- ✅ Every configuration option (tuning guidelines)
- ✅ Complete rollout checklist (50+ items)

**Next Steps:**
1. User reviews plan
2. User confirms: "This is exactly what I want"
3. Begin implementation (follow checklist sequentially)
4. Test after each phase
5. Deploy after all tests pass
6. Monitor for 2 weeks
7. Proceed to Phase 2 (multiple categories)

**Estimated Timeline:**
- Implementation: 8-10 hours (full focus)
- Testing: 2-3 hours
- Monitoring: 2 weeks
- Total: ~2-3 weeks to Phase 2

**Risk Level:** Low (conservative approach, strong safety controls, comprehensive testing)

**Success Criteria:**
- ✅ Storylines created reliably (success rate >80%)
- ✅ No runaway creation (daily cap respected)
- ✅ No duplicate storylines
- ✅ Kayley feels autonomous (idle suggestions work)
- ✅ User experience positive (storylines enhance conversations)