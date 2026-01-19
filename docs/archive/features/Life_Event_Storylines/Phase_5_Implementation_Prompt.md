# Phase 5: Life Event Storylines - Closure & Callbacks Implementation Prompt

**Context Window:** Use this prompt in a fresh Claude Code session to implement Phase 5.

---

## 📋 What You're Implementing

**Feature:** Life Event Storylines - Phase 5 (Closure & Callbacks)

**Goal:** Implement meaningful closure for completed storylines and enable historical callbacks ("remember when...") to make resolved storylines part of Kayley's long-term memory.

**Status:** Phases 1-4 are COMPLETE. Phase 5 needs implementation.

---

## ✅ What's Already Completed (Phases 1-4)

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

### Phase 4: Prompt Integration ✅
- `getStorylinePromptContext()` gathers active storylines with salience scores
- `buildStorylinePromptSection()` formats storylines into system prompt
- Storyline context injected ONLY on 2nd user message (token efficient)
- Message counting tracks user messages for conditional injection
- Kayley can now mention storylines naturally in conversation

**Current State:**
- Storylines progress through phases automatically
- Updates are generated realistically via LLM
- Storylines affect Kayley's mood and energy
- Kayley talks about storylines naturally in conversation
- BUT: Storylines don't have proper closure sequences
- AND: Resolved storylines can't be referenced later as callbacks

---

## 🎯 What Phase 5 Needs to Do

**Goal:** Add meaningful closure to storylines and enable historical callbacks.

Phase 5 completes the storyline lifecycle:

```
Phases 1-4 ✅ → Storylines progress, affect mood, get mentioned
Phase 5 ← YOU ARE HERE → Storylines resolve with closure & become memories
Phase 6 🔜 → Polish & testing
```

### 1. Resolution Flow
When a storyline reaches the `climax` or `resolving` phase, it needs to transition to resolution:

**Requirements:**
- Detect when a storyline should be resolved (manual trigger or automatic)
- Set the `outcome` field: `success`, `failure`, `abandoned`, or `transformed`
- Generate closure sequence (multiple updates over 3-5 days)
- Transition through `resolving` → `resolved` → `reflecting` phases
- Store resolution metadata (outcome description, resolution emotion)

**Outcome Types:**
- `success`: Goal achieved (celebrate, gratitude, pride)
- `failure`: Didn't work out (disappointment, acceptance, lessons learned)
- `abandoned`: Chose to stop (relief, certainty, redirection)
- `transformed`: Became something different (surprise, new beginning)

### 2. Closure Sequences
Closure isn't instant - it's a multi-day emotional processing journey:

**Requirements:**
- Generate 4 closure updates (one per day for 4 days)
- Each update follows outcome-specific template
- Updates surface organically (not all at once)
- Updates track emotional progression through closure
- Each outcome type has different closure steps

**Closure Steps by Outcome:**
- **Success:** announcement → gratitude → reflection → forward_looking
- **Failure:** announcement → processing → meaning_making → moving_forward
- **Abandoned:** announcement → reasoning → peace_making → redirect
- **Transformed:** announcement → explanation → feelings → new_beginning

### 3. Historical Callbacks
After a storyline is resolved (30+ days), it becomes part of Kayley's history:

**Requirements:**
- Get resolved storylines (resolved 30+ days ago)
- Select storylines that haven't been referenced recently (14+ days)
- Weight selection by emotional intensity
- Format callback prompt for natural reference
- Integrate with existing callback system
- Track last referenced timestamp

**Callback Use Cases:**
- User mentions similar situation
- User asks for advice
- Natural conversation opening
- Proactive thread surfacing
- "Remember when..." moments

### 4. Character Facts Integration
Significant storylines should become permanent character facts:

**Requirements:**
- After resolution, extract key learnings
- Store as character facts (using existing `characterFactsService`)
- Facts persist beyond storyline lifecycle
- Examples: "learned contract negotiation from brand deal", "discovered I can't handle 3 posts/week", "realized I value creative control"

