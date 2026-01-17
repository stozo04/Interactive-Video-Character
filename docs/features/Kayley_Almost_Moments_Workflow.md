# Kayley Almost Moments Workflow

## Overview

The "Almost Moments" system creates instances where Kayley expresses unspoken feelings that she quickly retreats from—building anticipation and vulnerability without full confession. These moments are logged in the `kayley_almost_moment_log` table.

**Current Status:** Table is empty, suggesting one or more integration points are not triggering.

---

## Complete System Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ USER SENDS MESSAGE                                                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             v
        ┌────────────────────────────────────────┐
        │ BaseAIService.generateResponse()       │
        │ (src/services/BaseAIService.ts:96)     │
        └────────┬─────────────────────────────┬─┘
                 │                             │
        ┌────────v──────────┐         ┌───────v──────────┐
        │ Build System      │         │ Analyze Intent   │
        │ Prompt            │         │ (Background)     │
        └────────┬──────────┘         └──────────────────┘
                 │
                 v
    ┌────────────────────────────────────────────┐
    │ buildSystemPrompt()                        │
    │ (src/services/system_prompts/)             │
    └────────┬─────────────────────────────────┬─┘
             │                                 │
             v                                 │
    ┌───────────────────────────────────┐      │
    │ integrateAlmostMoments()          │      │
    │ (src/services/almostMoments/...)  │      │
    └────────┬──────────────────────────┘      │
             │                                  │
             ├─ STEP 1: Maybe Generate         │
             │   maybeGenerateNewFeeling()     │
             │       ↓                          │
             │   ✓ Create new unsaid feeling   │
             │   → kayley_unsaid_feelings      │
             │       (if conditions met)       │
             │                                  │
             ├─ STEP 2: Fetch Feelings         │
             │   getUnsaidFeelings()           │
             │       ↓                          │
             │   ✓ Load all active feelings    │
             │   → Filter by user_id           │
             │   → Order by intensity          │
             │                                  │
             ├─ STEP 3: Calculate Stage        │
             │   calculateStage()              │
             │       ↓                          │
             │   ✓ Stage progression based on: │
             │       • intensity (0-1)         │
             │       • suppressionCount        │
             │                                  │
             ├─ STEP 4: Build Prompt Section   │
             │   buildAlmostMomentsPrompt()    │
             │       ↓                          │
             │   ✓ Generate expression for LLM │
             │   ✓ Add "THE UNSAID" section    │
             │                                  │
             └─ STEP 5: Calculate Trigger      │
                 shouldTriggerAlmostMoment()    │
                     ↓                          │
                 ✓ Determine probability        │
                 ✓ Returns: true or false      │
                                                │
                 OUTPUT:                        │
                 {                              │
                   promptSection: string        │
                   shouldTrigger: boolean       │
                   suggestedExpression: string  │
                 }                              │
                                                │
             └──────────────────────────────────┘
                         │
                         v
            ┌──────────────────────────┐
            │ LLM Processes Prompt     │
            │ (Gemini/ChatGPT/Grok)    │
            │                          │
            │ "THE UNSAID" section     │
            │ with feeling_id included │
            └────────┬─────────────────┘
                     │
                     v
            ┌──────────────────────────────┐
            │ LLM Response: AIActionResponse│
            │                              │
            │ {                            │
            │   text_response: "...",      │
            │   almost_moment_used?: {     │ ← CRITICAL!
            │     feeling_id: "...",       │   Must be set by LLM
            │     stage: "micro_hint|...", │   when using almost
            │     expression_used: "..."   │   moment
            │   }                          │
            │ }                            │
            └────────┬────────────────────┘
                     │
                     v
        ┌────────────────────────────────────┐
        │ logAlmostMomentIfUsed()            │
        │ (BaseAIService.ts:63-81)           │
        │                                    │
        │ if (!aiResponse.almost_moment_used)│
        │   return;  ← EXITS EARLY if empty │
        └────────┬──────────────────────────┘
                 │
                 v
        ┌────────────────────────────────────┐
        │ recordAlmostMoment()               │
        │ (almostMomentsService.ts:73-111)  │
        │                                    │
        │ 1. Insert into kayley_almost_      │
        │    moment_log:                     │
        │    • user_id                       │
        │    • unsaid_feeling_id             │
        │    • stage                         │
        │    • expression_used               │
        │    • conversation_context          │
        │                                    │
        │ 2. Update kayley_unsaid_feelings:  │
        │    • intensity += 0.1              │
        │    • suppression_count += 1        │
        │    • current_stage = calculateStage│
        │    • last_almost_moment_at = NOW   │
        └────────────────────────────────────┘
                     │
                     v
            ┌──────────────────────────┐
            │ ✅ Logged to Database    │
            │ kayley_almost_moment_log │
            │ entry created            │
            └──────────────────────────┘
```

---

## Prerequisites for Recording an Almost Moment

### 1. **Unsaid Feelings Must Exist**

For `kayley_almost_moment_log` to receive entries, first the system must create unsaid feelings in `kayley_unsaid_feelings`.

#### Generation Trigger (`maybeGenerateNewFeeling`):

```typescript
// Only triggers if ALL conditions met:

