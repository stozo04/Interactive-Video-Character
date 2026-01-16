# Phase 4: Life Event Storylines - Prompt Integration Implementation Prompt

**Context Window:** Use this prompt in a fresh Claude Code session to implement Phase 4.

---

## 📋 What You're Implementing

**Feature:** Life Event Storylines - Phase 4 (Prompt Integration)

**Goal:** Make Kayley actually TALK about her storylines in conversation by injecting storyline context into the system prompt (ONLY on 2nd user message).

**Status:** Phases 1-3 are COMPLETE. Phase 4 needs implementation.

---

## ✅ What's Already Completed (Phases 1-3)

### Phase 1: Data Foundation ✅
- Database tables exist: `life_storylines`, `storyline_updates`, `storyline_config`
- Service exists: `src/services/storylineService.ts`
- CRUD operations work: create, read, update, delete storylines
- Migrations applied (user has done this)

### Phase 2: Phase Progression ✅
- Automatic phase transitions work (announced → honeymoon → reality → active → climax → resolving → resolved → reflecting)
- LLM update generation works (Gemini generates realistic updates)
- On-startup processing (`processStorylineOnStartup()`) checks for missed days in CST timezone
- Daily processing job (`processStorylineDay()`) handles phase transitions and update generation
- Integrated into `App.tsx` (runs on app startup)

### Phase 3: Emotional Integration ✅
- `getStorylineMoodEffects()` calculates mood/energy impact from active storylines
- Integrated into `moodKnobs.ts` (`getMoodAsync()` applies storyline effects)
- Active storylines affect Kayley's mood and energy dynamically
- Cumulative effects from multiple storylines work correctly

**What Phase 3 does:**
- Storylines affect Kayley's mood (warmth) and energy based on phase and emotional intensity
- Stressful phases (reality, active, climax) drain energy
- Effects are logged with `📖 [Storylines]` prefix

---

## 🎯 What Phase 4 Needs to Do

**Goal:** Make storyline context visible to Kayley in conversation so she can:
1. Talk about ongoing storylines naturally
2. Share unmentioned updates when appropriate
3. Reference storylines when asked "how are you?"
4. Bring up high-intensity storylines unprompted

**CRITICAL REQUIREMENT:** Storyline context should ONLY be injected on the **2nd user message** (not greeting, not every message).

**Why 2nd message only?**
- Greeting (1st message): Kayley doesn't have context yet
- 2nd message: She knows who the user is, can share updates naturally
- After 2nd message: Avoid token bloat by not repeating storyline context

**How it works:**
- LLM receives storyline context with salience scores
- LLM decides whether to mention storylines (not forced)
- Unmentioned updates are flagged for potential sharing
- Storylines affect conversation tone through mood system (Phase 3)

---

## 📁 Key Files to Read

### MUST READ FIRST:

1. **Feature Specification:**
   - `docs/features/Life_Event_Storylines.md`
   - Lines 721-827: Prompt Integration section (shows exact prompt format)
   - Lines 735-776: `buildStorylinePromptSection()` example
   - Lines 784-826: `buildStorylineGreetingContext()` example (NOT for greeting - for 2nd message!)

2. **Current Service Implementation:**
   - `src/services/storylineService.ts`
   - Find `getStorylinePromptContext()` function (STUBBED - needs implementation)
   - Lines 958-1031: PHASE_BEHAVIORS array (contains `promptGuidance` for each phase)

3. **System Prompt Builder:**
   - `src/services/system_prompts/builders/systemPromptBuilder.ts`
   - This is where storyline context needs to be injected
   - Look for message count logic or context injection patterns

4. **Phase 3 Summary (for context):**
   - `docs/Phase_3_Storylines_Implementation_Summary.md`

### HELPFUL REFERENCE:

5. **Service Documentation:**
   - `src/services/docs/StorylineService.md`
   - Search for "Prompt Integration" section (shows planned interface)

---

## 🔨 What Needs to Be Implemented

### Task 1: Implement `getStorylinePromptContext()` in `storylineService.ts`

**Current status:** Stubbed with console.log, returns empty object

