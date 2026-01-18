# Phase 2: Idle Storyline Suggestions - Implementation Prompt

**Status:** Ready to implement
**Prerequisites:** Phase 1 complete ✅
**Estimated Complexity:** Medium
**Files to modify:** 2-3 files, ~500 lines of code

---

## Context: What is Phase 2?

Phase 2 adds **idle-time storyline suggestions** - the system proactively suggests storylines when Kayley has been idle for a while and doesn't have an active storyline. This makes her life feel more organic and alive even when the user isn't actively creating storylines.

**User interaction:** Kayley might say during an idle breaker: *"Been thinking about signing up for that pottery class... should I make it a thing?"*

**User can:**
- Accept: *"Yes, do it!"* → Creates storyline
- Decline: *"Nah, skip it"* → Dismisses suggestion
- Ignore: Nothing happens, suggestion expires

---

## What Phase 2 Does

1. **Background Service:** Generates storyline suggestions during idle time
2. **Suggestion Storage:** Stores pending suggestions in database
3. **Idle Breaker Integration:** Injects suggestion into idle breaker message
4. **User Response Handler:** Detects acceptance/rejection in chat and creates/dismisses storyline

---

## Implementation Plan

### 1. Database Migration

**File:** `supabase/migrations/20260118_create_storyline_suggestions.sql`

```sql
-- Pending storyline suggestions (idle-generated)
CREATE TABLE storyline_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,  -- Auto-expire after 48 hours

  -- Suggestion details
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  storyline_type TEXT NOT NULL,
  initial_announcement TEXT NOT NULL,
  stakes TEXT NOT NULL,
  emotional_tone TEXT,
  emotional_intensity NUMERIC DEFAULT 0.5,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'dismissed' | 'expired'
  resolved_at TIMESTAMPTZ,
  created_storyline_id UUID REFERENCES life_storylines(id)
);

CREATE INDEX idx_storyline_suggestions_status ON storyline_suggestions(status);
CREATE INDEX idx_storyline_suggestions_expires ON storyline_suggestions(expires_at)
  WHERE status = 'pending';
```

---

### 2. Service Layer: storylineIdleService.ts

**File:** `src/services/storylineIdleService.ts` (NEW)

**Purpose:** Generate and manage storyline suggestions during idle time.

**Key Functions:**

```typescript
/**
 * Generate a storyline suggestion for idle breaker
 *
 * Algorithm:
 * 1. Check if active storyline exists (if yes, return null)
 * 2. Check if pending suggestion exists (if yes, return existing)
 * 3. Check if we should suggest (50% probability)
 * 4. Call LLM to generate suggestion
 * 5. Store in database, return suggestion
 */
export async function generateStorylineSuggestion(
  userId: string,
  context: {
    recentTopics?: string[];
    userInterests?: string[];
  }
): Promise<StorylineSuggestion | null>;

/**
 * Get pending suggestion for user (if any)
 */
export async function getPendingSuggestion(userId: string): Promise<StorylineSuggestion | null>;

/**
 * Accept a suggestion and create the storyline
 */
export async function acceptSuggestion(suggestionId: string): Promise<StorylineCreationResult>;

/**
 * Dismiss a suggestion (user declined)
 */
export async function dismissSuggestion(suggestionId: string): Promise<void>;

/**
 * Expire old suggestions (cleanup function)
 */
export async function expireOldSuggestions(): Promise<number>;
```

**LLM Prompt for Generation:**

```typescript
function buildSuggestionPrompt(context: SuggestionContext): string {
  return `You are generating a storyline suggestion for Kayley Adams.

KAYLEY'S PROFILE:
${KAYLEY_PROFILE_SUMMARY}

RECENT TOPICS: ${context.recentTopics || 'None'}
USER INTERESTS: ${context.userInterests || 'Unknown'}

Generate a believable life event that Kayley might be considering.

GUIDELINES:
- Must align with Kayley's personality and interests
- Should feel organic and natural
- Can be inspired by recent conversation topics
- Should be something she's "been thinking about" but hasn't committed to yet

GOOD EXAMPLES:
- "Signing up for that pottery class I've been eyeing"
- "Finally tackling my messy closet reorganization project"
- "Starting to learn Spanish for my trip to Mexico"