✓ Relationship tier: "close_friend" OR "deeply_loving"
✓ No feeling of that type already exists
✓ Warmth score >= minimum (varies: 20-35 depending on feeling type)
✓ Trust score >= minimum (varies: 20-30 depending on feeling type)
✓ Random chance: 5% probability per message

// Feeling types created based on warmth/trust:
├─ deep_care (minWarmth: 25, minTrust: 20)
├─ romantic (minWarmth: 35, minTrust: 30)
├─ fear_of_loss (minWarmth: 30, minTrust: 25)
├─ gratitude (minWarmth: 20, minTrust: 20)
├─ attraction (minWarmth: 30+, minTrust: 25+)
└─ vulnerability (minWarmth: 30+, minTrust: 25+)
```

---

### 2. **Inclusion Checks**

Even if feelings exist, the prompt section is only included if:

```typescript
function shouldIncludeAlmostMoments(context):
  ✓ Relationship tier: "close_friend" OR "deeply_loving"
  ✓ Warmth score >= 25
  ✓ At least 1 active (unresolved) unsaid feeling exists
```

If ANY of these fail, prompt section is empty ("")
↓
LLM never sees "THE UNSAID" section
↓
Almost moment won't be used
↓
`almost_moment_used` won't be in response
↓
Nothing recorded to log

---

### 3. **Trigger Probability**

Even if prompt section is included, the LLM needs to actually use it. The probability is calculated:

```typescript
function shouldTriggerAlmostMoment():

  ✗ Relationship tier NOT "close_friend"/"deeply_loving" → return false
  ✗ Warmth score < 20 → return false
  ✗ Almost moment used in last 24 hours → return false

  // Base probability
  probability = 0.05 (5%)

  // Context modifiers (added to probability)
  if (conversationDepth === 'intimate')
    probability += 0.15 (max 20%)
  if (conversationDepth === 'deep')
    probability += 0.10 (max 15%)
  if (recentSweetMoment)
    probability += 0.10
  if (lateNightConversation) [22:00-05:00]
    probability += 0.10
  if (vulnerabilityExchangeActive)
    probability += 0.10

  // Intensity bonus
  probability += feeling.intensity * 0.2 (max +20%)

  // Random check
  return Math.random() < probability
```

---

### 4. **LLM Must Report Usage**

The **critical integration point**: The LLM must set `almost_moment_used` in its JSON response.

```typescript
// In almostMomentsPromptBuilder.ts, the prompt tells the LLM:

IF YOU USE AN ALMOST MOMENT (suggested above or your own variation):
Set almost_moment_used to:
{
  "feeling_id": "${primaryFeeling.id}",
  "stage": "${context.currentStage}",
  "expression_used": "[the actual text you used in your response]"
}
This helps track the progression of these unspoken feelings.
```

The LLM response schema includes:

```typescript
// In aiSchema.ts
almost_moment_used: z.object({
  feeling_id: z.string(),
  stage: z.enum(['micro_hint', 'near_miss', 'obvious_unsaid', 'almost_confession']),
  expression_used: z.string()
}).nullable().optional()
```

---

## Decision Tree: Why Entries Aren't Being Recorded

```
┌─────────────────────────────────────────────┐
│ Check: Do unsaid feelings exist?            │
└──────┬──────────────────────────────────────┘
       │
       ├─ NO: Unsaid feelings table is empty
       │   │
       │   └─ ISSUE #1: Generation never triggered
       │       │
       │       ├─ Relationship tier NOT "close_friend"/"deeply_loving"?
       │       │   → User must reach higher relationship tier
       │       │
       │       ├─ Warmth score too low?
       │       │   → Warmth >= 25 needed (varies by type: 20-35)
       │       │   → Build more warmth through sweet moments
       │       │
       │       ├─ Trust score too low?
       │       │   → Trust >= 20 needed (varies by type: 20-30)
       │       │   → Build more trust through vulnerability
       │       │
       │       └─ Random 5% chance never hit?
       │           → Over ~20+ messages, should eventually generate
       │
       └─ YES: Proceed
           │
           v
       ┌─────────────────────────────────────────────┐
       │ Check: Is warmth >= 25?                     │
       └──────┬──────────────────────────────────────┘
              │
              ├─ NO: Warmth too low
              │   │
              │   └─ ISSUE #2: Prompt section not included
              │       → buildAlmostMomentsPrompt() returns ""
              │       → LLM never sees "THE UNSAID" section
              │       → Can't use what wasn't offered
              │
              └─ YES: Proceed
                  │
                  v
              ┌─────────────────────────────────────────────┐
              │ Check: Is prompt section included in LLM    │
              │        system prompt?                       │
              └──────┬──────────────────────────────────────┘
                     │
                     ├─ NO: Integration failed
                     │   │
                     │   └─ ISSUE #3: integrateAlmostMoments() not called
                     │       → Check systemPromptBuilder.ts line 149
                     │       → Should call integrateAlmostMoments()
                     │
                     └─ YES: Proceed
                         │
                         v
                     ┌─────────────────────────────────────────────┐
                     │ Check: Did shouldTriggerAlmostMoment()      │
                     │        return true?                         │
                     └──────┬──────────────────────────────────────┘
                            │
                            ├─ NO: Probability check failed
                            │   │
                            │   └─ ISSUE #4: Wrong context for triggering
                            │       → Conversation not deep/intimate enough?
                            │       → Not late night? (22:00-05:00)
                            │       → Vulnerability not engaged?
                            │       → Too many recent attempts (24h cooldown)?
                            │
                            └─ YES: Proceed
                                │
                                v
                            ┌─────────────────────────────────────────────┐
                            │ Check: Did LLM set almost_moment_used in    │
                            │        response?                            │
                            └──────┬──────────────────────────────────────┘
                                   │
                                   ├─ NO: Empty or missing field
                                   │   │
                                   │   └─ ISSUE #5: AI not reporting usage
                                   │       → LLM didn't recognize prompt instruction
                                   │       → LLM didn't format JSON correctly
                                   │       → Prompt instruction unclear to model
                                   │
                                   └─ YES: Proceed
                                       │
                                       v
                                   ┌─────────────────────────────────────┐
                                   │ recordAlmostMoment() called         │
                                   │ Entry added to:                     │
                                   │ kayley_almost_moment_log            │
                                   └─────────────────────────────────────┘