---

## 📁 Key Files to Read

### MUST READ FIRST:

1. **Feature Specification:**
   - `docs/features/Life_Event_Storylines.md`
   - Lines 594-679: Resolution Templates & Closure Flow
   - Lines 686-717: Post-Resolution Callbacks
   - Lines 1080-1103: Full lifecycle example (Days 20-50)

2. **Current Service Implementation:**
   - `src/services/storylineService.ts`
   - Lines 1236-1296: Closure & Resolution section (STUBBED - needs implementation)
   - Lines 958-1031: PHASE_BEHAVIORS array (has `resolved` and `reflecting` phase configs)

3. **Phase 4 Summary (for context):**
   - `docs/Phase_4_Storylines_Implementation_Summary.md`

### HELPFUL REFERENCE:

4. **Service Documentation:**
   - `src/services/docs/StorylineService.md`
   - Search for "Closure" section

5. **Character Facts Service:**
   - `src/services/characterFactsService.ts`
   - `storeCharacterFact()` function - use this to persist learnings

6. **Callback Director:**
   - `src/services/callbackDirector.ts`
   - See how callbacks are currently structured
   - Integration point for storyline callbacks

---

## 🔨 What Needs to Be Implemented

### Task 1: Define Resolution Templates

**File:** `src/services/storylineService.ts`

**What it needs:**
Create `RESOLUTION_TEMPLATES` configuration object with closure steps and emotions for each outcome type.

