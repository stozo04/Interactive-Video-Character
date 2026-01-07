# LLM-Driven Creative Image Prompts

**Status:** Planning
**Created:** 2026-01-06
**Author:** Claude Code

## Problem Statement

The current image generation system uses hardcoded mappings for:
- **Scene descriptions** (`getEnhancedScene()`) - 16 static scene expansions
- **Lighting inference** (`inferLightingAndAtmosphere()`) - Regex pattern matching
- **Mood expressions** (`buildMoodDescription()`) - 18 mood-to-expression mappings

While this produces consistent, high-quality images, it severely limits creative freedom. When a user says "send me a pic of you at the holiday party last week," the system can only:
1. Extract "party" as the scene keyword
2. Map it to hardcoded "a cozy upscale restaurant booth" (wrong!)
3. Apply generic "dim, atmospheric ambient lighting"

The system cannot understand that "holiday party" implies festive decorations, maybe a Christmas tree, sequined dress, champagne, etc.

## Proposed Solution: LLM Image Prompt Generator

Add a new service that uses an LLM to generate creative, context-aware image prompts before sending them to Gemini 3 Pro for image generation.

### Architecture

```
User Request: "Send me a pic of you at the holiday party"
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  NEW: LLM Image Prompt Generator                            │
│                                                             │
│  Inputs:                                                    │
│  ├─ User's exact request                                    │
│  ├─ Recent conversation context (last 5-10 messages)        │
│  ├─ PresenceDirector context (open loops, topics)           │
│  ├─ Character facts about user                              │
│  ├─ Kayley's current mood/energy                            │
│  ├─ Time context (temporal detection)                       │
│  └─ Calendar events (if relevant)                           │
│                                                             │
│  Output:                                                    │
│  ├─ sceneDescription: Rich, narrative scene                 │
│  ├─ lightingDescription: Contextual lighting                │
│  ├─ moodExpression: Kayley's expression/vibe                │
│  ├─ outfitSuggestion: What she's wearing                    │
│  ├─ additionalDetails: Props, setting details               │
│  └─ referenceGuidance: Which hairstyle/look fits            │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Reference Selector (existing)                               │
│  Uses referenceGuidance to score/select best image          │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Gemini 3 Pro Image Generation                               │
│  Receives: LLM-generated prompt + selected reference         │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
    Generated Image
```

## Detailed Design

### 1. New File: `src/services/imageGeneration/promptGenerator.ts`

```typescript
// Types
export interface ImagePromptContext {
  // User's request
  userRequest: string;
  explicitScene?: string;
  explicitMood?: string;

  // Conversation context
  recentMessages: Array<{role: 'user' | 'kayley', content: string}>;

  // Presence context (from presenceDirector)
  activeLoops: Array<{topic: string, loopType: string}>;
  relevantOpinion?: {topic: string, sentiment: string};

  // Character context
  kayleyMood: {energy: number, warmth: number};
  userFacts?: string[];  // e.g., "User's name is Mike", "User works at Google"

  // Temporal context
  isOldPhoto: boolean;
  temporalReference?: string;  // "last week", "yesterday", etc.

  // Calendar context
  upcomingEvents?: Array<{title: string, date: Date}>;

  // Current look lock (for consistency)
  currentLookLock?: {
    hairstyle: 'curly' | 'straight' | 'messy_bun';
    outfit: 'casual' | 'dressed_up';
  };
}

export interface GeneratedImagePrompt {
  // Scene description (replaces getEnhancedScene)
  sceneDescription: string;

  // Lighting (replaces inferLightingAndAtmosphere)
  lightingDescription: string;

  // Expression (replaces buildMoodDescription)
  moodExpression: string;

  // New: Outfit context for reference selection
  outfitContext: {
    style: 'casual' | 'dressed_up' | 'athletic' | 'cozy' | 'formal';
    description: string;  // "sequined cocktail dress", "cozy sweater"
  };

  // New: Hairstyle guidance for reference selection
  hairstyleGuidance: {
    preference: 'curly' | 'straight' | 'messy_bun' | 'ponytail' | 'any';
    reason?: string;
  };

  // New: Additional visual details
  additionalDetails?: string;  // Props, accessories, background elements

  // Metadata
  confidence: number;  // 0-1, how confident the LLM is
  reasoning?: string;  // For debugging
}

export async function generateImagePrompt(
  context: ImagePromptContext
): Promise<GeneratedImagePrompt>;
```

