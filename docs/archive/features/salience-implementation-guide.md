# Fix #1 & #2 Implementation Guide
## Loop Deduplication + Contradiction Detection

---

## Overview

These fixes address two issues:
1. **Duplicate loops** - "Holiday Party" created 3 separate loops
2. **No contradiction handling** - User said "I don't have a party" but loops persisted

---

## File 1: `presenceDirector.ts`

### Add these helper functions (around line 220, before `createOpenLoop`):

```typescript
// ============================================
// Loop Deduplication & Topic Matching
// ============================================

/**
 * Check if two topics are similar enough to be considered duplicates.
 * Uses fuzzy matching to catch variations like "Holiday Parties" vs "Holiday party"
 */
function isSimilarTopic(existingTopic: string, newTopic: string): boolean {
  const normalize = (s: string) => s.toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, '')  // Remove punctuation
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .replace(/s\b/g, '');          // Remove trailing 's' (parties → party)
  
  const existing = normalize(existingTopic);
  const incoming = normalize(newTopic);
  
  // Exact match after normalization
  if (existing === incoming) return true;
  
  // One contains the other (e.g., "holiday party" vs "holiday parties")
  if (existing.includes(incoming) || incoming.includes(existing)) return true;
  
  // Check word overlap (e.g., "Holiday Parties" vs "party tonight")
  const existingWords = new Set(existing.split(' ').filter(w => w.length > 2));
  const incomingWords = new Set(incoming.split(' ').filter(w => w.length > 2));
  
  // Skip if either has no meaningful words
  if (existingWords.size === 0 || incomingWords.size === 0) return false;
  
  // If there's significant word overlap, consider them similar
  const overlap = [...existingWords].filter(w => incomingWords.has(w));
  const overlapRatio = overlap.length / Math.min(existingWords.size, incomingWords.size);
  
  return overlapRatio >= 0.5;  // 50% word overlap = similar
}

/**
 * Find an existing loop with a similar topic.
 */
async function findSimilarLoop(userId: string, topic: string): Promise<OpenLoop | null> {
  try {
    // Get all active and surfaced loops (not resolved/dismissed/expired)
    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'surfaced']);
    
    if (error || !data) return null;
    
    const loops = data.map(mapRowToLoop);
    return loops.find(loop => isSimilarTopic(loop.topic, topic)) || null;
    
  } catch (error) {
    console.error('[PresenceDirector] Error finding similar loop:', error);
    return null;
  }
}
```

### Modify `createOpenLoop` function (around line 228):

Add this at the START of the function, right after `try {`:

```typescript
export async function createOpenLoop(
  userId: string,
  loopType: LoopType,
  topic: string,
  options: {
    triggerContext?: string;
    suggestedFollowup?: string;
    shouldSurfaceAfter?: Date;
    expiresAt?: Date;
    salience?: number;
    sourceMessageId?: string;
    sourceCalendarEventId?: string;
  } = {}
): Promise<OpenLoop | null> {
  try {
    // ============================================
    // FIX #1: Check for existing similar loop
    // ============================================
    const existingLoop = await findSimilarLoop(userId, topic);
    
    if (existingLoop) {
      console.log(`🔄 [PresenceDirector] Similar loop already exists: "${existingLoop.topic}" ≈ "${topic}"`);
      
      // Update salience if new one is higher
      const newSalience = options.salience ?? 0.5;
      if (newSalience > existingLoop.salience) {
        await supabase
          .from(PRESENCE_CONTEXTS_TABLE)
          .update({ 
            salience: newSalience,
            trigger_context: options.triggerContext || existingLoop.triggerContext
          })
          .eq('id', existingLoop.id);
        
        console.log(`📈 [PresenceDirector] Updated salience: ${existingLoop.salience} → ${newSalience}`);
        existingLoop.salience = newSalience;
      }
      
      return existingLoop;  // Return existing instead of creating duplicate
    }
    // ============================================
    
    const now = new Date();
    // ... rest of existing code continues unchanged ...
```

### Add `dismissLoopsByTopic` function (around line 430, after `dismissLoop`):