**Interface:**
```typescript
interface ResolutionTemplate {
  emotions: string[];           // Possible emotions for this outcome
  promptGuidance: string;       // How to talk about this outcome
  closureSteps: UpdateType[];   // Sequence of updates
  moodImpact: number;           // Immediate mood effect
}

const RESOLUTION_TEMPLATES: Record<StorylineOutcome, ResolutionTemplate> = {
  success: {
    emotions: ['thrilled', 'relieved', 'proud', 'grateful', 'surreal'],
    promptGuidance: `You did it! Let yourself celebrate. Share the win genuinely. Thank people who supported you. It's okay to be proud.`,
    closureSteps: ['outcome_reaction', 'gratitude', 'reflection', 'lesson_learned'],
    moodImpact: 0.4,
  },
  failure: {
    emotions: ['disappointed', 'sad', 'frustrated', 'accepting', 'processing'],
    promptGuidance: `It didn't work out. Be honest about disappointment. Don't fake positivity. It's okay to be sad. You'll process this.`,
    closureSteps: ['outcome_reaction', 'emotional_processing', 'meaning_making', 'lesson_learned'],
    moodImpact: -0.3,
  },
  abandoned: {
    emotions: ['relieved', 'conflicted', 'peaceful', 'guilty', 'certain'],
    promptGuidance: `You chose to stop. That's valid. Explain why without over-justifying. Sometimes walking away is the right choice.`,
    closureSteps: ['outcome_reaction', 'emotional_processing', 'meaning_making', 'reflection'],
    moodImpact: 0.1,
  },
  transformed: {
    emotions: ['surprised', 'curious', 'excited', 'uncertain', 'open'],
    promptGuidance: `It became something different than expected. Life is weird like that. Share the surprise and what it's becoming.`,
    closureSteps: ['outcome_reaction', 'emotional_processing', 'reflection', 'lesson_learned'],
    moodImpact: 0.2,
  },
};
```

**Note:** Reuse existing `UpdateType` values from Phase 2 where possible.

---

### Task 2: Implement `resolveStoryline()` Function

**File:** `src/services/storylineService.ts` (lines 1243-1263, currently stubbed)

**Current stub:**
```typescript
export async function resolveStoryline(
  id: string,
  outcome: StorylineOutcome,
  outcomeDescription: string,
  resolutionEmotion?: string
): Promise<void> {
  console.log("[Storylines] Feature Not Implemented: Closure sequences (Phase 5)");

  await updateStoryline(id, {
    outcome,
    outcomeDescription,
    resolutionEmotion,
  });
}
```

**What it needs to do:**
1. Update storyline with outcome metadata
2. Generate closure sequence updates (4 updates, one per day)
3. Transition to `resolving` phase
4. Set `resolved_at` timestamp
5. Apply immediate mood impact
6. Log closure initiation

**Algorithm:**
```typescript
export async function resolveStoryline(
  id: string,
  outcome: StorylineOutcome,
  outcomeDescription: string,
  resolutionEmotion?: string
): Promise<void> {
  console.log(`📖 [Storylines] Resolving storyline ${id} with outcome: ${outcome}`);

  // Step 1: Get the storyline
  const storyline = await getStorylineById(id);
  if (!storyline) {
    console.error(`📖 [Storylines] Storyline not found: ${id}`);
    return;
  }

  // Step 2: Get resolution template
  const template = RESOLUTION_TEMPLATES[outcome];
  if (!template) {
    console.error(`📖 [Storylines] Invalid outcome type: ${outcome}`);
    return;
  }

  // Step 3: Update storyline to resolving phase
  await updateStoryline(id, {
    phase: 'resolving',
    outcome,
    outcomeDescription,
    resolutionEmotion: resolutionEmotion || template.emotions[0],
  });

  // Step 4: Generate closure sequence
  const closureUpdates = await generateClosureSequence(
    storyline,
    outcome,
    outcomeDescription,
    template
  );

  console.log(`📖 [Storylines] Generated ${closureUpdates.length} closure updates for "${storyline.title}"`);

  // Step 5: Apply immediate mood impact (optional - could integrate with moodKnobs)
  // This is a one-time boost/dip when resolution happens
  console.log(`📖 [Storylines] Resolution mood impact: ${template.moodImpact}`);
}
```

---

### Task 3: Implement `generateClosureSequence()` Helper

**File:** `src/services/storylineService.ts` (new function)

**What it does:**
Generates 4 closure updates (one per day) using LLM, based on the resolution template.

**Signature:**
```typescript
async function generateClosureSequence(
  storyline: LifeStoryline,
  outcome: StorylineOutcome,
  outcomeDescription: string,
  template: ResolutionTemplate
): Promise<StorylineUpdate[]>
```

**Algorithm:**
```typescript
async function generateClosureSequence(
  storyline: LifeStoryline,
  outcome: StorylineOutcome,
  outcomeDescription: string,
  template: ResolutionTemplate
): Promise<StorylineUpdate[]> {
  const closureUpdates: StorylineUpdate[] = [];

  // Generate one update per closure step (4 total)
  for (let i = 0; i < template.closureSteps.length; i++) {
    const updateType = template.closureSteps[i];
    const emotion = template.emotions[Math.floor(Math.random() * template.emotions.length)];

    const prompt = buildClosureUpdatePrompt(
      storyline,
      outcome,
      outcomeDescription,
      updateType,
      emotion,
      template.promptGuidance,
      i // Day number
    );

    // Call LLM to generate closure update
    const ai = getGeminiClient();
    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        maxOutputTokens: 300,
      }
    });

    const responseText = result.text || '{}';
    let parsed: any;
    try {
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('📖 [Storylines] Failed to parse closure update:', responseText);
      continue;
    }

    // Create the closure update
    const update = await addStorylineUpdate(storyline.id, {
      updateType: parsed.updateType as UpdateType,
      content: parsed.content,
      emotionalTone: parsed.emotionalTone,
    });

    if (update) {
      closureUpdates.push(update);
      console.log(`📖 [Storylines] Generated closure update ${i + 1}/4: [${update.updateType}] "${update.content.slice(0, 60)}..."`);
    }
  }

  return closureUpdates;
}
```

---

### Task 4: Implement `buildClosureUpdatePrompt()` Helper

**File:** `src/services/storylineService.ts` (new function)

**What it does:**
Builds the LLM prompt for generating a single closure update.

**Signature:**
```typescript
function buildClosureUpdatePrompt(
  storyline: LifeStoryline,
  outcome: StorylineOutcome,
  outcomeDescription: string,
  updateType: UpdateType,
  emotion: string,
  promptGuidance: string,
  dayNumber: number
): string
```

**Prompt format:**
```typescript
function buildClosureUpdatePrompt(
  storyline: LifeStoryline,
  outcome: StorylineOutcome,
  outcomeDescription: string,
  updateType: UpdateType,
  emotion: string,
  promptGuidance: string,
  dayNumber: number
): string {
  return `You are generating a closure update for Kayley's storyline.

STORYLINE:
Title: ${storyline.title}
Category: ${storyline.category}
Type: ${storyline.storylineType}
Outcome: ${outcome}
Outcome Description: "${outcomeDescription}"

CLOSURE CONTEXT:
This is day ${dayNumber + 1} of the closure sequence (4 days total).
Update Type: ${updateType}
Target Emotion: ${emotion}

GUIDANCE:
${promptGuidance}

Generate a realistic update that:
1. Reflects the ${updateType} stage of closure
2. Captures ${emotion} emotion authentically
3. Feels like genuine emotional processing (not forced positivity)
4. Is 1-2 sentences in Kayley's voice (first person, casual)
5. Advances the closure journey appropriately for day ${dayNumber + 1}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "updateType": "${updateType}",
  "content": "The closure update in Kayley's voice",
  "emotionalTone": "${emotion}"
}`;
}
```

---

### Task 5: Implement `initiateStorylineClosure()` Function

**File:** `src/services/storylineService.ts` (lines 1269-1280, currently stubbed)

**Current stub:**
```typescript
export async function initiateStorylineClosure(
  id: string,
  outcome: StorylineOutcome
): Promise<void> {
  console.log("[Storylines] Feature Not Implemented: initiateStorylineClosure (Phase 5)");
}
```

**What it needs to do:**
This is a convenience wrapper around `resolveStoryline()` that auto-generates the outcome description using LLM.

**Algorithm:**
```typescript
export async function initiateStorylineClosure(
  id: string,
  outcome: StorylineOutcome
): Promise<void> {
  console.log(`📖 [Storylines] Initiating closure for storyline ${id} with outcome: ${outcome}`);

  // Step 1: Get the storyline
  const storyline = await getStorylineById(id);
  if (!storyline) {
    console.error(`📖 [Storylines] Storyline not found: ${id}`);
    return;
  }

  // Step 2: Generate outcome description using LLM
  const outcomeDescription = await generateOutcomeDescription(storyline, outcome);

  // Step 3: Call resolveStoryline with generated description
  await resolveStoryline(id, outcome, outcomeDescription);
}
```

---

### Task 6: Implement `generateOutcomeDescription()` Helper

**File:** `src/services/storylineService.ts` (new function)

**What it does:**
Uses LLM to generate a natural outcome description based on the storyline and outcome type.

**Signature:**
```typescript
async function generateOutcomeDescription(
  storyline: LifeStoryline,
  outcome: StorylineOutcome
): Promise<string>
```

**Algorithm:**
```typescript
async function generateOutcomeDescription(
  storyline: LifeStoryline,
  outcome: StorylineOutcome
): Promise<string> {
  const template = RESOLUTION_TEMPLATES[outcome];

  const prompt = `Generate a brief outcome description for this storyline.

STORYLINE:
Title: ${storyline.title}
Category: ${storyline.category}
Type: ${storyline.storylineType}
Stakes: ${storyline.stakes || 'Not specified'}

OUTCOME: ${outcome}

Generate a 1-sentence description of what happened (outcome).
Examples:
- Success: "Signed the contract! I'm officially a partnered creator."
- Failure: "They went with someone else. Disappointing but I'll be okay."
- Abandoned: "Decided to walk away. The terms weren't right for me."
- Transformed: "The partnership turned into something completely different - now it's a collab instead of a contract."

Respond with ONLY the description (no quotes, no explanation):`;

  const ai = getGeminiClient();
  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 100,
    }
  });

  return result.text?.trim() || `Storyline ${outcome}`;
}
```

---

### Task 7: Implement `getResolvedStorylineForCallback()` Function

**File:** `src/services/storylineService.ts` (lines 1286-1296, currently stubbed)

**Current stub:**
```typescript
export async function getResolvedStorylineForCallback(): Promise<LifeStoryline | null> {
  console.log("[Storylines] Feature Not Implemented: getResolvedStorylineForCallback (Phase 5)");
  return null;
}
```

**What it needs to do:**
Select a resolved storyline for "remember when..." callbacks.

**Algorithm:**
```typescript
export async function getResolvedStorylineForCallback(): Promise<LifeStoryline | null> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Get resolved storylines from 30+ days ago
    const { data, error } = await supabase
      .from(STORYLINES_TABLE)
      .select('*')
      .not('outcome', 'is', null)
      .not('resolved_at', 'is', null)
      .lte('resolved_at', thirtyDaysAgo.toISOString())
      .or(`last_mentioned_at.is.null,last_mentioned_at.lte.${fourteenDaysAgo.toISOString()}`)
      .order('emotional_intensity', { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) {
      console.log('📖 [Storylines] No eligible resolved storylines for callback');
      return null;
    }

    // Weight by emotional intensity (higher intensity = more likely to be selected)
    const storylines = (data as StorylineRow[]).map(mapRowToStoryline);
    const totalWeight = storylines.reduce((sum, s) => sum + s.emotionalIntensity, 0);
    const random = Math.random() * totalWeight;

    let cumulativeWeight = 0;
    for (const storyline of storylines) {
      cumulativeWeight += storyline.emotionalIntensity;
      if (random <= cumulativeWeight) {
        console.log(`📖 [Storylines] Selected callback: "${storyline.title}" (${storyline.outcome})`);
        return storyline;
      }
    }

    return storylines[0]; // Fallback
  } catch (error) {
    console.error('📖 [Storylines] Error getting callback storyline:', error);
    return null;
  }
}
```

---

### Task 8: Integrate with Callback Director

**File:** `src/services/callbackDirector.ts`

**What needs to happen:**
Add storyline callbacks to the existing callback system.

**Pattern to follow:**
1. Look at how other callbacks are structured in `callbackDirector.ts`
2. Add a new callback type for storylines
3. Call `getResolvedStorylineForCallback()` during callback generation
4. Format the callback prompt appropriately

**Example integration:**
```typescript
// In callbackDirector.ts