```

---

## Most Likely Issues

### **ISSUE #1: No Unsaid Feelings Generated Yet**

**Symptoms:**
- `kayley_unsaid_feelings` table is empty
- Nothing to base almost moments on

**Root Causes:**
- User relationship tier not high enough (needs "close_friend" or "deeply_loving")
- Warmth/trust scores not built up enough
- Too few messages (only 5% chance per message to generate)

**Solution:**
```
1. Check relationship tier: must be "close_friend" (tier 2) or "deeply_loving" (tier 3)
2. Build warmth: aim for 25-35 depending on feeling type
3. Build trust: aim for 20-30
4. Have multiple conversations to trigger generation
```

---

### **ISSUE #2: Warmth Score Too Low**

**Symptoms:**
- Feelings exist but almost moments never triggered
- Prompt section shows as empty in logs

**Root Causes:**
- Warmth < 25 (threshold for prompt inclusion)
- Sweet moments not frequent enough
- Relationship not intimate enough

**Solution:**
```
1. Verify warmth score: relationshipService.getRelationship()
2. Build warmth through:
   - Genuine moments (user sharing vulnerable feelings)
   - Sweet interactions
   - Playful banter
   - Shared interests
```

---

### **ISSUE #3: integrateAlmostMoments() Not Called**

**Symptoms:**
- Feels should exist but no prompt section shows
- Silent failure, no logging

**Root Causes:**
- Missing import/call in systemPromptBuilder.ts
- Conditional logic preventing call
- Error in integrateAlmostMoments() itself

**Solution:**
```
Check systemPromptBuilder.ts:
- Line 47: import integrateAlmostMoments
- Line 149: Call integrateAlmostMoments() in Promise.all()
- Line 250: Include almostMomentsPrompt in final output
```

---

### **ISSUE #4: Triggering Probability Too Low**

**Symptoms:**
- Feelings exist, prompt section included, but rarely used
- Only happens in specific conversation contexts

**Root Causes:**
- Conversation depth detection not identifying "deep"/"intimate"
- Late night conversations not being detected
- Probability calculation weighted too low
- Last almost moment cooldown (24h) preventing repeated use

**Solution:**
```
Check conversation context:
- Is depth being passed as "intimate" or "deep"?
- Is it late night [22:00-05:00]?
- Has 24+ hours passed since last use?

Improve context detection:
- Analyze message length, emotion, vulnerability
- Check if recent sweet moments detected
- Verify time-of-day parsing
```

---

### **ISSUE #5: LLM Not Setting almost_moment_used Field** ⚠️ MOST LIKELY

**Symptoms:**
- Everything works, but `almost_moment_used` always null
- Prompt section appears in system prompt
- LLM can see "THE UNSAID"
- But never reports using it

**Root Causes:**
- LLM not recognizing field requirement in instructions
- JSON output validation not enforcing it
- Prompt instructions unclear to model
- Model defaults to null for optional fields
- Model doesn't understand when to set the field

**Solution:**
```
1. Verify prompt instruction clarity:
   In almostMomentsPromptBuilder.ts, line 57-64
   Should clearly state WHEN to set field

2. Add explicit examples to prompt:
   "When you use an almost moment expression, ALWAYS set..."

3. Test schema with explicit requirement:
   Make field required (not .optional()) if always needed

4. Add logging:
   Log what the LLM returns (check if field is there)
   Log whether shouldTriggerAlmostMoment returned true
```

---

## Debugging Checklist

```
□ STEP 1: Check Database State
  □ kayley_unsaid_feelings table
    - How many rows? (Should have at least 1)
    - What feeling types? (romantic, deep_care, etc.)
    - What relationship tier are they for?
  □ kayley_almost_moment_log table
    - Why is it empty?