```typescript
/**
 * Dismiss all loops related to a topic.
 * Call this when user contradicts/denies something.
 * 
 * Example: User says "I don't have a party" → dismiss all party-related loops
 * 
 * @param userId - The user's ID
 * @param topic - The topic to dismiss (fuzzy matched)
 * @returns Number of loops dismissed
 */
export async function dismissLoopsByTopic(userId: string, topic: string): Promise<number> {
  try {
    // Get all active/surfaced loops
    const { data, error } = await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'surfaced']);
    
    if (error || !data) return 0;
    
    const loops = data.map(mapRowToLoop);
    const matchingLoops = loops.filter(loop => isSimilarTopic(loop.topic, topic));
    
    if (matchingLoops.length === 0) {
      console.log(`[PresenceDirector] No loops found matching topic "${topic}"`);
      return 0;
    }
    
    // Dismiss all matching loops
    const ids = matchingLoops.map(l => l.id);
    await supabase
      .from(PRESENCE_CONTEXTS_TABLE)
      .update({ status: 'dismissed' })
      .in('id', ids);
    
    console.log(`🚫 [PresenceDirector] Dismissed ${matchingLoops.length} loops matching "${topic}": ${matchingLoops.map(l => l.topic).join(', ')}`);
    return matchingLoops.length;
    
  } catch (error) {
    console.error('[PresenceDirector] Error dismissing loops by topic:', error);
    return 0;
  }
}
```

### Update exports at the bottom of the file (around line 830):

```typescript
export const presenceDirector = {
  // Opinion functions
  parseCharacterOpinions,
  getCharacterOpinions,
  findRelevantOpinion,
  
  // Open loop functions
  createOpenLoop,
  getActiveLoops,
  getTopLoopToSurface,
  markLoopSurfaced,
  resolveLoop,
  dismissLoop,
  dismissLoopsByTopic,  // 👈 ADD THIS
  expireOldLoops,
  detectOpenLoops,
  
  // Unified context
  getPresenceContext
};
```

---

## File 2: `intentService.ts`

### Add Contradiction type to `FullMessageIntent` (around line 1707):

```typescript
export interface FullMessageIntent {
  genuineMoment: GenuineMomentIntent;
  tone: ToneIntent;
  topics: TopicIntent;
  openLoops: OpenLoopIntent;
  relationshipSignals: RelationshipSignalIntent;
  
  // 👇 ADD THIS NEW FIELD
  /** Contradiction detection - when user denies/disputes something */
  contradiction?: {
    isContradicting: boolean;
    topic: string | null;
    confidence: number;
  };
  
  _meta?: {
    skippedFullDetection?: boolean;
    reason?: string;
  };
}
```

### Update `UNIFIED_INTENT_PROMPT` (around line 1801):

Add a new section to the prompt. Find the line that says:
```
SECTION 5: RELATIONSHIP SIGNALS
```

And ADD this new section AFTER it (before the closing `---`):

```typescript
const UNIFIED_INTENT_PROMPT = `You are the MASTER INTENT DETECTION SYSTEM for an AI companion named Kayley.

Your task is to analyze the user's message for SIX distinct aspects simultaneously.
You must be precise, noting sarcasm, hidden emotions, and subtle relationship signals.