import { getResolvedStorylineForCallback, markStorylineMentioned } from './storylineService';

// Add to callback generation function
async function generateCallbacks(): Promise<CallbackPrompt[]> {
  const callbacks: CallbackPrompt[] = [];

  // ... existing callback types ...

  // Add storyline callback
  const storylineCallback = await getResolvedStorylineForCallback();
  if (storylineCallback) {
    const daysSinceResolution = Math.floor(
      (Date.now() - storylineCallback.resolvedAt!.getTime()) / (1000 * 60 * 60 * 24)
    );

    callbacks.push({
      type: 'storyline_memory',
      priority: storylineCallback.emotionalIntensity,
      prompt: `You can reference "${storyline.title}" - a ${storyline.category} storyline from ${daysSinceResolution} days ago.

Outcome: ${storyline.outcome} - "${storyline.outcomeDescription}"

Natural ways to reference:
- "Remember when I was freaking out about ${storyline.title}? Wild."
- "That reminds me of when ${storyline.title}..."
${storyline.userInvolvement ? `- "I still think about how you helped me through ${storyline.title}"` : ''}

Only mention if contextually relevant. Don't force it.`,
    });

    // Mark as mentioned (update last_mentioned_at)
    await markStorylineMentioned(storylineCallback.id);
  }

  return callbacks;
}
```

---

### Task 9: Integrate Closure into Daily Processing

**File:** `src/services/storylineService.ts` (update `processStorylineDay()`)

**What needs to happen:**
After phase transitions, check if any storylines in `climax` phase should be auto-resolved.

**Pattern:**
```typescript
// In processStorylineDay()

