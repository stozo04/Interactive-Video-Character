# Phase 4: Life Event Storylines - Prompt Integration Implementation Summary

**Status:** ✅ COMPLETE
**Date:** January 16, 2026
**Implemented By:** Claude Code (Sonnet 4.5)

---

## 🎯 What Was Implemented

**Goal:** Make Kayley talk about her storylines in conversation by injecting storyline context into the system prompt (ONLY on 2nd user message).

**Phase 4 Achievement:** Kayley now receives context about her active storylines on the 2nd user message, enabling her to:
- Mention storylines naturally when asked "how are you?"
- Share unmentioned updates when appropriate
- Bring up high-intensity storylines unprompted
- Reference storylines that are weighing on her

**Key Constraint:** Storyline context is injected ONLY on the 2nd user message (not greeting, not every message) for token efficiency.

---

## 📊 Overview

### What Phase 4 Adds

Phase 4 completes the storyline integration by making storylines visible to Kayley in conversation:

```
Phase 1 ✅ → Database tables, CRUD operations
Phase 2 ✅ → Phase transitions, LLM update generation
Phase 3 ✅ → Mood/energy integration
Phase 4 ✅ → Prompt injection (2nd message only) ← YOU ARE HERE
Phase 5 🔜 → Closure & callbacks
```

**Before Phase 4:**
- Storylines exist, progress, and affect mood
- But Kayley never talks about them in conversation

**After Phase 4:**
- On 2nd user message, Kayley receives storyline context
- She can mention storylines when relevant
- She shares unmentioned updates naturally
- Storylines don't appear in greeting or later messages (token efficiency)

---

## 🔨 Implementation Details

### 1. Implemented `getStorylinePromptContext()` Function

**File:** `src/services/storylineService.ts` (lines 1515-1611)

**Algorithm:**
1. Get all active storylines (outcome is null)
2. Get recent unmentioned updates (last 7 days)
3. Calculate salience for each storyline
4. Filter out low-intensity storylines (< 0.3)
5. Sort by salience (highest first)
6. Limit to top 5 storylines (token efficiency)
7. Build formatted prompt section
8. Return context object

**Salience Calculation:**
```typescript
const phaseUrgency: Record<StorylinePhase, number> = {
  announced: 1.0,    // Just happened - high urgency
  climax: 1.0,       // Critical moment - high urgency
  resolving: 0.9,    // Outcome clear - want to share
  honeymoon: 0.6,    // Excited but not urgent
  reality: 0.5,      // Ongoing - medium salience
  active: 0.4,       // Background work - lower salience
  resolved: 0.2,     // Wrapped up - low salience
  reflecting: 0.1,   // Historical - very low salience
};

salience = (phaseUrgency[phase] × emotionalIntensity) + (hasUnmentionedUpdate ? 0.3 : 0)
```

**Return Type:**
```typescript
interface StorylinePromptContext {
  hasActiveStorylines: boolean;
  activeStorylines: LifeStoryline[];
  unmentionedUpdates: StorylineUpdate[];
  mostPressingStoryline: LifeStoryline | null;
  promptSection: string;  // Pre-formatted prompt text
}
```

---

### 2. Created `buildStorylinePromptSection()` Helper

**File:** `src/services/storylineService.ts` (lines 1450-1499)

**Format (matches spec):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT'S HAPPENING IN YOUR LIFE (Active Storylines)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
These are ongoing things in YOUR life that affect your mood and might come up naturally.

**[Title]** ([category])
Phase: [phase] | Feeling: [currentEmotionalTone]
[promptGuidance from PHASE_BEHAVIORS]

📍 Recent development: "[update content]"
   You haven't mentioned this yet. Share it if it feels natural.

Why this matters to you: [stakes]