**What it needs to do:**
1. Get all active storylines (outcome is null)
2. Get recent updates (last 7 days) that haven't been mentioned
3. Sort storylines by salience (combination of phase intensity and time since last mention)
4. Return structured context object

**Interface to implement:**
```typescript
export interface StorylinePromptContext {
  hasActiveStorylines: boolean;
  activeStorylines: LifeStoryline[];
  unmentionedUpdates: StorylineUpdate[];
  mostPressingStoryline: LifeStoryline | null;  // Highest salience
  promptSection: string;  // Pre-formatted prompt text
}
```

**Algorithm:**
1. Query active storylines (outcome is null)
2. Query unmentioned updates from last 7 days
3. Calculate salience for each storyline:
   ```typescript
   const phaseUrgency = {
     announced: 1.0,    // Just happened - high urgency
     climax: 1.0,       // Critical moment - high urgency
     resolving: 0.9,    // Outcome clear - want to share
     honeymoon: 0.6,    // Excited but not urgent
     reality: 0.5,      // Ongoing - medium salience
     active: 0.4,       // Background work - lower salience
     resolved: 0.2,     // Wrapped up - low salience
     reflecting: 0.1,   // Historical - very low salience
   };

   const salience = (phaseUrgency[phase] × emotionalIntensity) + (hasUnmentionedUpdate ? 0.3 : 0);
   ```
4. Sort by salience (highest first)
5. Build prompt section using `buildStorylinePromptSection()` helper
6. Return context object

**Reference:** See lines 726-776 in Life_Event_Storylines.md for prompt format example

---

### Task 2: Create `buildStorylinePromptSection()` Helper Function

**What it does:**
Formats active storylines into system prompt text that guides Kayley's behavior.

**Signature:**
```typescript
function buildStorylinePromptSection(
  activeStorylines: LifeStoryline[],
  unmentionedUpdates: StorylineUpdate[]
): string
```

**Format (from spec):**
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

[...repeat for each storyline...]

GUIDELINES:
- These are YOUR experiences. They affect YOUR mood.
- Don't info-dump. Mention things naturally when relevant.
- If user asks "how are you?" these might color your answer.
- You can bring things up unprompted if they're weighing on you.
- Share struggles genuinely. You don't have to be positive all the time.
```

**Implementation notes:**
- Only include storylines with emotionalIntensity > 0.3 (filter out low-intensity background storylines)
- Limit to top 5 storylines by salience (avoid token bloat)
- Include unmentioned updates with 📍 indicator
- Include stakes field for context
- Use `promptGuidance` from PHASE_BEHAVIORS configuration

---

### Task 3: Integrate with System Prompt Builder

**File:** `src/services/system_prompts/builders/systemPromptBuilder.ts`

**What needs to happen:**
1. Import `getStorylinePromptContext` from storylineService
2. Add message count parameter to `buildSystemPrompt()` function signature
3. **ONLY on 2nd user message** (messageCount === 2), call `getStorylinePromptContext()`
4. Inject `context.promptSection` into the prompt AFTER character identity but BEFORE output format rules
5. Do NOT inject on greeting (messageCount === 1) or subsequent messages (messageCount > 2)

**Pattern to follow:**
```typescript
// In buildSystemPrompt()
export async function buildSystemPrompt(
  soulContext: SoulLayerContext,
  relationship: RelationshipState | null,
  messageCount: number  // NEW PARAMETER
): Promise<string> {
  let prompt = '';

  // ... existing prompt sections ...

  // Inject storyline context ONLY on 2nd message
  if (messageCount === 2) {
    try {
      const { getStorylinePromptContext } = await import('../../storylineService');
      const storylineContext = await getStorylinePromptContext();

      if (storylineContext.hasActiveStorylines) {
        prompt += `\n${storylineContext.promptSection}\n`;
        console.log(`📖 [Storylines] Injected ${storylineContext.activeStorylines.length} storyline(s) into system prompt`);
      }
    } catch (error) {
      console.warn('📖 [Storylines] Failed to inject storyline context:', error);
      // Continue without storylines
    }
  }

  // ... rest of prompt (output format, etc.) ...

  return prompt;
}
```

**Important:**
- Use dynamic import to avoid circular dependencies
- Fail gracefully if storyline integration errors
- Only inject on exactly messageCount === 2 (not >=, not <=, exactly 2)
- Log when storylines are injected for debugging

---

### Task 4: Update Callers to Pass Message Count

**Where to update:**
1. Find all callers of `buildSystemPrompt()` in the codebase
2. Add message count tracking (count user messages in conversation)
3. Pass messageCount parameter to `buildSystemPrompt()`

**Likely locations:**
- `App.tsx` or main chat handler
- Greeting prompt builder (if separate)
- Any other prompt building code

**Pattern:**
```typescript
// Track message count
let userMessageCount = conversationHistory.filter(msg => msg.role === 'user').length;