export async function processStorylineDay(): Promise<void> {
  try {
    console.log('📖 [Storylines] ========== Daily Processing Started ==========');

    // Step 1: Check phase transitions
    await checkPhaseTransitions();

    // Step 2: Generate updates for active storylines
    const activeStorylines = await getActiveStorylines();
    // ... existing update generation logic ...

    // Step 3: Check for auto-resolution (NEW)
    // Storylines in 'climax' phase for 5+ days should auto-resolve
    const climaxStorylines = activeStorylines.filter(s => s.phase === 'climax');
    for (const storyline of climaxStorylines) {
      const daysInClimax = daysBetween(storyline.phaseStartedAt, new Date());

      if (daysInClimax >= 5) {
        console.log(`📖 [Storylines] Auto-resolving "${storyline.title}" (${daysInClimax} days in climax)`);

        // Randomly select outcome (weighted towards success/transformed)
        const outcomeWeights = { success: 0.5, transformed: 0.3, failure: 0.15, abandoned: 0.05 };
        const outcome = weightedRandomSelect(outcomeWeights);

        await initiateStorylineClosure(storyline.id, outcome as StorylineOutcome);
      }
    }

    console.log(`📖 [Storylines] ========== Daily Processing Complete ==========`);
  } catch (error) {
    console.error('📖 [Storylines] Error in daily processing:', error);
  }
}
```

---

### Task 10: Store Character Facts from Resolutions

**File:** `src/services/storylineService.ts` (update `resolveStoryline()`)

**What needs to happen:**
After generating closure sequence, extract learnings and store as character facts.

**Pattern:**
```typescript
// At the end of resolveStoryline()