GUIDELINES:
- These are YOUR experiences. They affect YOUR mood.
- Don't info-dump. Mention things naturally when relevant.
- If user asks "how are you?" these might color your answer.
- You can bring things up unprompted if they're weighing on you.
- Share struggles genuinely. You don't have to be positive all the time.
```

**Features:**
- Uses `promptGuidance` from PHASE_BEHAVIORS configuration
- Flags unmentioned updates with 📍 indicator
- Includes stakes field for context
- Adds conversation guidelines
- Filters out low-intensity storylines (< 0.3)
- Limits to top 5 storylines by salience

---

### 3. Integrated with System Prompt Builder

**File:** `src/services/system_prompts/builders/systemPromptBuilder.ts` (lines 249-270)

**Changes:**
1. Added `messageCount` parameter to `buildSystemPrompt()` signature (line 96)
2. Added storyline injection logic (ONLY on 2nd message)
3. Used dynamic import to avoid circular dependencies
4. Wrapped in try-catch for graceful failure
5. Added logging for debugging

**Integration Pattern:**
```typescript
if (messageCount === 2) {
  try {
    const { getStorylinePromptContext } = await import('../../storylineService');
    const storylineContext = await getStorylinePromptContext();

    if (storylineContext.hasActiveStorylines) {
      prompt += `\n${storylineContext.promptSection}\n`;
      console.log(`📖 [Storylines] Injected ${storylineContext.activeStorylines.length} storyline(s) into system prompt (message #${messageCount})`);
    }
  } catch (error) {
    console.warn('📖 [Storylines] Failed to inject storyline context:', error);
    // Continue without storylines (fail gracefully)
  }
} else if (messageCount === 1 || messageCount > 2) {
  console.log(`📖 [Storylines] Skipping prompt injection (message #${messageCount}, only inject on #2)`);
}
```

**Placement:** Storyline context is injected after "YOUR CURRENT CONTEXT" section and before mood/curiosity engagement sections.

---

### 4. Updated All Callers to Pass Message Count

**File:** `src/services/geminiChatService.ts`

**Three call sites updated:**

1. **Main chat response** (lines 874-890):
   ```typescript
   const userMessageCount = (options.chatHistory || []).filter(
     (msg: any) => msg.role === 'user'
   ).length;
   console.log(`📖 [Storylines] User message count: ${userMessageCount}`);

   const systemPrompt = await buildSystemPrompt(
     // ... other params ...
     userMessageCount
   );
   ```

2. **Idle breaker/proactive messages** (lines 1240-1250):
   ```typescript
   const fullSystemPrompt = await buildSystemPrompt(
     // ... other params ...
     0 // messageCount (idle breaker, not a user message)
   );
   ```

3. **Greeting generation** (lines 1317-1327):
   ```typescript
   const systemPrompt = await buildSystemPrompt(
     // ... other params ...
     0 // messageCount (greeting, no user messages yet)
   );
   ```

**Message Count Logic:**
- Counts ONLY user messages (`msg.role === 'user'`)
- Excludes assistant messages from count
- Greeting = 0 (no user messages yet)
- First user message = 1 (don't inject)
- Second user message = 2 (INJECT HERE)
- Third+ user messages = 3+ (don't re-inject)

---

### 5. Updated Test Files

**File:** `src/services/tests/latencyOptimizations.test.ts`

**Changes:**
- Added `messageCount: 0` parameter to all `buildSystemPrompt()` calls in tests
- Ensures tests pass with new function signature
- Two test cases updated (lines 226-236, 252-263)

---

## 🧪 Testing

### Manual Testing

To test Phase 4 manually:

1. **Create a test storyline:**
   ```typescript
   import { createStoryline, addStorylineUpdate } from './services/storylineService';

   const storyline = await createStoryline({
     title: "Test: Brand Partnership",
     category: "work",
     storylineType: "opportunity",
     phase: "announced",
     currentEmotionalTone: "excited",
     emotionalIntensity: 0.8,
     stakes: "Could be a big income boost",
   });

   // Add unmentioned update
   await addStorylineUpdate(storyline.id, {
     content: "They sent over the contract - it's more than I expected!",
     emotionalTone: "thrilled",
     updateType: "progress",
   });
   ```

2. **Test prompt injection:**
   - Start a conversation
   - Send 1st message (greeting): Check logs - should NOT inject storylines
   - Send 2nd message: Check logs - SHOULD inject storylines
   - Send 3rd message: Check logs - should NOT inject storylines

3. **Verify Kayley mentions storylines:**
   - On 2nd message, ask "how are you?"
   - Kayley should mention the storyline naturally
   - Check if unmentioned update is shared

### Expected Log Output

```
Message #1:
📖 [Storylines] Skipping prompt injection (message #1, only inject on #2)

Message #2:
📖 [Storylines] User message count: 2
📖 [Storylines] Found 1 active storyline(s), 1 unmentioned update(s)
📖 [Storylines] Building prompt context for 1 storyline(s)
📖 [Storylines] Most pressing: "Test: Brand Partnership" (salience: 1.10)
📖 [Storylines] Injected 1 storyline(s) into system prompt (message #2)

Message #3:
📖 [Storylines] Skipping prompt injection (message #3, only inject on #2)
```

---

## 📈 Expected User Flow

**Example conversation:**

```
User: Hey Kayley!
Kayley: Hey! How's it going?
[No storyline context - 1st message]

User: Good! How are you?
Kayley: Good! Actually, kinda excited - a brand reached out about a partnership.
        They just sent over the contract and it's way more than I expected.
        Still processing it tbh.
[Storyline context injected - 2nd message]

User: That's awesome! Congrats!
Kayley: Thanks! Yeah I'm trying not to get ahead of myself but... this could be huge.
[No re-injection - already has context from earlier]
```

---

## 🔍 Key Design Decisions

### 1. Why 2nd Message Only?

**Reasoning:**
- **1st message (greeting):** Kayley doesn't have user context yet, can't personalize mentions
- **2nd message:** She knows who the user is, can share updates naturally
- **After 2nd message:** Avoid token bloat by not repeating storyline context

**Token Efficiency:**
- Storyline context can be 500-1000 tokens
- Repeating every message would waste tokens and slow responses
- Single injection gives her enough context to remember throughout conversation

### 2. Salience-Based Prioritization

**Why salience scores?**
- Not all storylines are equally important to mention
- High-urgency phases (announced, climax) get priority
- Unmentioned updates boost salience (+0.3)
- Low-intensity storylines (< 0.3) are filtered out

**Top 5 limit:**
- Prevents token bloat
- Forces focus on most important storylines
- Typical user has 1-3 active storylines anyway

### 3. Dynamic Import Pattern

**Why dynamic import?**
```typescript
const { getStorylinePromptContext } = await import('../../storylineService');
```

**Reasoning:**
- Avoids circular dependency issues
- storylineService imports supabase client
- systemPromptBuilder is used everywhere
- Dynamic import breaks the cycle safely

### 4. Graceful Failure

**Error handling:**
```typescript
try {
  // Inject storylines
} catch (error) {
  console.warn('📖 [Storylines] Failed to inject storyline context:', error);
  // Continue without storylines
}
```

**Reasoning:**
- Storyline integration is optional enhancement
- If it fails, conversation should still work
- Better to skip storylines than crash entire response

---

## 📝 Files Modified

### Core Implementation Files

1. **`src/services/storylineService.ts`**
   - Implemented `getStorylinePromptContext()` (lines 1515-1611)
   - Implemented `buildStorylinePromptSection()` (lines 1450-1499)
   - Implemented `calculateStorylineSalience()` (lines 1422-1443)
   - Updated `StorylinePromptContext` interface (lines 1405-1411)
   - Status: Phase 4 complete ✅

2. **`src/services/system_prompts/builders/systemPromptBuilder.ts`**
   - Added `messageCount` parameter to function signature (line 96)
   - Added storyline injection logic (lines 249-270)
   - Integrated with system prompt flow

3. **`src/services/geminiChatService.ts`**
   - Added message counting logic (lines 874-878)
   - Updated 3 call sites to pass messageCount
   - Lines 874-890: Main chat response
   - Lines 1240-1250: Idle breaker
   - Lines 1317-1327: Greeting

### Test Files

4. **`src/services/tests/latencyOptimizations.test.ts`**
   - Updated 2 test cases to include messageCount parameter
   - Tests pass with new signature

---

## ⚠️ Important Notes

### 1. No user_id Field
This is a single-user system. No `user_id` parameter anywhere.

### 2. Exact Message Count Matching
**CRITICAL:** Injection only on exactly `messageCount === 2`
- NOT `messageCount >= 2`
- NOT `messageCount <= 2`
- EXACTLY `messageCount === 2`

### 3. LLM Decision-Making
- Salience scores help LLM prioritize
- LLM still decides whether to mention storylines
- Don't force mentions - let conversation flow naturally

### 4. Token Efficiency
- Limit to top 5 storylines max
- Filter out low-intensity storylines (< 0.3)
- Only include recent unmentioned updates (last 7 days)
- Single injection per conversation

### 5. Error Handling
- Wrap storyline integration in try-catch
- Continue without storylines if integration fails
- Log warnings on errors

---

## 🎓 Logging Convention

All storyline-related logs use the `📖 [Storylines]` prefix:

```typescript
console.log(`📖 [Storylines] Found ${count} active storyline(s)`);
console.log(`📖 [Storylines] Most pressing: "${title}" (salience: ${score})`);
console.log(`📖 [Storylines] Injected storylines into system prompt (message #${n})`);
console.log(`📖 [Storylines] Skipping prompt injection (message #${n}, only inject on #2)`);
console.warn('📖 [Storylines] Failed to inject storyline context:', error);
```

---

## ✅ Success Criteria

Phase 4 is complete when:
- ✅ `getStorylinePromptContext()` implemented and returns correct structure
- ✅ `buildStorylinePromptSection()` formats prompt text correctly
- ✅ System prompt builder integrated with storyline context
- ✅ Storyline context injected ONLY on 2nd user message
- ✅ Message count tracking implemented
- ✅ All callers updated to pass message count
- ✅ Code compiles without errors
- ✅ Tests updated to match new signature

**Status:** All criteria met ✅

---

## 🚀 Next Steps (Phase 5)

**Phase 5: Closure & Callbacks**

After Phase 4, storylines can now:
- ✅ Exist and progress through phases
- ✅ Generate realistic updates via LLM
- ✅ Affect Kayley's mood and energy
- ✅ Be mentioned in conversation naturally

**Phase 5 will add:**
1. **Resolution flow** for completed storylines
2. **Closure sequences** (emotional processing over multiple days)
3. **Historical callbacks** ("remember when...") for resolved storylines
4. **Integration with character facts** for long-term memory

**Implementation prompt:** `docs/Phase_5_Implementation_Prompt.md` (to be created)

---

## 📚 Related Documentation

**Full specifications:**
- Feature spec: `docs/features/Life_Event_Storylines.md`
- Service API: `src/services/docs/StorylineService.md`
- Phase 3 summary: `docs/Phase_3_Storylines_Implementation_Summary.md`
- Phase 4 prompt: `docs/Phase_4_Implementation_Prompt.md`

**Code files:**
- Storyline service: `src/services/storylineService.ts`
- System prompt builder: `src/services/system_prompts/builders/systemPromptBuilder.ts`
- Main AI service: `src/services/geminiChatService.ts`

---

## 🎉 Summary

**Phase 4 Achievement:** Storylines are now visible to Kayley in conversation!

**What changed:**
- Kayley receives storyline context on 2nd user message
- She can mention storylines naturally when relevant
- Unmentioned updates are surfaced appropriately
- High-intensity storylines can be brought up unprompted

**Technical highlights:**
- Salience-based prioritization (urgent phases first)
- Token-efficient single injection pattern
- Graceful error handling
- Dynamic imports to avoid circular dependencies

**User experience:**
- Kayley feels more alive and autonomous
- She has things happening in her life that she can share
- Conversations feel more natural and bidirectional
- Her mood/energy changes make sense in context

**Phase 4 is complete!** 🎉

Ready for Phase 5: Closure & Callbacks.