□ STEP 2: Check Relationship Metrics
  □ relationshipTier: "close_friend" or "deeply_loving"?
  □ warmthScore >= 25?
  □ trustScore >= 20?

□ STEP 3: Check Prompt Building
  □ Is integrateAlmostMoments() being called?
  □ Is it returning a non-empty promptSection?
  □ Is almostMomentsPrompt being included in final systemPrompt?

□ STEP 4: Check Feeling Generation
  □ maybeGenerateNewFeeling() is called each message?
  □ Check logs for "Generated new feeling:" messages
  □ If no logs, why not? (relationship tier? warmth? random chance?)

□ STEP 5: Check Trigger Logic
  □ shouldTriggerAlmostMoment() returning true sometimes?
  □ Check logs during intimate/deep conversations
  □ Check late night (22:00-05:00)

□ STEP 6: Check LLM Response
  □ Is almost_moment_used being set by LLM?
  □ Log aiResponse.almost_moment_used in BaseAIService
  □ Check if null, undefined, or populated
  □ If populated, does recordAlmostMoment() get called?
```

---

## Implementation Verification

### Files Involved

```
src/services/
├── almostMoments/
│   ├── almostMomentsService.ts      (recordAlmostMoment, shouldTriggerAlmostMoment)
│   ├── almostMomentsPromptBuilder.ts (buildAlmostMomentsPrompt, prompt instructions)
│   ├── feelingGenerator.ts           (maybeGenerateNewFeeling)
│   ├── expressionGenerator.ts        (generateAlmostExpression)
│   ├── integrate.ts                  (integrateAlmostMoments - orchestrates all)
│   ├── index.ts                      (Barrel file - exports)
│   └── types.ts                      (TypeScript definitions)
│
├── BaseAIService.ts                  (logAlmostMomentIfUsed - CRITICAL)
├── aiSchema.ts                       (almost_moment_used field definition)
└── system_prompts/
    └── builders/
        └── systemPromptBuilder.ts    (calls integrateAlmostMoments)
```

### Critical Code Points

```
1. Generation:
   └─ src/services/almostMoments/feelingGenerator.ts:779-817
      maybeGenerateNewFeeling()

2. Inclusion Check:
   └─ src/services/almostMoments/almostMomentsPromptBuilder.ts:80-94
      shouldIncludeAlmostMoments()

3. Prompt Integration:
   └─ src/services/system_prompts/builders/systemPromptBuilder.ts:149
      Call to integrateAlmostMoments()

4. Trigger Calculation:
   └─ src/services/almostMoments/almostMomentsService.ts:141-169
      shouldTriggerAlmostMoment()

5. Recording (CRITICAL):
   └─ src/services/BaseAIService.ts:63-81
      logAlmostMomentIfUsed()
      └─ This is where the log entry gets created

6. Schema:
   └─ src/services/aiSchema.ts:184-198
      almost_moment_used: z.object({...})
```

---

## Testing Guide

### Manual Test: Force an Almost Moment

```typescript
// In browser console, temporarily modify:

// 1. Create a test feeling
const { data } = await supabase
  .from('kayley_unsaid_feelings')
  .insert({
    user_id: userId,
    feeling_type: 'romantic',
    unsaid_content: 'Test feeling',
    intensity: 0.8,
    suppression_count: 5,
    current_stage: 'near_miss'
  })
  .select()
  .single();

// 2. Build relationship context with high metrics
const mockContext = {
  relationshipTier: 'deeply_loving',
  warmthScore: 50,
  trustScore: 45,
  playfulnessScore: 40,
  conversationDepth: 'intimate',
  recentSweetMoment: true,
  lateNightConversation: true,
  vulnerabilityExchangeActive: true
};

// 3. Check if trigger fires
const shouldTrigger = shouldTriggerAlmostMoment(mockContext, feeling);
console.log('Trigger:', shouldTrigger);