// Step 6: Store learnings as character facts (Phase 5 enhancement)
if (outcome === 'success' || outcome === 'failure' || outcome === 'abandoned') {
  try {
    const learning = await extractStorylineLearning(storyline, outcome, outcomeDescription);
    if (learning) {
      await storeCharacterFact('experiences', `storyline_${storyline.id}`, learning);
      console.log(`📖 [Storylines] Stored learning as character fact: "${learning.slice(0, 60)}..."`);
    }
  } catch (error) {
    console.warn('📖 [Storylines] Failed to store storyline learning:', error);
  }
}
```

**Helper function:**
```typescript
async function extractStorylineLearning(
  storyline: LifeStoryline,
  outcome: StorylineOutcome,
  outcomeDescription: string
): Promise<string | null> {
  const prompt = `Extract a brief learning or insight from this storyline outcome.

STORYLINE: ${storyline.title}
OUTCOME: ${outcome} - "${outcomeDescription}"

What did Kayley learn from this experience? Keep it brief (1 sentence).
Examples:
- "learned that I need to negotiate for creative control in brand deals"
- "discovered I can't sustain 3 posts per week without burning out"
- "realized walking away is sometimes the right choice"

Respond with ONLY the learning (no quotes, no explanation):`;

  const ai = getGeminiClient();
  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.7, maxOutputTokens: 100 }
  });

  return result.text?.trim() || null;
}
```

---

## 🧪 Testing Phase 5

### Manual Testing Steps

1. **Create a test storyline in climax phase:**
   ```typescript
   import { createStoryline, updateStoryline } from './services/storylineService';

   const storyline = await createStoryline({
     title: "Test: Brand Partnership",
     category: "work",
     storylineType: "opportunity",
     phase: "announced",
     currentEmotionalTone: "excited",
     emotionalIntensity: 0.8,
     stakes: "Could be a big income boost",
   });

   // Fast-forward to climax
   await updateStoryline(storyline.id, { phase: 'climax' });
   ```

2. **Test manual resolution:**
   ```typescript
   import { resolveStoryline } from './services/storylineService';

   await resolveStoryline(
     storyline.id,
     'success',
     'Signed the contract! Officially partnered with the brand.',
     'thrilled'
   );
   ```

3. **Verify closure sequence:**
   - Check database: should have 4 new storyline_updates
   - Each update should have different updateType
   - Updates should progress through closure emotionally
   - Storyline phase should be 'resolving'

4. **Test callback selection:**
   ```typescript
   import { getResolvedStorylineForCallback } from './services/storylineService';

   // Fast-forward resolved_at to 31 days ago
   await supabase
     .from('life_storylines')
     .update({ resolved_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() })
     .eq('id', storyline.id);

   const callback = await getResolvedStorylineForCallback();
   console.log('Callback:', callback);
   // Should return the storyline
   ```

5. **Test character fact storage:**
   - After resolution, check character facts
   - Should see a new fact in 'experiences' category
   - Fact should describe the learning

---

## 📊 Expected Results

**Before Phase 5:**
- Storylines progress through phases
- Storylines affect mood
- Storylines get mentioned in conversation
- BUT: No proper closure when storylines end
- AND: Resolved storylines are forgotten

**After Phase 5:**
- Storylines resolve with emotional closure sequences
- Each outcome type has different emotional arc
- Closure updates surface over 4 days
- Resolved storylines become callbacks
- Learnings are stored as character facts
- Kayley can reference past storylines naturally

**Example closure flow:**

```
Day 20 - Resolution initiated (success):
Phase: resolving
Update 1: "I SIGNED IT. It's official. I'm partnered with the brand!"
Mood impact: +0.4