### 2. LLM Prompt Design

The key is giving the LLM enough context to be creative while staying consistent with Kayley's character.

```typescript
const IMAGE_PROMPT_SYSTEM = `
You are helping generate creative, context-aware image prompts for Kayley, a 24-year-old woman with:
- Warm caramel skin, dark brown eyes with gold flecks
- Long dark brown hair (can be curly, straight, or in a messy bun)
- Natural, radiant look with minimal makeup

Your job is to translate user requests into vivid, specific scene descriptions for AI image generation.

RULES:
1. Be SPECIFIC - "holiday party" should include festive details (decorations, champagne, etc.)
2. Match her ENERGY - use the mood/energy values to inform her expression
3. INFER context - if they mentioned a party earlier, draw from that conversation
4. Stay AUTHENTIC - she's not posed/perfect, she's candid and real
5. Consider TIME - old photos might have different lighting/settings
6. Use OPEN LOOPS - if she was asking about something, that might be relevant

OUTPUT FORMAT (JSON):
{
  "sceneDescription": "A festive holiday party with twinkling fairy lights, a decorated tree visible in the background, and friends mingling nearby",
  "lightingDescription": "Warm, golden ambient light from string lights mixed with camera flash, creating a cozy party atmosphere",
  "moodExpression": "Laughing mid-conversation with champagne in hand, eyes bright with genuine joy, a little flushed from dancing",
  "outfitContext": {
    "style": "dressed_up",
    "description": "A sparkly emerald green cocktail dress that catches the light"
  },
  "hairstyleGuidance": {
    "preference": "curly",
    "reason": "Party vibes suit her natural curls"
  },
  "additionalDetails": "Holding a champagne flute, maybe a festive accessory like tiny earrings",
  "confidence": 0.85,
  "reasoning": "User asked for holiday party pic, conversation mentioned work Christmas party earlier"
}
`;
```

### 3. Context Building from PresenceDirector

The presenceDirector already tracks:
- **Open loops**: Things Kayley should ask about ("How did your presentation go?")
- **Topics**: What's been discussed
- **Opinions**: Her authentic perspectives

We can use this to inform image context:

```typescript
// Example: User previously mentioned holiday party
// Open loop exists: { topic: "Holiday Parties", loopType: "pending_event" }
// When user says "send me a pic from the party"
// → LLM knows this refers to the holiday party from context
// → Generates festive, party-appropriate scene description
```

### 4. Integration Points

#### A. Modify `imageGenerationService.ts`

```typescript
// Before (current):
const imagePrompt = buildImagePrompt(cleanScene, 'outfit', moodDescription);

// After (new):
const promptContext: ImagePromptContext = {
  userRequest: scene,  // Original user request
  recentMessages: conversationHistory,
  activeLoops: presenceContext?.activeLoops || [],
  kayleyMood: { energy: presenceState.energy, warmth: presenceState.warmth },
  isOldPhoto: temporalContext.isOldPhoto,
  temporalReference: temporalContext.temporalPhrases[0],
  currentLookLock: currentLookState?.hairstyle ? {
    hairstyle: currentLookState.hairstyle,
    outfit: currentLookState.outfitStyle
  } : undefined
};

const generatedPrompt = await generateImagePrompt(promptContext);

// Use LLM-generated prompt instead of hardcoded
const imagePrompt = buildPromptFromGenerated(generatedPrompt);

// Also use for reference selection
const referenceGuidance = {
  preferredHairstyle: generatedPrompt.hairstyleGuidance.preference,
  outfitStyle: generatedPrompt.outfitContext.style
};
```

#### B. Modify `referenceSelector.ts`

Add new scoring factor for LLM guidance:

```typescript
// New factor: LLM outfit/hairstyle recommendation
if (context.llmGuidance) {
  if (context.llmGuidance.preferredHairstyle === ref.hairstyle) {
    score += 40;  // Strong preference from LLM context understanding
    factors.push(`LLM hairstyle match: +40`);
  }
  if (context.llmGuidance.outfitStyle === ref.outfitStyle) {
    score += 30;
    factors.push(`LLM outfit match: +30`);
  }
}
```