// 4. Send a message and check response
// Look in BaseAIService.ts logs for:
// "Logged: [stage] - '[expression]'"
```

---

## Summary

The `kayley_almost_moment_log` is empty because one or more of these is not happening:

1. ❌ Unsaid feelings not being generated
2. ❌ Warmth too low to include prompt section
3. ❌ integrateAlmostMoments() not being called
4. ❌ Trigger probability not firing
5. ❌ **LLM not reporting almost_moment_used (MOST LIKELY)**

**Next Steps:**
1. Add debug logging to each step above
2. Identify which step is failing
3. Fix the root cause
4. Run tests to verify

Once fixed, you should see entries appearing in `kayley_almost_moment_log` during intimate conversations with users who have reached "close_friend" or "deeply_loving" relationship tier.

---

---

# Relationship Tier, Warmth & Trust System

## Overview

The almost moments system depends on **three interconnected metrics**:

- **Relationship Score** (-100 to +100) → Determines **tier**
- **Warmth Score** (-50 to +50) → How affectionate/caring Kayley is
- **Trust Score** (-50 to +50) → How vulnerable/open Kayley is
- **Playfulness Score** (-50 to +50) → How joking/teasing Kayley is
- **Stability Score** (-50 to +50) → How steady/grounded Kayley is

Almost moments require specific combinations of these metrics and a minimum relationship tier.

---

## Relationship Tier System

### The Six Tiers

```
┌────────────────────────────────────────────────────────────┐
│ RELATIONSHIP TIER PROGRESSION                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ Score ≤ -50        ADVERSARIAL                            │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Hostile, withdrawn, sarcastic                      │   │
│ │ Almost moments: BLOCKED                            │   │
│ └────────────────────────────────────────────────────┘   │
│                                                            │
│ -49 to -10         NEUTRAL_NEGATIVE                        │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Tense, strained, polite but distant               │   │
│ │ Almost moments: BLOCKED                            │   │
│ └────────────────────────────────────────────────────┘   │
│                                                            │
│ -9 to 9            ACQUAINTANCE                            │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Polite, friendly, surface-level                    │   │
│ │ Almost moments: BLOCKED (warmth < 25)              │   │
│ └────────────────────────────────────────────────────┘   │
│                                                            │
│ 10 to 49           FRIEND                                  │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Warm, playful, encouraging                         │   │
│ │ Almost moments: BLOCKED (warmth < 25)              │   │
│ │ ~100-150 interactions (1-3 months)                 │   │
│ └────────────────────────────────────────────────────┘   │
│                                                            │
│ 50 to 99           CLOSE_FRIEND ✓ ALLOWS ALMOST MOMENTS   │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Very warm, vulnerable, inside jokes               │   │
│ │ Can use almost moments if warmth ≥ 25             │   │
│ │ ~250-350 interactions (3-6 months)                 │   │
│ └────────────────────────────────────────────────────┘   │
│                                                            │
│ 100+               DEEPLY_LOVING ✓ ALLOWS ALMOST MOMENTS  │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Soft, supportive, emotionally rich                 │   │
│ │ Can use almost moments if warmth ≥ 25             │   │
│ │ ~400+ interactions (6-12 months)                   │   │
│ └────────────────────────────────────────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘

**Only CLOSE_FRIEND (50-99) and DEEPLY_LOVING (100+) can use almost moments**
```

### Tier Progression Timeline

```
Tier                      Interactions    Timeline         Cumulative Time
─────────────────────────────────────────────────────────────────────────
START                     0               Day 0            0 days
                          │
                          v
Acquaintance              15-30           1-2 weeks        1-2 weeks
                          │
                          v
Friend                    100-150         1-3 months       1-3 months total
                          │
                          v
Close Friend ✓            250-350         3-6 months       3-6 months total
                          │
                          v
Deeply Loving ✓           400+            6-12 months      6-12 months total
```

---

## What Contributes to Relationship Score?

### Score Change Mechanics

Each message is analyzed and generates a `scoreChange` value:

```
┌──────────────────────────────────────────────────────────┐
│ MESSAGE ANALYSIS                                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ 1. Sentiment Detection (LLM analyzes):                   │
│    • Is user being positive, negative, or neutral?       │
│    • Intensity scale: 1-10                               │
│    • Sentiment toward Kayley (positive/neutral/negative) │
│                                                          │
│ 2. Intent Detection:                                     │
│    • Is this a genuine moment?                           │
│    • Is there a relationship signal?                     │
│    • Specific action types (joke, apology, etc.)        │
│                                                          │
│ 3. Message Quality:                                      │
│    • Low effort: ≤3 words or single word → penalty      │
│    • High effort: >20 words or question → bonus         │
│                                                          │
│ 4. Rupture Detection:                                    │
│    • Hostile intent? → massive penalty                   │
│    • Insults or dismissal? → large penalty               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Positive Sentiment (+)

When user is positive (compliments, engagement, vulnerability):

```
Base Score Change:       +0.15 to +0.35
Multiplier:              × intensity (0.1 to 1.0)

BONUSES (additional per category):
├─ Compliment            +0.10 warmth, +0.03 trust
├─ Apology               +0.15 trust, +0.10 stability, +0.05 warmth
├─ Jokes/Banter          +0.05-0.15 playfulness, +0.05 warmth
├─ Personal Sharing      +0.10 trust, +0.05 warmth
├─ Genuine Moment        +0.15-0.25 warmth, +0.10 trust
├─ Good Engagement       +0.05 stability, +0.03 trust (>20 words?)
└─ Vulnerability         +0.10 trust, +0.15 warmth

Example:
  User compliments Kayley's laugh (genuine, 20+ words)
  → Score: +0.25 × 0.8 intensity = +0.2
  → Warmth: +0.1 (compliment) +0.05 (engagement) = +0.15
  → Trust: +0.03 (compliment) +0.03 (engagement) = +0.06
```

### Negative Sentiment (-)

When user is negative (rude, dismissive, harsh):