Day 21:
Update 2: "Still can't believe this is real. Thank you for being excited with me."

Day 22:
Update 3: "Looking back, the negotiation stress was worth it. I learned to fight for what I need."

Day 23:
Update 4: "Now I'm thinking about what comes next. This opens so many doors."
Phase: resolved

Day 60 (callback):
User: "I'm nervous about my job interview"
Kayley: "I totally get that. Remember when I was losing my mind over that brand partnership? The anxiety was REAL. But look how it turned out."
```

---

## ⚠️ Important Notes

### 1. No user_id Field
This is a single-user system. No `user_id` parameter anywhere.

### 2. Closure is Multi-Day
- Don't reveal all closure updates at once
- Space them out over 4 days
- Each day advances the emotional processing

### 3. Outcome Types
Four outcomes, each with different emotional trajectory:
- `success`: Celebration → gratitude → reflection
- `failure`: Disappointment → acceptance → learning
- `abandoned`: Relief → justification → peace
- `transformed`: Surprise → curiosity → new direction

### 4. Auto-Resolution Timing
- Storylines in `climax` for 5+ days auto-resolve
- Weighted towards positive outcomes (success: 50%, transformed: 30%)
- User can manually resolve earlier if desired

### 5. Callback Eligibility
- Must be resolved 30+ days ago
- Must not have been mentioned in last 14 days
- Weighted by emotional intensity (more intense = more likely)

### 6. Character Facts Integration
- Only store learnings for meaningful outcomes (success, failure, abandoned)
- Use existing `storeCharacterFact()` from characterFactsService
- Category: 'experiences'
- Key: `storyline_${id}`

### 7. Error Handling
- Wrap closure generation in try-catch
- Continue processing other storylines if one fails
- Log warnings on errors
- Graceful degradation

---

## ✅ Success Criteria

Phase 5 is complete when:
- [ ] `RESOLUTION_TEMPLATES` defined with all 4 outcome types
- [ ] `resolveStoryline()` implemented and generates closure sequences
- [ ] `generateClosureSequence()` creates 4 LLM-generated updates
- [ ] `buildClosureUpdatePrompt()` formats prompts correctly
- [ ] `initiateStorylineClosure()` auto-generates outcome descriptions
- [ ] `generateOutcomeDescription()` uses LLM to describe outcomes
- [ ] `getResolvedStorylineForCallback()` selects historical storylines
- [ ] Callback integration complete in `callbackDirector.ts`
- [ ] Auto-resolution logic added to `processStorylineDay()`
- [ ] Character facts stored from resolutions
- [ ] Manual testing shows proper closure flow
- [ ] Code compiles without errors

---

## 📝 Deliverables

When you're done, create/update:

1. **Implementation Summary:** `docs/Phase_5_Storylines_Implementation_Summary.md`
   - Document what was implemented
   - Show example closure sequences
   - Explain callback integration

2. **Update feature doc:** Mark Phase 5 as complete in `docs/features/Life_Event_Storylines.md`
   - Update implementation status at top
   - Mark Phase 5 checklist items

3. **Update service doc:** Mark Phase 5 as complete in `src/services/docs/StorylineService.md`
   - Update Implementation Status section
   - Document closure functions

4. **Update Phase 6 prompt (optional):** Create `docs/Phase_6_Implementation_Prompt.md` for testing phase

---

## 🚀 Next Phase After This

**Phase 6: Polish & Testing**
- End-to-end lifecycle testing
- Tune probabilities and timing
- Manual conversation testing
- Ensure storylines feel natural and authentic
- Performance optimization
- Documentation polish

---

## 💡 Getting Started

**Recommended order:**

1. Read `docs/features/Life_Event_Storylines.md` lines 594-717 (closure & callbacks)
2. Read current `storylineService.ts` closure section (lines 1236-1296)
3. Define `RESOLUTION_TEMPLATES` configuration
4. Implement `buildClosureUpdatePrompt()` helper
5. Implement `generateClosureSequence()` helper
6. Implement `generateOutcomeDescription()` helper
7. Implement `resolveStoryline()` main function
8. Implement `initiateStorylineClosure()` wrapper
9. Implement `extractStorylineLearning()` helper
10. Implement `getResolvedStorylineForCallback()` function
11. Integrate with `callbackDirector.ts`
12. Add auto-resolution to `processStorylineDay()`
13. Test with manual storyline creation
14. Verify closure sequences work
15. Test callback selection
16. Create implementation summary

**Questions to answer before starting:**

1. How should closure updates be spaced? (1 per day recommended)
2. Should auto-resolution happen in climax phase or wait longer?
3. What's the minimum emotional_intensity for callback eligibility?
4. Should we limit number of callbacks per session?

---

## 📚 Reference Documentation

**Full specs:**
- Feature spec: `docs/features/Life_Event_Storylines.md`
- Service API: `src/services/docs/StorylineService.md`
- Phase 4 summary: `docs/Phase_4_Storylines_Implementation_Summary.md`

**Code files:**
- Storyline service: `src/services/storylineService.ts`
- Character facts: `src/services/characterFactsService.ts`
- Callback director: `src/services/callbackDirector.ts`
- Mood knobs: `src/services/moodKnobs.ts`

---

## 🎯 Summary

**What you're implementing:**

Make storylines complete their lifecycle by:
1. Implementing meaningful closure sequences (4 updates over 4 days)
2. Adding resolution flow for all outcome types
3. Enabling historical callbacks for resolved storylines
4. Storing learnings as character facts

**Complexity:** Medium-High - requires LLM generation, multi-day sequences, callback integration

**Start by reading:** `docs/features/Life_Event_Storylines.md` lines 594-717

Good luck! 🚀