---
SECTION 1: GENUINE MOMENT (Kayley's Insecurities)
... (existing content) ...

SECTION 2: TONE & SENTIMENT
... (existing content) ...

SECTION 3: TOPICS
... (existing content) ...

SECTION 4: OPEN LOOPS (Memory)
... (existing content) ...

SECTION 5: RELATIONSHIP SIGNALS
... (existing content) ...

SECTION 6: CONTRADICTION DETECTION
Detect if the user is CONTRADICTING or DENYING something previously discussed.
This is important for correcting mistaken assumptions.

Triggers:
- "I don't have a [X]" / "There is no [X]"
- "That's not on my calendar" / "I don't see that"
- "That's wrong" / "That's not right"
- "I never said that" / "I didn't say that"
- "No, I meant..." / "Actually, it's..."
- User correcting a misunderstanding

Examples:
- "I don't have a party tonight" → topic: "party"
- "That event isn't on my calendar" → topic: "event" or "calendar"
- "I never mentioned a meeting" → topic: "meeting"

---
{context}

Target Message: "{message}"

Respond with this EXACT JSON structure (do NOT include explanation fields):
{
  "genuineMoment": { "isGenuine": bool, "category": "string|null", "confidence": 0-1 },
  "tone": { "sentiment": -1to1, "primaryEmotion": "string", "intensity": 0-1, "isSarcastic": bool, "secondaryEmotion": "string|null" },
  "topics": { "topics": ["string"], "primaryTopic": "string|null", "emotionalContext": { "topic": "emotion" }, "entities": ["string"] },
  "openLoops": { "hasFollowUp": bool, "loopType": "string|null", "topic": "string|null", "suggestedFollowUp": "string|null", "timeframe": "string|null", "salience": 0-1 },
  "relationshipSignals": { "milestone": "string|null", "milestoneConfidence": 0-1, "isHostile": bool, "hostilityReason": "string|null", "isInappropriate": bool, "inappropriatenessReason": "string|null" },
  "contradiction": { "isContradicting": bool, "topic": "string|null", "confidence": 0-1 }
}`;
```

### Update `validateFullIntent` function (around line 1729):

Add validation for the new contradiction field at the end of the function, before the return:

```typescript
function validateFullIntent(parsed: any): FullMessageIntent {
  // ... existing validation code ...
  
  // 👇 ADD THIS before the final return
  // Validate Contradiction
  const contradiction = parsed.contradiction ? {
    isContradicting: Boolean(parsed.contradiction.isContradicting),
    topic: parsed.contradiction.topic ? String(parsed.contradiction.topic) : null,
    confidence: normalizeConfidence(parsed.contradiction.confidence)
  } : undefined;
  
  const result: FullMessageIntent = { 
    genuineMoment, 
    tone, 
    topics, 
    openLoops, 
    relationshipSignals,
    contradiction  // 👈 ADD THIS
  };
  
  if (parsed._meta) {
    result._meta = parsed._meta;
  }
  
  return result;
}
```

### Update `getDefaultIntent` function (around line 1950):

Add the contradiction field to the default intent:

```typescript
function getDefaultIntent(message: string): FullMessageIntent {
  // ... existing code ...
  
  return {
    genuineMoment: { /* ... */ },
    tone: { /* ... */ },
    topics: { /* ... */ },
    openLoops: { /* ... */ },
    relationshipSignals: { /* ... */ },
    
    // 👇 ADD THIS
    contradiction: {
      isContradicting: false,
      topic: null,
      confidence: 0
    },
    
    _meta: {
      skippedFullDetection: true,
      reason: 'short_message'
    }
  };
}
```

---

## File 3: `messageAnalyzer.ts`

### Add import for `dismissLoopsByTopic` (around line 28):

```typescript
import { 
  detectOpenLoops, 
  dismissLoopsByTopic  // 👈 ADD THIS
} from './presenceDirector';
```

### Add contradiction handling in `analyzeUserMessage` (around line 532):

Find this section:
```typescript
// ============================================
// Execution & Side Effects (🚀 Parallelized)
// ============================================
```

And ADD this block BEFORE it:

```typescript
  // ============================================
  // FIX #2: Handle Contradictions BEFORE creating new loops
  // ============================================
  // If user is contradicting something, dismiss related loops first
  if (preCalculatedIntent?.contradiction?.isContradicting && 
      preCalculatedIntent.contradiction.topic &&
      preCalculatedIntent.contradiction.confidence > 0.6) {
    
    const dismissedCount = await dismissLoopsByTopic(
      userId, 
      preCalculatedIntent.contradiction.topic
    );
    
    if (dismissedCount > 0) {
      console.log(`🚫 [MessageAnalyzer] User contradicted "${preCalculatedIntent.contradiction.topic}" - dismissed ${dismissedCount} loop(s)`);
    }
  }

  // ============================================
  // Execution & Side Effects (🚀 Parallelized)
  // ============================================
  // ... existing code continues ...
```

---

## Testing

After implementing these changes:

1. **Test Deduplication:**
   ```
   You: "I have a meeting tomorrow"
   You: "Yeah the meeting is at 3pm"
   
   Expected: Only ONE loop created for "meeting", not two
   Check console for: "Similar loop already exists"
   ```

2. **Test Contradiction:**
   ```
   You: "I don't have any meetings today"
   
   Expected: Any existing "meeting" loops get dismissed
   Check console for: "User contradicted 'meeting' - dismissed X loop(s)"
   ```

3. **Test the Holiday Party scenario:**
   ```
   You: "I don't have a party on my calendar"
   
   Expected: All "party" and "holiday party" loops get dismissed
   AI should stop asking about the party
   ```

---

## SQL Verification

After testing, verify in Supabase:

```sql
-- Check for dismissed loops
SELECT topic, status, created_at 
FROM presence_contexts 
WHERE user_id = 'your-user-id'
ORDER BY created_at DESC;

-- Should see status = 'dismissed' for contradicted topics
```

---

## Summary of Changes

| File | Change | Purpose |
|------|--------|---------|
| `presenceDirector.ts` | Added `isSimilarTopic()` | Fuzzy topic matching |
| `presenceDirector.ts` | Added `findSimilarLoop()` | Find existing similar loops |
| `presenceDirector.ts` | Modified `createOpenLoop()` | Check before creating duplicates |
| `presenceDirector.ts` | Added `dismissLoopsByTopic()` | Bulk dismiss by topic |
| `intentService.ts` | Added `contradiction` field | Detect when user denies something |
| `intentService.ts` | Updated prompt | LLM detects contradictions |
| `messageAnalyzer.ts` | Added contradiction handling | Dismiss loops when user contradicts |