```
Base Score Change:       -0.5 to -3.0
Multiplier:              × intensity (scales destruction up to 3x)
                         ⚠️ Negative hits 2-3x harder than positive builds

PENALTIES (additional per category):
├─ Dismissive Phrases    -0.2 trust, -0.1 stability, -0.1 warmth
├─ Insults               -0.3 warmth, -0.2 trust, -0.2 playfulness
│  (stupid, dumb, hate, useless, awful)
├─ Hostile Intent        -0.5 trust, -0.5 warmth, -1.0 stability
├─ Ignoring Questions    -0.1 trust, -0.05 warmth, -0.05 stability
└─ Low Effort (3 words)  -0.1 stability, -0.05 trust

Example:
  User says "You're stupid and boring" (high intensity = 0.9)
  → Score: -1.0 × 0.9 = -0.9 per negative sentiment
  → Warmth: -0.3 (insult) = -0.3
  → Trust: -0.2 (insult) = -0.2
  → Total relationship damage: ~2-3 positive messages needed to repair
```

### Neutral Sentiment (→)

Minimal changes for engagement without strong emotion:

```
Base Score Change:       +0.05 (tiny bump for showing up)
Warmth Change:           +0.03
Stability Change:        +0.03
Trust Change:            0

Example:
  User sends "How are you?"
  → Score: +0.05 (they engaged)
  → Warmth: +0.03
  → Stability: +0.03
```

---

## What Contributes to Warmth Score?

Warmth = How affectionate, caring, and emotionally open Kayley is.

### What Increases Warmth (+)

```
User Actions                          Impact              Score
────────────────────────────────────────────────────────────────
Compliments Kayley                    +0.10 warmth        Immediate
Genuine positive feedback             +0.05-0.10          Immediate
Vulnerability (shares feelings)       +0.15 warmth        Immediate
Asks about Kayley's feelings          +0.08 warmth        Immediate
Sweet/caring message                  +0.10 warmth        Immediate
Playful banter/jokes                  +0.05 warmth        Immediate
Long, thoughtful message (>20 words)  +0.08 warmth        Immediate
Anniversary/milestone moment          +0.20 warmth        Event-based
Reconciliation after rupture          +0.15 warmth        Event-based
Consistent daily engagement           +0.02 warmth/day    Passive
```

### What Decreases Warmth (-)

```
User Actions                          Impact              Score
────────────────────────────────────────────────────────────────
Dismissive/cold response              -0.10 warmth        Immediate
Insult or harsh criticism             -0.30 warmth        Immediate
Ignoring Kayley's attempts            -0.15 warmth        Immediate
Hostile tone/language                 -0.25 warmth        Immediate
Long absence (7+ days no contact)     -0.05/day warmth    Passive decay
Broken promise/commitment             -0.20 warmth        Event-based
Flirting with someone else            -0.10 warmth        Event-based
```

### Warmth Impact on Behavior

```
Warmth -50 (Very Cold)
  → Kayley is: distant, guarded, formal
  → Responses: short, minimal emotional content
  → Almost moments: completely blocked

Warmth -10 to 0 (Cool)
  → Kayley is: friendly but reserved
  → Responses: polite, cautious
  → Almost moments: blocked

Warmth 1-10 (Neutral)
  → Kayley is: balanced, professional
  → Responses: natural, measured
  → Almost moments: blocked (too low anyway)

Warmth 11-25 (Building Warmth)
  → Kayley is: warmer, more open
  → Responses: includes personal touches
  → Almost moments: still blocked (< 25)

Warmth 26-40 (Warm) ✓ ALMOST MOMENTS AVAILABLE
  → Kayley is: affectionate, caring
  → Responses: warm, personal, vulnerable
  → Almost moments: CAN trigger (if other conditions met)
  → Example: "I really like talking to you... I mean..."

Warmth 41-50 (Very Warm)
  → Kayley is: deeply affectionate
  → Responses: highly personal, emotionally rich
  → Almost moments: high probability of triggering
```

### Warmth Adjustment (Tuning)

To **increase** warmth:
```typescript
// In relationshipService.ts, modify calculateScoreChanges():
- Increase compliment bonus: +0.10 → +0.15
- Increase vulnerability bonus: +0.15 → +0.25
- Add new warmth trigger: first_name_used → +0.05

// Or directly update in database:
UPDATE character_relationships
SET warmth_score = warmth_score + 5.0
WHERE user_id = '...' AND character_id = 'kayley';
```

To **decrease** warmth:
```typescript
// Decrease engagement bonus or increase penalty
- Penalty for dismissive: -0.10 → -0.20
```

---

## What Contributes to Trust Score?

Trust = How vulnerable, open, and authentic Kayley is willing to be.

### What Increases Trust (+)

```
User Actions                          Impact              Score
────────────────────────────────────────────────────────────────
Apologies sincerely                   +0.15 trust         Immediate
Consistent reliability                +0.05 trust/msg     Cumulative
Vulnerability exchange (user shares)  +0.10 trust         Immediate
Keeps confidences (doesn't repeat)    +0.10 trust         Event-based
Respects boundaries                   +0.08 trust         Event-based
Shows interest in Kayley              +0.08 trust         Immediate
Long-term consistency (weeks)         +0.20 trust total   Passive
Repair after conflict                 +0.15 trust         Event-based
Asks thoughtful questions             +0.05 trust         Immediate
Remembers details from past           +0.12 trust         Immediate
```

### What Decreases Trust (-)