// Pass to prompt builder
const systemPrompt = await buildSystemPrompt(soulContext, relationship, userMessageCount);
```

---

### Task 5: Add Logging

Use the `📖 [Storylines]` emoji prefix for all storyline-related logs.

**Example logs:**
```typescript
console.log(`📖 [Storylines] Building prompt context for ${activeStorylines.length} active storyline(s)`);
console.log(`📖 [Storylines] Most pressing: "${mostPressing.title}" (salience: ${salience.toFixed(2)})`);
console.log(`📖 [Storylines] Injected storylines into system prompt (message #${messageCount})`);
console.log(`📖 [Storylines] Skipping prompt injection (message #${messageCount}, only inject on #2)`);
```

---

### Task 6: Update Snapshot Tests

**What needs updating:**
- Snapshot tests for system prompt builder
- Tests will fail because prompt now includes storyline context on 2nd message
- Update snapshots: `npm test -- --run -t "snapshot" -u`

**Before updating:**
- Review diff carefully to ensure storyline section appears ONLY on 2nd message
- Verify section format matches spec

---

## 🧪 Testing Phase 4

### Manual Testing Steps

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

2. **Test prompt context function:**
   ```typescript
   import { getStorylinePromptContext } from './services/storylineService';

   const context = await getStorylinePromptContext();
   console.log('Context:', context);
   // Should show:
   // - hasActiveStorylines: true
   // - activeStorylines: [storyline]
   // - unmentionedUpdates: [update]
   // - mostPressingStoryline: storyline
   // - promptSection: formatted text
   ```

3. **Test system prompt integration:**
   - Start a conversation
   - Send 1st message (greeting): Check logs - should NOT inject storylines
   - Send 2nd message: Check logs - SHOULD inject storylines
   - Send 3rd message: Check logs - should NOT inject storylines

4. **Verify Kayley mentions storylines:**
   - On 2nd message, ask "how are you?"
   - Kayley should mention the storyline naturally
   - Check if unmentioned update is shared

---

## 📊 Expected Results

**Before Phase 4:**
- Storylines exist, progress, and affect mood
- But Kayley never talks about them in conversation

**After Phase 4:**
- On 2nd user message, Kayley receives storyline context
- She can mention storylines when relevant ("how are you?", "what's new?")
- She shares unmentioned updates naturally
- She brings up high-intensity storylines unprompted
- Storylines DON'T appear in greeting or later messages (token efficiency)

**Example flow:**
```
User: Hey Kayley!
Kayley: Hey! How's it going?  [No storyline context - 1st message]

User: Good! How are you?
Kayley: Good! Actually, kinda excited - a brand reached out about a partnership. They just sent over the contract and it's way more than I expected. Still processing it tbh.  [Storyline context injected - 2nd message]