BAD EXAMPLES:
- "Getting a tattoo" (not her style)
- "Running a marathon" (too ambitious, not authentic)
- "Learning blockchain" (doesn't fit her interests)

Respond with JSON:
{
  "title": "Short title (3-8 words)",
  "category": "work" | "personal" | "family" | "social" | "creative",
  "storylineType": "project" | "opportunity" | "challenge" | "relationship" | "goal",
  "initialAnnouncement": "What Kayley would say (e.g., 'Been thinking about...')",
  "stakes": "Why this matters to her (1-2 sentences)",
  "emotionalTone": "excited" | "curious" | "hesitant" | "hopeful",
  "emotionalIntensity": 0.3-0.6  // Lower for suggestions (not committed yet)
}`;
}
```

---

### 3. Integration: App.tsx or Idle Breaker

**Files to modify:**
- `src/App.tsx` (or wherever idle breaker is triggered)
- Idle breaker logic (inject suggestion into message)

**Algorithm:**

```typescript
// In idle breaker logic
async function generateIdleBreaker(): Promise<string> {
  // ... existing idle breaker logic ...

  // NEW: Check for storyline suggestion
  const suggestion = await getPendingSuggestion(userId);

  if (suggestion) {
    // Inject suggestion into idle breaker prompt
    const suggestionPrompt = `
      STORYLINE SUGGESTION:
      You've been thinking about: "${suggestion.title}"
      Stakes: ${suggestion.stakes}

      Casually mention this in your idle message. Frame it as something you've been considering:
      - "Been thinking about [suggestion]... should I make it a thing?"
      - "I've been eyeing [suggestion]... thoughts?"
      - "Lowkey want to [suggestion]... think I should go for it?"

      Make it sound natural, not forced. User can accept, decline, or ignore.
    `;

    // Add to idle breaker prompt
  }

  // ... rest of idle breaker logic ...
}
```

---

### 4. Chat Response Handler

**File:** `src/services/chatResponseHandler.ts` (or in main chat service)

**Purpose:** Detect when user accepts/declines a suggestion.

**Algorithm:**

```typescript
async function handleUserResponse(message: string, userId: string): Promise<void> {
  // Check if there's a pending suggestion
  const suggestion = await getPendingSuggestion(userId);

  if (!suggestion) return;

  // Detect acceptance patterns
  const acceptPatterns = [
    /yes|yeah|yep|sure|do it|go for it|make it a thing/i,
    /definitely|absolutely|sounds good/i,
  ];

  // Detect rejection patterns
  const rejectPatterns = [
    /no|nah|nope|skip it|pass/i,
    /don't think so|not interested|maybe later/i,
  ];

  for (const pattern of acceptPatterns) {
    if (pattern.test(message)) {
      // ACCEPT SUGGESTION
      const result = await acceptSuggestion(suggestion.id);

      if (result.success) {
        console.log(`✅ Accepted suggestion, created storyline: ${result.storylineId}`);
      }

      return;
    }
  }

  for (const pattern of rejectPatterns) {
    if (pattern.test(message)) {
      // DISMISS SUGGESTION
      await dismissSuggestion(suggestion.id);
      console.log(`❌ Dismissed suggestion: ${suggestion.title}`);
      return;
    }
  }

  // User didn't accept or reject - suggestion remains pending
}
```

**Note:** This handler should be called BEFORE the main chat processing in the message flow.

---

### 5. Cleanup Task (Background)

**Where:** Existing daily/hourly cleanup task or new cron job

**What:** Expire suggestions older than 48 hours

```typescript
// In daily cleanup
async function cleanupStorylineSuggestions(): Promise<void> {
  const expiredCount = await expireOldSuggestions();
  console.log(`📖 [Storylines] Expired ${expiredCount} old suggestion(s)`);
}
```

---

## Testing Plan

**Manual Test Cases:**

1. **Suggestion Generation**
   - Trigger idle breaker with no active storyline
   - Verify suggestion appears in message
   - Check database: suggestion stored as 'pending'

2. **Acceptance Flow**
   - User says "yes, do it!"
   - Verify storyline created
   - Check database: suggestion status = 'accepted', created_storyline_id set

3. **Rejection Flow**
   - User says "nah, skip it"
   - Verify no storyline created
   - Check database: suggestion status = 'dismissed'

4. **Expiration**
   - Create suggestion, wait 48+ hours (or manually set expires_at)
   - Run cleanup task
   - Verify suggestion status = 'expired'

**Unit Tests:**

```typescript
// src/services/tests/storylineIdleService.test.ts

describe('Storyline Idle Service', () => {
  it('should generate suggestion when no active storyline exists', async () => {
    const suggestion = await generateStorylineSuggestion('user123', {});
    expect(suggestion).toBeDefined();
    expect(suggestion.title).toMatch(/\w+/);
  });

  it('should not generate suggestion if active storyline exists', async () => {
    // Create active storyline first
    await createStorylineFromTool({ ... });

    const suggestion = await generateStorylineSuggestion('user123', {});
    expect(suggestion).toBeNull();
  });

  it('should accept suggestion and create storyline', async () => {
    const suggestion = await generateStorylineSuggestion('user123', {});
    const result = await acceptSuggestion(suggestion.id);

    expect(result.success).toBe(true);
    expect(result.storylineId).toBeDefined();

    // Verify suggestion marked as accepted
    const updated = await getPendingSuggestion('user123');
    expect(updated).toBeNull(); // No longer pending
  });

  it('should dismiss suggestion', async () => {
    const suggestion = await generateStorylineSuggestion('user123', {});
    await dismissSuggestion(suggestion.id);

    const pending = await getPendingSuggestion('user123');
    expect(pending).toBeNull();
  });

  it('should expire old suggestions', async () => {
    // Create suggestion with past expiry
    await supabase.from('storyline_suggestions').insert({
      title: 'Old suggestion',
      category: 'personal',
      storyline_type: 'goal',
      initial_announcement: 'Test',
      stakes: 'Test',
      expires_at: new Date(Date.now() - 1000).toISOString()
    });

    const expiredCount = await expireOldSuggestions();
    expect(expiredCount).toBeGreaterThan(0);
  });
});
```

---

## Files to Create/Modify

**New Files:**
1. `supabase/migrations/20260118_create_storyline_suggestions.sql` - Database schema
2. `src/services/storylineIdleService.ts` - Suggestion generation and management (~300 lines)
3. `src/services/tests/storylineIdleService.test.ts` - Unit tests (~200 lines)

**Modified Files:**
1. `src/App.tsx` (or idle breaker file) - Inject suggestion into idle message (~20 lines)
2. Chat response handler - Detect acceptance/rejection (~50 lines)
3. Daily cleanup task - Expire old suggestions (~5 lines)

---

## Success Criteria

Phase 2 is complete when:

- ✅ Database migration applied
- ✅ `storylineIdleService.ts` implemented with all functions
- ✅ Idle breaker injects suggestion into message
- ✅ User acceptance creates storyline
- ✅ User rejection dismisses suggestion
- ✅ Old suggestions expire automatically
- ✅ Unit tests pass
- ✅ Manual test cases verified
- ✅ Build succeeds with no type errors

---

## Notes for Implementation

1. **LLM Call:** The suggestion generation requires 1 LLM call (gemini-2.0-flash, ~200ms)
2. **Probability:** Use 50% probability to avoid suggesting too often (make it special)
3. **Expiry:** 48 hours gives user enough time to respond without cluttering database
4. **Audit Trail:** Suggestions table provides full audit trail of what was suggested and when
5. **No Cooldown:** Suggestions bypass the 48-hour creation cooldown (they're pre-vetted)

---

## Questions to Resolve

1. **Where is idle breaker logic?** Need to locate exact file to inject suggestion.
2. **Chat response handler?** Need to identify where to add acceptance/rejection detection.
3. **Cleanup task?** Need to locate existing daily cleanup to add expiry logic.

---

## Prompt for Next Session

```
Continue implementing Life Event Storylines Phase 2 (Idle Suggestions).

CONTEXT:
- Phase 1 (conversation-driven creation) is complete
- Database has: life_storylines, storyline_config, storyline_creation_attempts
- Service layer has: createStorylineFromTool() with safety checks (cooldown, dedupe, category constraint)
- Tool integration complete: create_life_storyline tool available to LLM

IMPLEMENT PHASE 2:
1. Create database migration for storyline_suggestions table
2. Create storylineIdleService.ts with:
   - generateStorylineSuggestion() - LLM-based suggestion generation
   - getPendingSuggestion() - Retrieve pending suggestion
   - acceptSuggestion() - Create storyline from suggestion
   - dismissSuggestion() - Mark as dismissed
   - expireOldSuggestions() - Cleanup task
3. Integrate with idle breaker (inject suggestion into message)
4. Add chat response handler (detect "yes"/"no" patterns)
5. Add cleanup task to expire old suggestions
6. Write comprehensive tests
7. Verify build and tests pass

REFERENCE:
- Implementation plan: docs/features/Life_Event_Storylines/Phase_2_Implementation_Prompt.md
- Phase 1 code: src/services/storylineService.ts (lines 1-500)
- Tool integration: src/services/memoryService.ts (create_life_storyline case)

QUESTIONS TO ANSWER:
- Where is idle breaker logic located? (App.tsx? separate file?)
- Where should chat response handler go? (chatService? messageAnalyzer?)
- Where is daily cleanup task? (add expiry logic there)

START BY:
1. Reading the idle breaker code to understand injection point
2. Creating the database migration
3. Implementing storylineIdleService.ts
```

---

## Related Documents

- [Phase 1 Implementation Plan](./Storyline_Creation_Implementation_Plan.md)
- [Storyline Service Documentation](../../../src/services/docs/StorylineCreationService.md)
- [Storyline Feature Spec](./README.md)