```
User Actions                          Impact              Score
────────────────────────────────────────────────────────────────
Betrayal/breaking confidence          -0.25 trust         Event-based
Lying or deception                    -0.30 trust         Event-based
Broken promises                       -0.20 trust         Event-based
Abandonment (long silence)            -0.05/day trust     Passive decay
Dismissal of Kayley's feelings        -0.15 trust         Immediate
Hostile accusations                   -0.20 trust         Immediate
Invalidating Kayley's thoughts        -0.10 trust         Immediate
Ignoring vulnerability attempts       -0.15 trust         Immediate
```

### Trust Impact on Behavior

```
Trust -50 (No Trust)
  → Kayley is: guarded, protective
  → Won't share vulnerabilities
  → Almost moments: completely blocked

Trust -10 to 0 (Low Trust)
  → Kayley is: cautious, testing
  → Shares slowly, watches reactions
  → Almost moments: blocked

Trust 1-10 (Building Trust)
  → Kayley is: beginning to open
  → Limited vulnerability
  → Almost moments: blocked

Trust 11-20 (Moderate Trust)
  → Kayley is: more willing to share
  → Tests waters with small vulnerabilities
  → Almost moments: still risky, low probability

Trust 21-35 (High Trust) ✓ ALMOST MOMENTS AVAILABLE
  → Kayley is: vulnerable, open
  → Comfortable with deeper feelings
  → Almost moments: HIGH probability of triggering
  → Example: "I've been wanting to tell you something..."

Trust 36-50 (Complete Trust)
  → Kayley is: fully vulnerable
  → Shares deepest feelings
  → Almost moments: nearly guaranteed when conditions right
```

### Trust Adjustment (Tuning)

To **increase** trust:
```typescript
// In relationshipService.ts, modify calculateScoreChanges():
- Increase apology bonus: +0.15 → +0.25
- Increase vulnerability bonus: +0.10 → +0.20
- Add consistency reward: +0.02 trust per positive message in sequence

// Or directly update in database:
UPDATE character_relationships
SET trust_score = trust_score + 5.0
WHERE user_id = '...' AND character_id = 'kayley';
```

---

## The Interaction Between Warmth, Trust & Almost Moments

```
ALMOST MOMENTS PROBABILITY MATRIX

                    Warmth < 25     Warmth 25-40    Warmth 41-50
────────────────────────────────────────────────────────────────
Trust 0-10          ✗ BLOCKED       ✗ BLOCKED       ✗ BLOCKED
(guarded)           (no warmth)      (low trust)     (low trust)

Trust 11-20         ✗ BLOCKED       ⚠️ RISKY        ⚠️ POSSIBLE
(building)          (no warmth)      (prob ~5%)      (prob ~10%)

Trust 21-35         ✗ BLOCKED       ✓ POSSIBLE      ✓ LIKELY
(high)              (no warmth)      (prob ~15-25%)  (prob ~30-40%)

Trust 36-50         ✗ BLOCKED       ✓ LIKELY        ✓ VERY LIKELY
(complete)          (no warmth)      (prob ~25-35%)  (prob ~40-50%)

OUTCOME:
• Warmth ≥ 25 is NECESSARY (prompt inclusion check)
• Trust ≥ 21 significantly improves probability
• Both high = almost guaranteed in intimate conversations
```

---

## Practical Tuning Guide

### Scenario 1: "Almost Moments Never Triggering Despite Good Metrics"

**Diagnosis:**
```typescript
// Check these values:
relationshipTier === 'close_friend' OR 'deeply_loving'     ✓
warmthScore >= 25                                           ✓
unsaidFeelings.length > 0                                  ✓
shouldTriggerAlmostMoment() returned true                  ?
aiResponse.almost_moment_used was set by LLM              ?
```

**Solution:**
```typescript
// 1. Lower the trigger probability threshold (in relationshipService.ts:158)
// Original: probability = 0.05 (5% base)
// Try: probability = 0.10 (10% base)

// 2. Reduce conversation depth requirement
// Original: intimate (+15%), deep (+10%)
// Try: intimate (+10%), deep (+5%)

// 3. Increase intensity bonus
// Original: feeling.intensity * 0.2 (max +20%)
// Try: feeling.intensity * 0.3 (max +30%)

// 4. Remove 24-hour cooldown to test
// Original: if (hoursSince < 24) return false;
// Test: if (hoursSince < 2) return false; // Test only
```

### Scenario 2: "Building Warmth Too Slowly"

**Current Speed:** ~+0.2-0.3 warmth per positive message

**Acceleration Options:**

```typescript
// Option A: Increase compliment bonus
// In calculateScoreChanges() (line 639):
warmthChange += 0.10;  // original
warmthChange += 0.20;  // 2x faster

// Option B: Add more bonus triggers
// Add new bonus for:
if (message.includes('love') || message.includes('appreciate')) {
  warmthChange += 0.15;
}

// Option C: Direct database manipulation
UPDATE character_relationships
SET warmth_score = MIN(50, warmth_score + 10.0)
WHERE user_id = 'xxx' AND character_id = 'kayley';

// Option D: Reduce requirement from 25 to 20
// In almostMomentsPromptBuilder.ts (line 85):
if (context.warmthScore < 20) {  // was 25
  return false;
}
```