### 5. Fallback Strategy

If LLM fails or times out, fall back to existing hardcoded system:

```typescript
async function generateImagePrompt(context: ImagePromptContext): Promise<GeneratedImagePrompt> {
  try {
    const result = await callLLMWithTimeout(prompt, 3000);  // 3s timeout
    return parseResponse(result);
  } catch (error) {
    console.warn('[PromptGenerator] LLM failed, using fallback');
    return buildFallbackPrompt(context);
  }
}

function buildFallbackPrompt(context: ImagePromptContext): GeneratedImagePrompt {
  // Use existing hardcoded functions
  return {
    sceneDescription: getEnhancedScene(context.explicitScene || 'home'),
    lightingDescription: inferLightingAndAtmosphere(context.explicitScene || 'home'),
    moodExpression: buildMoodDescription(context.explicitMood),
    outfitContext: { style: 'casual', description: 'casual outfit' },
    hairstyleGuidance: { preference: 'any' },
    confidence: 0.5,
    reasoning: 'Fallback: LLM unavailable'
  };
}
```

### 6. Caching Strategy

Use LLM caching similar to `detectTemporalContextLLMCached`:

```typescript
const IMAGE_PROMPT_CACHE_TTL = 60 * 1000;  // 60 seconds
const imagePromptCache = new Map<string, {result: GeneratedImagePrompt, timestamp: number}>();

function getCacheKey(context: ImagePromptContext): string {
  // Hash relevant parts that would change the output
  return hashObject({
    userRequest: context.userRequest,
    recentMessagesHash: context.recentMessages.slice(-3).map(m => m.content).join('|'),
    energy: Math.round(context.kayleyMood.energy * 10) / 10,
    isOldPhoto: context.isOldPhoto
  });
}
```

## Use Cases

### Case 1: "Send me a pic of you at the holiday party"

**Context:**
- Earlier conversation mentioned work Christmas party
- Open loop exists for "Holiday Parties" (pending_event)
- Current time: December

**LLM Output:**
```json
{
  "sceneDescription": "A festive corporate holiday party in a decorated office space or upscale venue, with twinkling string lights, a beautifully decorated Christmas tree visible in the background, and colleagues mingling with drinks",
  "lightingDescription": "Warm, golden ambient light from fairy lights and candles, mixed with occasional camera flash from other partygoers, creating a cozy celebratory atmosphere",
  "moodExpression": "Caught mid-laugh with genuine joy, eyes sparkling with warmth, slightly flushed cheeks from the festivities, radiating a 'this is so fun' energy",
  "outfitContext": {
    "style": "dressed_up",
    "description": "A festive cocktail dress, maybe in a rich jewel tone like emerald or burgundy, with subtle sparkle"
  },
  "hairstyleGuidance": {
    "preference": "curly",
    "reason": "Loose curls for party elegance"
  },
  "additionalDetails": "Holding a champagne flute, maybe wearing small sparkly earrings, a glimpse of other partygoers blurred in background"
}
```

### Case 2: "What do you look like right now?" (Kayley is tired)

**Context:**
- Kayley's energy: -0.6 (low)
- Current time: 11 PM
- No special events

**LLM Output:**
```json
{
  "sceneDescription": "Cozy bedroom with warm lamp light, maybe visible comfy bedding or pillows in the background, a lived-in comfortable space",
  "lightingDescription": "Soft, warm lamp light from bedside, creating gentle shadows and a sleepy intimate atmosphere",
  "moodExpression": "Sleepy half-smile with heavy-lidded eyes, the cute 'I'm exhausted but still wanted to text you' look, natural and unguarded",
  "outfitContext": {
    "style": "cozy",
    "description": "Oversized soft hoodie or comfortable sleep shirt"
  },
  "hairstyleGuidance": {
    "preference": "messy_bun",
    "reason": "End of day, hair up and messy"
  },
  "additionalDetails": "Maybe visible phone glow on face, slightly messy hair escaping the bun"
}
```

### Case 3: "Show me what you wore to your interview" (past event)