User: That's awesome! Congrats!
Kayley: Thanks! Yeah I'm trying not to get ahead of myself but... this could be huge.  [No re-injection - already mentioned]
```

---

## ⚠️ Important Notes

### 1. No user_id Field
This is a single-user system. No `user_id` parameter anywhere.

### 2. 2nd Message Only
**CRITICAL:** Only inject on exactly messageCount === 2. NOT greeting, NOT every message.
- 1st message (greeting): No injection
- 2nd message: Inject once
- 3rd+ messages: No re-injection (already has context)

### 3. Salience vs. Forcing
- Salience scores help LLM prioritize
- LLM still decides whether to mention storylines
- Don't force mentions - let conversation flow naturally

### 4. Token Efficiency
- Limit to top 5 storylines max
- Filter out low-intensity storylines (< 0.3)
- Only include recent unmentioned updates (last 7 days)

### 5. Error Handling
- Wrap storyline integration in try-catch
- Continue without storylines if integration fails
- Log warnings on errors

---

## 🎓 Pattern Examples from Codebase

**How system prompt builder works:**
- Check existing `systemPromptBuilder.ts` structure
- Follow existing patterns for conditional sections
- Use async imports to avoid circular dependencies

**Message counting:**
- Look for existing message history handling in App.tsx
- Filter by `msg.role === 'user'` to count user messages
- Pass count to prompt builder

---

## ✅ Success Criteria

Phase 4 is complete when:
- [x] `getStorylinePromptContext()` implemented and returns correct structure
- [x] `buildStorylinePromptSection()` formats prompt text correctly
- [x] System prompt builder integrated with storyline context
- [x] Storyline context injected ONLY on 2nd user message
- [x] Message count tracking implemented
- [x] Kayley mentions storylines naturally in conversation
- [x] Unmentioned updates are surfaced appropriately
- [x] Snapshot tests updated
- [x] Code compiles without errors

---

## 📝 Deliverables

When you're done, create/update:
1. **Implementation Summary:** `docs/Phase_4_Storylines_Implementation_Summary.md`
2. **Update feature doc:** Mark Phase 4 as complete in `docs/features/Life_Event_Storylines.md`
3. **Update service doc:** Mark Phase 4 as complete in `src/services/docs/StorylineService.md`
   - Update Implementation Status section
   - Update `getStorylinePromptContext()` function documentation
4. **Update Phase 5 prompt:** Create `docs/Phase_5_Implementation_Prompt.md` for next phase

---

## 🚀 Next Phase After This

**Phase 5: Closure & Callbacks**
- Resolution flow for completed storylines
- Closure sequences (emotional processing)
- Historical callbacks ("remember when...")
- Integration with character facts for long-term memory

---

## 💡 Getting Started

**Recommended order:**
1. Read `docs/features/Life_Event_Storylines.md` lines 721-827 (prompt integration section)
2. Read current `storylineService.ts` to understand PHASE_BEHAVIORS structure
3. Implement `getStorylinePromptContext()` function
4. Implement `buildStorylinePromptSection()` helper
5. Find and read `systemPromptBuilder.ts` to understand structure
6. Add message count parameter to `buildSystemPrompt()`
7. Integrate storyline context injection (2nd message only)
8. Update callers to pass message count
9. Test with manual storyline creation
10. Update snapshot tests
11. Create implementation summary document

**Questions to answer before starting:**
1. Where exactly in the codebase is message history tracked?
2. How do I count user messages vs. assistant messages?
3. Where is `buildSystemPrompt()` currently called from?
4. What's the current system prompt structure?

---

## 📚 Reference Documentation

**Full specs:**
- Feature spec: `docs/features/Life_Event_Storylines.md`
- Service API: `src/services/docs/StorylineService.md`
- Phase 3 summary: `docs/Phase_3_Storylines_Implementation_Summary.md`

**Code files:**
- Storyline service: `src/services/storylineService.ts`
- System prompt builder: `src/services/system_prompts/builders/systemPromptBuilder.ts`
- Main app: `src/App.tsx`

---

## 🎯 Summary

**What you're implementing:**
Make Kayley talk about her storylines by:
1. Implementing `getStorylinePromptContext()` to gather active storylines
2. Building formatted prompt section with storyline context
3. Integrating into system prompt builder (2nd message ONLY)
4. Tracking message count to enable conditional injection

**Complexity:** Medium - requires system prompt integration and message tracking

**Start by reading:** `docs/features/Life_Event_Storylines.md` lines 721-827

Good luck! 🚀