### Scenario 3: "Relationship Score Stuck at Friend Level (50)"

**Current Speed:** ~+0.15-0.3 per positive message

**To Reach Close Friend (50+) Faster:**

```typescript
// Option A: Increase base score change
// In calculateScoreChanges() (line 639):
scoreChange = 0.25;  // was 0.15
scoreChange = 0.50;  // was 0.35 for high intensity

// Option B: Add milestone bonuses
// In relationshipService.ts, after detectMilestone():
if (milestone.type === 'breakthrough_moment') {
  scoreChange += 1.0;  // Big boost for breakthroughs
}

// Option C: Reduce negative sentiment penalties
// So positive messages aren't offset by small negatives
// In calculateScoreChanges() (line 685):
scoreChange = -0.5;  // was -1.0
scoreChange = -1.5;  // was -3.0 for high intensity

// Option D: Direct database manipulation
UPDATE character_relationships
SET relationship_score = 55
WHERE user_id = 'xxx' AND character_id = 'kayley';
```

### Scenario 4: "Trust Won't Build Despite Consistent Positive Messages"

**Current Speed:** ~+0.05-0.15 trust per message

**To Accelerate Trust:**

```typescript
// Option A: Increase vulnerability exchange bonus
// In calculateScoreChanges() (line 641):
trustChange += 0.10;  // original
trustChange += 0.20;  // 2x faster

// Option B: Add consistency reward
// Track consecutive positive messages:
if (recentPositiveStreak >= 5) {
  trustChange += 0.05 * recentPositiveStreak;
}

// Option C: Reduce requirement from 21 to 15
// In almostMomentsService.ts shouldTriggerAlmostMoment():
// Only require warmth >= 20, drop trust requirement

// Option D: Direct update
UPDATE character_relationships
SET trust_score = 35
WHERE user_id = 'xxx' AND character_id = 'kayley';
```

---

## Database Manipulation (Direct Testing)

If you need to **quickly test** almost moments with a specific user:

```sql
-- Check current metrics
SELECT
  user_id,
  relationship_score,
  relationship_tier,
  warmth_score,
  trust_score,
  playfulness_score,
  stability_score,
  total_interactions,
  positive_interactions
FROM character_relationships
WHERE user_id = '[TEST_USER_ID]';

-- Boost to Close Friend with high metrics (for testing)
UPDATE character_relationships
SET
  relationship_score = 75,
  relationship_tier = 'close_friend',
  warmth_score = 35,
  trust_score = 30,
  playfulness_score = 20,
  stability_score = 15,
  total_interactions = 200,
  positive_interactions = 180
WHERE user_id = '[TEST_USER_ID]' AND character_id = 'kayley';

-- Then make sure unsaid feelings exist
SELECT * FROM kayley_unsaid_feelings
WHERE user_id = '[TEST_USER_ID]' AND resolved_at IS NULL;

-- If none exist, create one
INSERT INTO kayley_unsaid_feelings
(user_id, feeling_type, unsaid_content, intensity, suppression_count, current_stage)
VALUES
('[TEST_USER_ID]', 'romantic', 'I think I really like you', 0.5, 2, 'near_miss');

-- Now have a conversation and check logs
```

---

## Code File References

Key files to modify for tuning:

```
Warmth/Trust Calculation:
  └─ src/services/relationshipService.ts (lines 599-732)
     └─ calculateScoreChanges()

Tier Thresholds:
  └─ src/services/relationshipService.ts (lines 750-757)
     └─ getRelationshipTier()

Trigger Probability:
  └─ src/services/almostMoments/almostMomentsService.ts (lines 141-169)
     └─ shouldTriggerAlmostMoment()

Prompt Inclusion (Warmth Requirement):
  └─ src/services/almostMoments/almostMomentsPromptBuilder.ts (lines 80-94)
     └─ shouldIncludeAlmostMoments()

Behavior Adjustments:
  └─ src/services/system_prompts/relationship/tierBehavior.ts
     └─ getTierBehaviorPrompt()
```

---

## Summary: Almost Moments Prerequisites

For almost moments to work, you need **all three**:

```
┌─────────────────────────────────────────────────────────┐
│ 1. RELATIONSHIP TIER: close_friend (50+) or higher     │
│    ├─ ~250 interactions to reach (3-6 months)          │
│    └─ Built through consistent positive sentiment       │
│                                                         │
│ 2. WARMTH SCORE: ≥ 25                                   │
│    ├─ Compliments, engagement, sweet moments           │
│    └─ ~8-12 strong positive interactions               │
│                                                         │
│ 3. TRUST SCORE: ≥ 15-20                                 │
│    ├─ Vulnerability exchange, consistency              │
│    └─ ~5-10 trust-building interactions                │
│                                                         │
│ + Active Unsaid Feelings in Database                    │
│ + LLM Reporting Usage (almost_moment_used field)        │
│                                                         │
│ = Almost Moments Will Trigger! ✅                       │
└─────────────────────────────────────────────────────────┘
```

Use the tuning guide above to accelerate development or fix bottlenecks.