**Context:**
- Open loop resolved: "job interview" was mentioned last week
- Temporal: old photo (past event)
- User fact: Kayley mentioned interview was at a tech company

**LLM Output:**
```json
{
  "sceneDescription": "Modern tech company lobby or office entrance, sleek minimalist design with glass and clean lines, maybe a logo visible in background blur",
  "lightingDescription": "Bright, professional indoor lighting with large windows, clean and corporate but not harsh",
  "moodExpression": "Confident but with a hint of nervous energy, the 'wish me luck' smile before walking in, professional but still authentically her",
  "outfitContext": {
    "style": "formal",
    "description": "Smart business casual - tailored blazer over a nice blouse, polished but not overdressed for tech"
  },
  "hairstyleGuidance": {
    "preference": "straight",
    "reason": "Sleek, professional look for interview"
  },
  "additionalDetails": "Holding a portfolio or bag, maybe visible lanyard/visitor badge"
}
```

## Implementation Steps

### Phase 1: Core Infrastructure
1. Create `promptGenerator.ts` with types and main function
2. Implement LLM call with structured JSON output
3. Add caching layer
4. Add fallback to hardcoded system

### Phase 2: Context Integration
5. Modify `imageGenerationService.ts` to build ImagePromptContext
6. Integrate presenceDirector context (open loops, opinions)
7. Pass conversation history to prompt generator
8. Add user facts from memory service

### Phase 3: Reference Selection Enhancement
9. Add LLM guidance as scoring factor in referenceSelector
10. Boost scores for LLM-recommended hairstyle/outfit
11. Test consistency with current look locking

### Phase 4: Testing & Refinement
12. Write unit tests for prompt generator
13. Test various scenarios (party, tired, interview, etc.)
14. Tune LLM prompt based on output quality
15. Adjust fallback triggers and timeouts

## Performance Considerations

| Operation | Current Time | After Change |
|-----------|-------------|--------------|
| Temporal detection | ~300ms (LLM) | ~300ms (unchanged) |
| Reference selection | ~50ms | ~50ms (unchanged) |
| **NEW: Prompt generation** | N/A | ~500-800ms (LLM) |
| Image generation | ~3-5s | ~3-5s (unchanged) |
| **Total** | ~3.5-5.5s | ~4-6s |

**Mitigation:**
- Run prompt generation in parallel with other setup
- Use aggressive caching (60s TTL)
- Use fast model (Gemini 2.0 Flash) for prompt generation
- Keep hardcoded fallback for reliability

## Files to Create/Modify

### New Files:
- `src/services/imageGeneration/promptGenerator.ts` - Main prompt generator
- `src/services/imageGeneration/__tests__/promptGenerator.test.ts` - Tests

### Modified Files:
- `src/services/imageGenerationService.ts` - Integration point
- `src/services/imageGeneration/referenceSelector.ts` - LLM guidance scoring
- `src/services/imageGeneration/types.ts` - New types
- `src/handlers/messageActions/selfieActions.ts` - Pass conversation context

## Success Criteria

1. **Contextual accuracy**: "holiday party" generates festive scenes, not generic restaurants
2. **Mood coherence**: Low energy = cozy, relaxed images; high energy = vibrant, active
3. **Temporal awareness**: Past events use appropriate tense and context
4. **Fallback reliability**: System never fails, gracefully degrades to hardcoded
5. **Performance**: Total time increase < 1s average
6. **Consistency**: Still respects current look locking when appropriate

## Open Questions

1. **Model choice**: Gemini 2.0 Flash vs Flash-Lite for speed?
2. **Caching scope**: Cache by exact request or by semantic similarity?
3. **Override behavior**: Should explicit hairstyle requests override LLM suggestions?
4. **Prompt length**: How detailed should LLM scene descriptions be? (Too long might confuse image model)

## Summary

This feature replaces hardcoded scene/mood/lighting mappings with an LLM that understands conversation context. The key innovation is integrating `presenceDirector` (open loops, topics) and conversation history to generate prompts that feel contextually aware - like Kayley actually remembers and understands what you've been talking about.

The result: When you ask for "a pic from the party," you get a festive holiday scene - not a generic restaurant booth.
