# Multi-Reference Image Implementation Plan

## Overview

This plan transforms the image generation service from using a single static reference image to a dynamic system that selects from multiple reference images based on hairstyle, outfit formality, mood, scene, and temporal context. The goal is to make selfies feel realistic and varied while maintaining visual consistency within the same timeframe.

---

## Selfie Generation Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SELFIE REQUEST START                            │
│  User: "Send me a selfie" OR Kayley spontaneously sends one            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    GATHER CONTEXT (Parallel)                            │
│ ┌─────────────────┐ ┌──────────────────┐ ┌─────────────────────────┐  │
│ │  User Message   │ │ Conversation     │ │  Presence Context       │  │
│ │  + Scene        │ │ History (last 5) │ │  (outfit, mood, loc)    │  │
│ └─────────────────┘ └──────────────────┘ └─────────────────────────┘  │
│ ┌─────────────────┐ ┌──────────────────┐ ┌─────────────────────────┐  │
│ │ Calendar Events │ │ Current Season   │ │  Time of Day            │  │
│ │ (next 2 hours)  │ │ (winter/spring)  │ │  (morning/eve/night)    │  │
│ └─────────────────┘ └──────────────────┘ └─────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               STEP 1: LLM TEMPORAL DETECTION (Gemini Flash)             │
│                                                                         │
│  Input: Scene + User Message + Conversation History                    │
│  Question: Is this an OLD PHOTO or CURRENT PHOTO?                      │
│                                                                         │
│  LLM analyzes:                                                          │
│  ✓ "from last week" → OLD PHOTO (timeframe: last_week)                 │
│  ✓ "right now" → CURRENT PHOTO (timeframe: now)                        │
│  ✓ "Remember when we talked about X? Here I am!" → CURRENT PHOTO       │
│                                                                         │
│  Output: { isOldPhoto, timeframe, confidence, reasoning }              │
│  Cache: 30s TTL by conversation context hash                           │
│  Latency: ~200ms (parallel with other calls)                           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              STEP 2: CHECK CURRENT LOOK STATE (Supabase)                │
│                                                                         │
│  Query: current_look_state table for user_id                           │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Found locked look?                                              │   │
│  │ - hairstyle: "curly"                                            │   │
│  │ - reference_image_id: "curly_casual"                            │   │
│  │ - locked_at: 2025-01-15 08:30 AM                                │   │
│  │ - expires_at: 2025-01-16 08:30 AM (24h lock)                    │   │
│  │ - lock_reason: "first_selfie_of_day"                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Decision: Should we use locked look?                                  │
│  ├─ If OLD PHOTO → UNLOCK (different day = different look OK)          │
│  ├─ If expired → UNLOCK (natural expiration)                           │
│  └─ If CURRENT PHOTO + valid → USE LOCKED LOOK ✓                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                    ┌────────────┴──────────────┐
                    │                           │
         LOCKED LOOK VALID?          LOCKED LOOK INVALID/OLD PHOTO?
                    │                           │
                    ▼                           ▼
    ┌───────────────────────────┐  ┌───────────────────────────────────────┐
    │ USE LOCKED REFERENCE      │  │ STEP 3: LLM CONTEXT ENHANCEMENT       │
    │                           │  │         (Optional - Gemini Flash)     │
    │ referenceId:              │  │                                       │
    │   "curly_casual"          │  │ Input: Scene + Presence + Calendar    │
    │                           │  │                                       │
    │ Skip to Step 5 →          │  │ LLM infers:                           │
    └────────────┬──────────────┘  │ ✓ Outfit style: casual/dressed_up     │
                 │                 │ ✓ Hairstyle pref: messy_bun/straight  │
                 │                 │ ✓ Activity: "post-workout"            │
                 │                 │                                       │
                 │                 │ Example:                              │
                 │                 │ "gym" + "just got back from gym"      │
                 │                 │ → athletic outfit + messy_bun (0.95)  │
                 │                 └────────────┬──────────────────────────┘
                 │                              │
                 │                              ▼
                 │                 ┌────────────────────────────────────────┐
                 │                 │ STEP 4: SCORE ALL REFERENCES           │
                 │                 │                                        │
                 │                 │ For each reference in registry:        │
                 │                 │                                        │
                 │                 │ BASE SCORE = baseFrequency × 100       │
                 │                 │                                        │
                 │                 │ ┌──────────────────────────────────┐  │
                 │                 │ │ SCORING FACTORS:                 │  │
                 │                 │ │                                  │  │
                 │                 │ │ 1. Scene Match        +30/-50    │  │
                 │                 │ │    "gym" → messy_bun suitable    │  │
                 │                 │ │                                  │  │
                 │                 │ │ 2. Mood Affinity      +0 to +20  │  │
                 │                 │ │    "confident" × 0.9 = +18       │  │
                 │                 │ │                                  │  │
                 │                 │ │ 3. Time of Day        +0 to +15  │  │
                 │                 │ │    "morning" × 0.9 = +13.5       │  │
                 │                 │ │                                  │  │
                 │                 │ │ 4. Season Match       +10/-15    │  │
                 │                 │ │    winter → cozy preferred       │  │
                 │                 │ │                                  │  │
                 │                 │ │ 5. Outfit Hint        +15 to +25 │  │
                 │                 │ │    "dressed up" → match formal   │  │
                 │                 │ │                                  │  │
                 │                 │ │ 6. Presence Match     +25 to +30 │  │
                 │                 │ │    "gym" → messy_bun +30         │  │
                 │                 │ │                                  │  │
                 │                 │ │ 7. Calendar Events    +20        │  │
                 │                 │ │    formal event → dressed_up     │  │
                 │                 │ │                                  │  │
                 │                 │ │ 8. LLM Enhancement    +30 to +35 │  │
                 │                 │ │    (if confidence > 0.7)         │  │
                 │                 │ │    LLM outfit match → +35        │  │
                 │                 │ │    LLM hairstyle match → +30     │  │
                 │                 │ └──────────────────────────────────┘  │
                 │                 │                                        │
                 │                 │ ┌──────────────────────────────────┐  │
                 │                 │ │ ANTI-REPETITION PENALTY:         │  │
                 │                 │ │                                  │  │
                 │                 │ │ Check recent history (last 10)   │  │
                 │                 │ │                                  │  │
                 │                 │ │ EXCEPTION: Same scene + < 1hr    │  │
                 │                 │ │   → NO penalty (realistic!)      │  │
                 │                 │ │   User: "Take another pic here"  │  │
                 │                 │ │   → Same reference is GOOD       │  │
                 │                 │ │                                  │  │
                 │                 │ │ Otherwise:                       │  │
                 │                 │ │   < 6 hours ago  → -40 penalty   │  │
                 │                 │ │   < 24 hours ago → -25 penalty   │  │
                 │                 │ │   < 72 hours ago → -10 penalty   │  │
                 │                 │ └──────────────────────────────────┘  │
                 │                 │                                        │
                 │                 │ Example Final Scores:                  │
                 │                 │   curly_casual:      87.5 ← WINNER    │
                 │                 │   messy_bun_casual:  102.3 ← WINNER   │
                 │                 │   straight_casual:   45.0 (recent use) │
                 │                 │   curly_dressed_up:  32.0 (wrong ctx)  │
                 │                 │                                        │
                 │                 │ SELECT: Top scored reference           │
                 │                 │ Log: Full reasoning for debugging      │
                 │                 └────────────┬───────────────────────────┘
                 │                              │
                 └──────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              STEP 5: LOCK CURRENT LOOK (if applicable)                  │
│                                                                         │
│  If this is a CURRENT PHOTO and NO existing lock:                      │
│                                                                         │
│  INSERT/UPDATE current_look_state:                                     │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ user_id: "user-123"                                            │    │
│  │ hairstyle: "messy_bun"                                         │    │
│  │ reference_image_id: "messy_bun_casual"                         │    │
│  │ locked_at: NOW                                                 │    │
│  │ expires_at: NOW + 24 hours                                     │    │
│  │ lock_reason: "first_selfie_of_day"                             │    │
│  │ is_current_look: true                                          │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  This ensures:                                                          │
│  ✓ Next selfie in same session uses SAME hairstyle                     │
│  ✓ Consistency within conversation                                     │
│  ✓ Variety across different days                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│           STEP 6: LOAD REFERENCE IMAGE BASE64 CONTENT                   │
│                                                                         │
│  referenceId: "messy_bun_casual"                                        │
│  fileName: "curly_hair_messy_bun.txt"                                   │
│                                                                         │
│  Load from: src/utils/base64ReferenceImages/                            │
│  Clean base64: Remove data URI prefixes, newlines                       │
│                                                                         │
│  Ready for Gemini Imagen ✓                                             │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│          STEP 7: GENERATE IMAGE WITH GEMINI IMAGEN 3 PRO                │
│                                                                         │
│  Build prompt:                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ "Use the provided reference image to maintain exact facial     │    │
│  │  features and identity of the woman.                           │    │
│  │                                                                │    │
│  │  A high-resolution, photorealistic smartphone selfie.         │    │
│  │  She is looking into the camera with a radiant, genuine smile  │    │
│  │  that reaches her eyes, creating subtle crinkles at the        │    │
│  │  corners and radiating warmth.                                 │    │
│  │                                                                │    │
│  │  She is situated in a modern, clean gym with high-end exercise │    │
│  │  equipment blurred in the background.                          │    │
│  │                                                                │    │
│  │  The lighting is clean, bright overhead lighting.              │    │
│  │                                                                │    │
│  │  The image has a candid Instagram-story aesthetic..."          │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Call Gemini Imagen:                                                    │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ model: "gemini-3-pro-image-preview"                            │    │
│  │ contents: [                                                    │    │
│  │   { inlineData: { mimeType: "image/jpeg",                      │    │
│  │                   data: <reference_base64> } },                │    │
│  │   { text: <full_prompt> }                                      │    │
│  │ ]                                                              │    │
│  │ config: {                                                      │    │
│  │   responseModalities: ["IMAGE"],                               │    │
│  │   imageConfig: { aspectRatio: "9:16", imageSize: "2K" }        │    │
│  │ }                                                              │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Latency: ~3-5 seconds                                                  │
│  Output: Generated image as base64                                      │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             STEP 8: RECORD IN HISTORY (Supabase)                        │
│                                                                         │
│  INSERT into selfie_generation_history:                                │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ user_id: "user-123"                                            │    │
│  │ reference_image_id: "messy_bun_casual"                         │    │
│  │ hairstyle: "messy_bun"                                         │    │
│  │ outfit_style: "casual"                                         │    │
│  │ scene: "gym"                                                   │    │
│  │ mood: "happy"                                                  │    │
│  │ is_old_photo: false                                            │    │
│  │ reference_date: null                                           │    │
│  │ selection_factors: {                                           │    │
│  │   reasoning: ["Base: 20", "Scene +30", "Presence +30", ...],   │    │
│  │   currentSeason: "winter",                                     │    │
│  │   timeOfDay: "morning"                                         │    │
│  │ }                                                              │    │
│  │ generated_at: NOW                                              │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  Purpose:                                                               │
│  ✓ Anti-repetition tracking (last 10 selfies)                          │
│  ✓ Analytics (which references are used most)                          │
│  ✓ Debugging (why was this reference chosen?)                          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      RETURN SELFIE RESULT                               │
│                                                                         │
│  {                                                                      │
│    success: true,                                                       │
│    imageBase64: "iVBORw0KGgoAAAANSUhEUgAA...",                           │
│    mimeType: "image/png"                                                │
│  }                                                                      │
│                                                                         │
│  → Displayed to user as <img> in chat                                  │
│  → Kayley: "Just finished my workout! 💪" [selfie]                     │
└─────────────────────────────────────────────────────────────────────────┘


KEY DECISION POINTS:
═══════════════════════════════════════════════════════════════════════════

1. TEMPORAL DETECTION (LLM)
   "from last week" → Different hairstyle OK
   "right now" → Must match locked look

2. CURRENT LOOK LOCKING
   First selfie of day → Lock hairstyle for 24h
   Old photo → Ignore lock, allow variation

3. CONTEXT ENHANCEMENT (LLM - Optional)
   Presence + Calendar → Infer outfit/hairstyle
   Boosts scoring accuracy by 30-35 points

4. ANTI-REPETITION
   Same scene < 1 hour → NO penalty (realistic!)
   Different scene recent use → Penalty

5. SCORING
   7+ factors → Select best reference
   Full reasoning logged for debugging

PERFORMANCE:
═══════════════════════════════════════════════════════════════════════════
Total latency: ~3.5-5.5 seconds
├─ LLM temporal detection: ~200ms (parallel, cached)
├─ Database queries: ~100ms (parallel)
├─ LLM context enhancement: ~200ms (optional, parallel)
├─ Reference selection: ~10ms (CPU-bound scoring)
└─ Gemini Imagen generation: ~3-5s (bottleneck)

Cost per selfie: ~$0.001-0.002
├─ Temporal LLM (Flash): ~$0.0001
├─ Context LLM (Flash): ~$0.0001 (optional)
└─ Imagen generation: ~$0.001-0.0015
```

---

## Why This Matters

Currently, every selfie uses the same `base64.txt` reference image, making all generated images feel identical and static. Real people:
- Have different hairstyles on different days (curly, straight, bun, ponytail)
- Dress appropriately for the context (casual at home, dressed up for dinner)
- Don't magically change their hairstyle mid-conversation
- Show old photos that look different from how they look "right now"
- Dress for the season (winter coat in December, not a tank top)

This system makes Kayley's selfies feel like a real person's Instagram story - varied across time, but consistent in the moment.

---

## Step 1: Reference Image Directory Structure

```
src/utils/base64ReferenceImages/
├── curly_hair_dressed_up.txt            # Curly hair, formal outfit
├── curly_hair_casual.txt                # Curly hair, everyday outfit
├── curly_hair_messy_bun_dressed_up.txt  # Messy bun, formal outfit
├── curly_hair_messy_bun_casual.txt      # Messy bun, casual outfit
├── straight_hair_dressed_up.txt         # Straight/blown out hair, formal
├── straight_hair_casual.txt             # Straight hair, casual outfit
├── index.ts                              # Reference image metadata and exports
└── README.md                             # Documentation for adding new references
```

### README.md Template

```markdown
# Reference Image Guidelines

## Adding New Reference Images

1. **Image Requirements**
   - High-resolution (2K or higher)
   - Clear facial features matching CHARACTER_VISUAL_IDENTITY
   - Consistent lighting (natural, flattering)
   - Single person only (no background people)

2. **Naming Convention**
   - Format: `{hairstyle}_{outfit_style}.txt`
   - Hairstyle: curly, straight, messy_bun, ponytail, bob
   - Outfit style: casual, dressed_up, athletic, cozy

3. **Base64 Encoding**
   ```bash
   # Convert image to base64
   base64 -i input.jpg -o curly_hair_casual.txt
   ```

4. **Testing**
   - Generate test selfie using new reference
   - Verify facial consistency across all references
   - Ensure scene/mood integration works correctly

## Current Reference Images

| File | Hairstyle | Outfit | Use Cases |
|------|-----------|--------|-----------|
| curly_hair_dressed_up.txt | Voluminous curls | Formal/nice | Dates, restaurants, events |
| curly_hair_casual.txt | Natural curls | Everyday | Coffee shop, home, casual outings |
| curly_hair_messy_bun_dressed_up.txt | Messy bun | Formal/nice | Formal events with practical hair |
| curly_hair_messy_bun_casual.txt | Messy bun | Casual/athletic | Gym, lazy day, working from home |
| straight_hair_dressed_up.txt | Blown out straight | Formal | Fancy dinner, concert, milestone |
| straight_hair_casual.txt | Straight, simple style | Everyday | General use, outdoor activities |
```

---

## Step 2: Reference Image Metadata Types

```typescript
// src/services/imageGeneration/types.ts

export type HairstyleType =
  | 'curly'           // Natural voluminous curls (2B/2C waves)
  | 'straight'        // Blown out or naturally straight
  | 'messy_bun'       // Casual updo, curly texture
  | 'ponytail'        // High or low ponytail
  | 'bob';            // Shorter style (future)

export type OutfitStyle =
  | 'casual'          // Everyday wear (t-shirt, jeans, sweater)
  | 'dressed_up'      // Formal/nice (dress, blouse, jewelry)
  | 'athletic'        // Gym/activewear
  | 'cozy';           // Loungewear, pajamas

export type SeasonContext =
  | 'winter'          // Dec, Jan, Feb
  | 'spring'          // Mar, Apr, May
  | 'summer'          // Jun, Jul, Aug
  | 'fall';           // Sep, Oct, Nov

export interface ReferenceImageMetadata {
  id: string;                          // Unique identifier
  fileName: string;                    // e.g., "curly_hair_casual.txt"
  hairstyle: HairstyleType;
  outfitStyle: OutfitStyle;

  // Selection weights
  baseFrequency: number;               // 0-1, how common this look is

  // Contextual suitability
  suitableScenes: string[];            // ['coffee', 'home', 'park']
  unsuitableScenes: string[];          // ['gym', 'pool']
  suitableSeasons: SeasonContext[];    // ['fall', 'winter', 'spring']

  // Mood affinity
  moodAffinity: {
    playful: number;                   // 0-1, how well this fits playful mood
    confident: number;
    relaxed: number;
    excited: number;
    flirty: number;
  };

  // Time appropriateness
  timeOfDay: {
    morning: number;                   // 0-1, suitability score
    afternoon: number;
    evening: number;
    night: number;
  };
}

export interface CurrentLookState {
  // Locked for current temporal context
  hairstyle: HairstyleType;
  referenceImageId: string;
  lockedAt: Date;
  expiresAt: Date;                     // When this look can change

  // Context that locked it
  lockReason: 'session_start' | 'first_selfie_of_day' | 'explicit_now_selfie';

  // Temporal awareness
  isCurrentLook: boolean;              // true = NOW, false = OLD PHOTO
}

export interface SelfieTemporalContext {
  isOldPhoto: boolean;                 // Detected from conversation
  referenceDate?: Date;                // "from last Tuesday"
  temporalPhrases: string[];           // Phrases that triggered old photo detection
}

export interface ReferenceSelectionContext {
  // Scene and mood (from existing system)
  scene: string;
  mood?: string;
  outfitHint?: string;

  // Temporal context
  temporalContext: SelfieTemporalContext;
  currentLookState: CurrentLookState | null;

  // Calendar context
  upcomingEvents: Array<{
    title: string;
    startTime: Date;
    isFormal: boolean;
  }>;

  // Environmental context
  currentSeason: SeasonContext;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  currentLocation: string | null;

  // Presence context (from presence_contexts table)
  presenceOutfit?: string;             // "just got back from the gym"
  presenceMood?: string;               // "feeling cute today"

  // Anti-repetition tracking
  recentReferenceHistory: Array<{
    referenceImageId: string;
    usedAt: Date;
    scene: string;
  }>;
}
```

---

## Step 3: Database Schema for Current Look State

```sql
-- supabase/migrations/YYYYMMDD_create_current_look_state.sql

-- Tracks Kayley's current hairstyle/appearance to maintain consistency
CREATE TABLE current_look_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- Current locked appearance
  hairstyle TEXT NOT NULL,             -- curly, straight, messy_bun, etc.
  reference_image_id TEXT NOT NULL,    -- Which base64 reference is active

  -- Locking metadata
  locked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,       -- When this look can change (end of day)
  lock_reason TEXT NOT NULL,           -- session_start, first_selfie_of_day, etc.

  -- Context
  is_current_look BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id)  -- Only one current look per user
);

CREATE INDEX idx_current_look_user ON current_look_state(user_id);
CREATE INDEX idx_current_look_expiry ON current_look_state(expires_at)
  WHERE is_current_look = true;

-- Track selfie generation history for anti-repetition
CREATE TABLE selfie_generation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),

  -- What was generated
  reference_image_id TEXT NOT NULL,
  hairstyle TEXT NOT NULL,
  outfit_style TEXT NOT NULL,
  scene TEXT NOT NULL,
  mood TEXT,

  -- Temporal context
  is_old_photo BOOLEAN DEFAULT false,
  reference_date TIMESTAMP,            -- If old photo, when it's "from"

  -- Selection reasoning
  selection_factors JSONB,             -- Why this reference was chosen

  generated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_selfie_history_user ON selfie_generation_history(user_id, generated_at);
CREATE INDEX idx_selfie_history_recent ON selfie_generation_history(user_id)
  WHERE generated_at > NOW() - INTERVAL '7 days';

-- Add to existing tables (if needed)
-- ALTER TABLE presence_contexts ADD COLUMN current_outfit TEXT;
-- ALTER TABLE presence_contexts ADD COLUMN current_hairstyle_mood TEXT;
```

---

## Step 4: Reference Image Registry

```typescript
// src/utils/base64ReferenceImages/index.ts

import { ReferenceImageMetadata, HairstyleType, OutfitStyle } from '../../services/imageGeneration/types';

// Import all reference images
import curlyHairDressedUpRaw from './curly_hair_dressed_up.txt?raw';
import curlyHairCasualRaw from './curly_hair_casual.txt?raw';
import curlyHairMessyBunDressedUpRaw from './curly_hair_messy_bun_dressed_up.txt?raw';
import curlyHairMessyBunCasualRaw from './curly_hair_messy_bun_casual.txt?raw';
import straightHairDressedUpRaw from './straight_hair_dressed_up.txt?raw';
import straightHairCasualRaw from './straight_hair_casual.txt?raw';

// Reference image metadata registry
export const REFERENCE_IMAGE_REGISTRY: ReferenceImageMetadata[] = [
  {
    id: 'curly_casual',
    fileName: 'curly_hair_casual.txt',
    hairstyle: 'curly',
    outfitStyle: 'casual',
    baseFrequency: 0.4, // Most common look

    suitableScenes: ['coffee', 'cafe', 'home', 'park', 'city', 'library', 'office'],
    unsuitableScenes: ['gym', 'pool', 'concert'],
    suitableSeasons: ['fall', 'winter', 'spring', 'summer'],

    moodAffinity: {
      playful: 0.7,
      confident: 0.6,
      relaxed: 0.8,
      excited: 0.7,
      flirty: 0.6,
    },

    timeOfDay: {
      morning: 0.9,   // Great for morning coffee
      afternoon: 0.8,
      evening: 0.6,
      night: 0.5,
    },
  },

  {
    id: 'curly_dressed_up',
    fileName: 'curly_hair_dressed_up.txt',
    hairstyle: 'curly',
    outfitStyle: 'dressed_up',
    baseFrequency: 0.15, // Less common, special occasions

    suitableScenes: ['restaurant', 'concert', 'sunset', 'city'],
    unsuitableScenes: ['gym', 'home', 'bedroom', 'kitchen', 'pool'],
    suitableSeasons: ['fall', 'winter', 'spring', 'summer'],

    moodAffinity: {
      playful: 0.5,
      confident: 0.9,
      relaxed: 0.4,
      excited: 0.8,
      flirty: 0.9,
    },

    timeOfDay: {
      morning: 0.2,
      afternoon: 0.5,
      evening: 0.9,   // Evening events
      night: 0.9,
    },
  },

  {
    id: 'messy_bun_casual',
    fileName: 'curly_hair_messy_bun_casual.txt',
    hairstyle: 'messy_bun',
    outfitStyle: 'casual',
    baseFrequency: 0.2, // Common for active/lazy days

    suitableScenes: ['gym', 'home', 'bedroom', 'kitchen', 'office', 'park'],
    unsuitableScenes: ['restaurant', 'concert'],
    suitableSeasons: ['spring', 'summer', 'fall'],

    moodAffinity: {
      playful: 0.6,
      confident: 0.5,
      relaxed: 0.9,
      excited: 0.5,
      flirty: 0.4,
    },

    timeOfDay: {
      morning: 0.9,   // Just woke up vibe
      afternoon: 0.7,
      evening: 0.6,
      night: 0.7,     // Cozy night in
    },
  },

  {
    id: 'messy_bun_dressed_up',
    fileName: 'curly_hair_messy_bun_dressed_up.txt',
    hairstyle: 'messy_bun',
    outfitStyle: 'dressed_up',
    baseFrequency: 0.08, // Rare - practical hair for formal events

    suitableScenes: ['restaurant', 'concert', 'city', 'sunset'],
    unsuitableScenes: ['gym', 'bedroom', 'kitchen'],
    suitableSeasons: ['spring', 'summer', 'fall', 'winter'],

    moodAffinity: {
      playful: 0.6,
      confident: 0.7,
      relaxed: 0.5,
      excited: 0.7,
      flirty: 0.6,
    },

    timeOfDay: {
      morning: 0.3,
      afternoon: 0.6,
      evening: 0.8,   // Casual-chic evening look
      night: 0.8,
    },
  },

  {
    id: 'straight_casual',
    fileName: 'straight_hair_casual.txt',
    hairstyle: 'straight',
    outfitStyle: 'casual',
    baseFrequency: 0.15, // Occasional style change

    suitableScenes: ['coffee', 'cafe', 'home', 'park', 'city', 'office'],
    unsuitableScenes: ['gym', 'pool'],
    suitableSeasons: ['fall', 'winter', 'spring', 'summer'],

    moodAffinity: {
      playful: 0.6,
      confident: 0.7,
      relaxed: 0.7,
      excited: 0.6,
      flirty: 0.7,
    },

    timeOfDay: {
      morning: 0.7,
      afternoon: 0.8,
      evening: 0.7,
      night: 0.6,
    },
  },

  {
    id: 'straight_dressed_up',
    fileName: 'straight_hair_dressed_up.txt',
    hairstyle: 'straight',
    outfitStyle: 'dressed_up',
    baseFrequency: 0.1, // Special occasions, made an effort

    suitableScenes: ['restaurant', 'concert', 'sunset', 'city'],
    unsuitableScenes: ['gym', 'home', 'bedroom', 'kitchen', 'pool'],
    suitableSeasons: ['fall', 'winter', 'spring', 'summer'],

    moodAffinity: {
      playful: 0.4,
      confident: 0.95, // Very polished, confident look
      relaxed: 0.3,
      excited: 0.9,
      flirty: 0.95,
    },

    timeOfDay: {
      morning: 0.1,
      afternoon: 0.4,
      evening: 0.95,  // Date night energy
      night: 0.95,
    },
  },
];

// Map file name to raw content
const REFERENCE_IMAGE_CONTENT: Record<string, string> = {
  'curly_hair_dressed_up.txt': curlyHairDressedUpRaw,
  'curly_hair_casual.txt': curlyHairCasualRaw,
  'curly_hair_messy_bun_dressed_up.txt': curlyHairMessyBunDressedUpRaw,
  'curly_hair_messy_bun_casual.txt': curlyHairMessyBunCasualRaw,
  'straight_hair_dressed_up.txt': straightHairDressedUpRaw,
  'straight_hair_casual.txt': straightHairCasualRaw,
};

/**
 * Get reference image base64 content by ID
 */
export function getReferenceImageContent(referenceId: string): string | null {
  const metadata = REFERENCE_IMAGE_REGISTRY.find(r => r.id === referenceId);
  if (!metadata) return null;

  return REFERENCE_IMAGE_CONTENT[metadata.fileName] || null;
}

/**
 * Get reference image metadata by ID
 */
export function getReferenceMetadata(referenceId: string): ReferenceImageMetadata | null {
  return REFERENCE_IMAGE_REGISTRY.find(r => r.id === referenceId) || null;
}

/**
 * Get all hairstyle types available
 */
export function getAvailableHairstyles(): HairstyleType[] {
  return Array.from(new Set(REFERENCE_IMAGE_REGISTRY.map(r => r.hairstyle)));
}
```

---

## Step 5: LLM-Based Temporal Context Detection

```typescript
// src/services/imageGeneration/temporalDetection.ts

import { SelfieTemporalContext } from './types';
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/**
 * LLM-based detection of temporal context for selfies
 * Uses Gemini Flash for fast, cheap inference
 */
export async function detectTemporalContextLLM(
  scene: string,
  userMessage: string,
  previousMessages: Array<{ role: string; content: string }>
): Promise<SelfieTemporalContext> {
  if (!GEMINI_API_KEY) {
    console.warn('[TemporalDetection] No API key, falling back to regex');
    return detectTemporalContextFallback(scene, userMessage, previousMessages);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Build context from recent messages
    const conversationContext = previousMessages
      .slice(-5)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt = `You are analyzing a selfie request to determine if it's for a CURRENT photo (taken now) or an OLD photo (from the past).

CONVERSATION CONTEXT:
${conversationContext}

CURRENT MESSAGE: ${userMessage}
SCENE: ${scene}

TASK:
Determine if this is:
1. CURRENT PHOTO - Selfie being taken right now, in the present moment
2. OLD PHOTO - Photo from the past (yesterday, last week, "when I was at...", etc.)

OUTPUT JSON:
{
  "isOldPhoto": boolean,
  "timeframe": "now" | "today" | "yesterday" | "last_week" | "last_month" | "vague_past",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "temporalPhrases": ["key phrases that indicate timing"]
}

EXAMPLES:

Input: "Send me a selfie"
Output: {"isOldPhoto": false, "timeframe": "now", "confidence": 0.9, "reasoning": "Generic request implies current photo", "temporalPhrases": []}

Input: "Here's a pic from last weekend at the beach"
Output: {"isOldPhoto": true, "timeframe": "last_week", "confidence": 1.0, "reasoning": "Explicitly from last weekend", "temporalPhrases": ["last weekend"]}

Input: User: "Show me that photo you took yesterday"
      Kayley: "Oh yeah! *sends selfie*"
Output: {"isOldPhoto": true, "timeframe": "yesterday", "confidence": 1.0, "reasoning": "User explicitly requested yesterday's photo", "temporalPhrases": ["yesterday"]}

Input: "Take a selfie right now"
Output: {"isOldPhoto": false, "timeframe": "now", "confidence": 1.0, "reasoning": "Explicitly requesting current photo", "temporalPhrases": ["right now"]}

Input: "I'm at the coffee shop" (context: sending selfie)
Output: {"isOldPhoto": false, "timeframe": "now", "confidence": 0.8, "reasoning": "Present tense implies current moment", "temporalPhrases": ["I'm at"]}

Now analyze the conversation above and respond with ONLY the JSON object.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.1, // Low temperature for consistent analysis
      },
    });

    const text = response.text?.trim() || '';

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[TemporalDetection] No JSON in response, using fallback');
      return detectTemporalContextFallback(scene, userMessage, previousMessages);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    console.log('[TemporalDetection LLM]', {
      isOldPhoto: parsed.isOldPhoto,
      timeframe: parsed.timeframe,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    });

    return {
      isOldPhoto: parsed.isOldPhoto,
      referenceDate: parsed.isOldPhoto ? estimateReferenceDateFromTimeframe(parsed.timeframe) : undefined,
      temporalPhrases: parsed.temporalPhrases || [],
    };
  } catch (error) {
    console.error('[TemporalDetection] LLM error, falling back:', error);
    return detectTemporalContextFallback(scene, userMessage, previousMessages);
  }
}

/**
 * Fallback regex-based detection (used if LLM fails)
 */
function detectTemporalContextFallback(
  scene: string,
  userMessage: string,
  previousMessages: Array<{ role: string; content: string }>
): SelfieTemporalContext {
  const combined = `${userMessage} ${scene}`.toLowerCase();

  // Simple heuristics
  const oldPhotoKeywords = [
    'from last', 'yesterday', 'other day', 'when i was', 'when we',
    'that time', 'remember when', 'old photo', 'previous', 'earlier'
  ];

  const isOldPhoto = oldPhotoKeywords.some(kw => combined.includes(kw));

  return {
    isOldPhoto,
    referenceDate: isOldPhoto ? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) : undefined,
    temporalPhrases: isOldPhoto ? ['(fallback detection)'] : [],
  };
}

/**
 * Estimate reference date from LLM-detected timeframe
 */
function estimateReferenceDateFromTimeframe(
  timeframe: 'now' | 'today' | 'yesterday' | 'last_week' | 'last_month' | 'vague_past'
): Date | undefined {
  const now = new Date();

  switch (timeframe) {
    case 'now':
    case 'today':
      return undefined; // Current photo

    case 'yesterday':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);

    case 'last_week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    case 'last_month':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    case 'vague_past':
      // Default: 2-3 days ago for "the other day"
      return new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000);

    default:
      return undefined;
  }
}

/**
 * Check if a temporal context should unlock the current look
 * (allow different hairstyle)
 */
export function shouldUnlockCurrentLook(
  temporalContext: SelfieTemporalContext,
  currentLookState: CurrentLookState | null
): boolean {
  // If no current look is locked, nothing to unlock
  if (!currentLookState) return false;

  // Old photos can have different hairstyle
  if (temporalContext.isOldPhoto) return true;

  // Current look expired naturally
  if (new Date() > currentLookState.expiresAt) return true;

  return false;
}
```

---

## Step 5.5: LLM-Based Outfit/Hairstyle Context Enhancement (Optional)

For even more intelligent selection, you can use an LLM to extract outfit and hairstyle hints from the conversation and presence context:

```typescript
// src/services/imageGeneration/contextEnhancer.ts

import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export interface EnhancedSelfieContext {
  inferredOutfitStyle: 'casual' | 'dressed_up' | 'athletic' | 'cozy' | 'unknown';
  inferredHairstylePreference: 'curly' | 'straight' | 'messy_bun' | 'ponytail' | 'any';
  activityContext: string; // "just got back from gym", "getting ready for dinner", etc.
  confidence: number;
  reasoning: string;
}

/**
 * Use LLM to infer outfit and hairstyle context from conversation and presence
 */
export async function enhanceSelfieContextWithLLM(
  scene: string,
  presenceOutfit: string | undefined,
  presenceMood: string | undefined,
  recentMessages: Array<{ role: string; content: string }>,
  upcomingEvents: Array<{ title: string; startTime: Date; isFormal: boolean }>
): Promise<EnhancedSelfieContext> {
  if (!GEMINI_API_KEY) {
    return {
      inferredOutfitStyle: 'unknown',
      inferredHairstylePreference: 'any',
      activityContext: '',
      confidence: 0,
      reasoning: 'No API key available',
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const conversationContext = recentMessages
      .slice(-5)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const eventsContext = upcomingEvents.length > 0
      ? upcomingEvents.map(e => `- ${e.title} at ${e.startTime.toLocaleTimeString()} (${e.isFormal ? 'formal' : 'casual'})`).join('\n')
      : 'No upcoming events';

    const prompt = `You are analyzing context to infer what outfit and hairstyle Kayley (the AI companion) would realistically have in this moment.

SCENE: ${scene}
PRESENCE OUTFIT: ${presenceOutfit || 'not specified'}
PRESENCE MOOD: ${presenceMood || 'not specified'}

UPCOMING EVENTS:
${eventsContext}

RECENT CONVERSATION:
${conversationContext}

TASK:
Based on the scene, presence context, and conversation, infer:
1. What outfit formality makes sense (casual, dressed_up, athletic, cozy)
2. What hairstyle makes sense (curly/natural, straight/styled, messy_bun, ponytail, or any)
3. The activity context (what she's doing or just did)

OUTPUT JSON:
{
  "inferredOutfitStyle": "casual" | "dressed_up" | "athletic" | "cozy" | "unknown",
  "inferredHairstylePreference": "curly" | "straight" | "messy_bun" | "ponytail" | "any",
  "activityContext": "brief description of what she's doing",
  "confidence": 0.0-1.0,
  "reasoning": "why these choices make sense"
}

EXAMPLES:

Scene: "gym", Presence: "just got back from the gym"
Output: {"inferredOutfitStyle": "athletic", "inferredHairstylePreference": "messy_bun", "activityContext": "post-workout", "confidence": 0.95, "reasoning": "Gym context strongly suggests athletic wear and practical hair"}

Scene: "restaurant", Events: "Dinner with Sarah at 7pm (formal)"
Output: {"inferredOutfitStyle": "dressed_up", "inferredHairstylePreference": "straight", "activityContext": "getting ready for dinner", "confidence": 0.9, "reasoning": "Formal dinner implies dressed up outfit and styled hair"}

Scene: "home", Presence: "feeling cozy"
Output: {"inferredOutfitStyle": "cozy", "inferredHairstylePreference": "messy_bun", "activityContext": "relaxing at home", "confidence": 0.85, "reasoning": "Cozy at home suggests loungewear and casual hair"}

Scene: "coffee shop"
Output: {"inferredOutfitStyle": "casual", "inferredHairstylePreference": "any", "activityContext": "at coffee shop", "confidence": 0.6, "reasoning": "Coffee shop is neutral, could be any casual look"}

Now analyze the context above and respond with ONLY the JSON object.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
      },
    });

    const text = response.text?.trim() || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    console.log('[ContextEnhancer LLM]', parsed);

    return parsed;
  } catch (error) {
    console.error('[ContextEnhancer] LLM error:', error);
    return {
      inferredOutfitStyle: 'unknown',
      inferredHairstylePreference: 'any',
      activityContext: '',
      confidence: 0,
      reasoning: 'LLM inference failed',
    };
  }
}
```

Then integrate this into the reference selector to boost scores:

```typescript
// In selectReferenceImage, before scoring:

const enhancedContext = await enhanceSelfieContextWithLLM(
  context.scene,
  context.presenceOutfit,
  context.presenceMood,
  previousMessages,
  context.upcomingEvents
);

// Apply LLM hints to scoring
if (enhancedContext.confidence > 0.7) {
  // Boost outfit style match
  if (enhancedContext.inferredOutfitStyle === ref.outfitStyle) {
    score += 35 * enhancedContext.confidence;
    factors.push(`+${(35 * enhancedContext.confidence).toFixed(1)} LLM outfit match`);
  }

  // Boost hairstyle preference
  if (
    enhancedContext.inferredHairstylePreference !== 'any' &&
    enhancedContext.inferredHairstylePreference === ref.hairstyle
  ) {
    score += 30 * enhancedContext.confidence;
    factors.push(`+${(30 * enhancedContext.confidence).toFixed(1)} LLM hairstyle match`);
  }
}
```

---

## Step 6: Reference Image Selector

```typescript
// src/services/imageGeneration/referenceSelector.ts

import {
  ReferenceImageMetadata,
  ReferenceSelectionContext,
  CurrentLookState,
  SeasonContext,
} from './types';
import { REFERENCE_IMAGE_REGISTRY, getReferenceImageContent } from '../../utils/base64ReferenceImages';
import { detectTemporalContext, shouldUnlockCurrentLook } from './temporalDetection';

/**
 * Select the best reference image for the given context
 */
export function selectReferenceImage(
  context: ReferenceSelectionContext
): { referenceId: string; base64Content: string; reasoning: string[] } {
  const reasoning: string[] = [];

  // STEP 1: Check if we should use locked current look
  const useLocked = !shouldUnlockCurrentLook(
    context.temporalContext,
    context.currentLookState
  );

  if (useLocked && context.currentLookState) {
    reasoning.push(`Using locked current look: ${context.currentLookState.hairstyle}`);
    reasoning.push(`Locked at: ${context.currentLookState.lockedAt.toLocaleString()}`);
    reasoning.push(`Reason: ${context.currentLookState.lockReason}`);

    const content = getReferenceImageContent(context.currentLookState.referenceImageId);
    if (content) {
      return {
        referenceId: context.currentLookState.referenceImageId,
        base64Content: content,
        reasoning,
      };
    } else {
      reasoning.push('⚠️ Locked reference not found, falling through to selection');
    }
  }

  if (context.temporalContext.isOldPhoto) {
    reasoning.push(`📅 OLD PHOTO DETECTED: ${context.temporalContext.temporalPhrases.join(', ')}`);
    reasoning.push('Allowing different hairstyle from current look');
  }

  // STEP 2: Score all references
  const scored = REFERENCE_IMAGE_REGISTRY.map(ref => ({
    ref,
    score: scoreReference(ref, context, reasoning),
  }));

  // STEP 3: Apply anti-repetition penalty
  applyAntiRepetitionPenalty(scored, context, reasoning);

  // STEP 4: Sort by score and select top candidate
  scored.sort((a, b) => b.score - a.score);

  const selected = scored[0];
  reasoning.push(`\n🎯 SELECTED: ${selected.ref.id} (score: ${selected.score.toFixed(2)})`);

  const content = getReferenceImageContent(selected.ref.id);
  if (!content) {
    throw new Error(`Reference image content not found for ${selected.ref.id}`);
  }

  return {
    referenceId: selected.ref.id,
    base64Content: content,
    reasoning,
  };
}

/**
 * Score a reference image based on context
 */
function scoreReference(
  ref: ReferenceImageMetadata,
  context: ReferenceSelectionContext,
  reasoning: string[]
): number {
  let score = ref.baseFrequency * 100; // Start with base frequency
  const factors: string[] = [];

  // FACTOR 1: Scene suitability
  const sceneLower = context.scene.toLowerCase();
  const matchingSuitableScenes = ref.suitableScenes.filter(s =>
    sceneLower.includes(s) || s.includes(sceneLower)
  );
  const matchingUnsuitableScenes = ref.unsuitableScenes.filter(s =>
    sceneLower.includes(s) || s.includes(sceneLower)
  );

  if (matchingSuitableScenes.length > 0) {
    score += 30;
    factors.push(`+30 scene match (${matchingSuitableScenes.join(', ')})`);
  }
  if (matchingUnsuitableScenes.length > 0) {
    score -= 50;
    factors.push(`-50 unsuitable scene (${matchingUnsuitableScenes.join(', ')})`);
  }

  // FACTOR 2: Mood affinity
  if (context.mood) {
    const moodKey = normalizeMoodToAffinityKey(context.mood);
    if (moodKey && ref.moodAffinity[moodKey] !== undefined) {
      const moodScore = ref.moodAffinity[moodKey] * 20;
      score += moodScore;
      factors.push(`+${moodScore.toFixed(1)} mood (${moodKey}: ${ref.moodAffinity[moodKey]})`);
    }
  }

  // FACTOR 3: Time of day
  const timeScore = ref.timeOfDay[context.timeOfDay] * 15;
  score += timeScore;
  factors.push(`+${timeScore.toFixed(1)} time (${context.timeOfDay})`);

  // FACTOR 4: Season appropriateness
  if (ref.suitableSeasons.includes(context.currentSeason)) {
    score += 10;
    factors.push(`+10 season (${context.currentSeason})`);
  } else {
    score -= 15;
    factors.push(`-15 wrong season (${context.currentSeason})`);
  }

  // FACTOR 5: Outfit hint from context
  if (context.outfitHint) {
    const hintLower = context.outfitHint.toLowerCase();
    if (
      (hintLower.includes('dress') || hintLower.includes('nice') || hintLower.includes('formal')) &&
      ref.outfitStyle === 'dressed_up'
    ) {
      score += 25;
      factors.push('+25 outfit hint match (dressed up)');
    } else if (
      (hintLower.includes('casual') || hintLower.includes('comfy')) &&
      ref.outfitStyle === 'casual'
    ) {
      score += 15;
      factors.push('+15 outfit hint match (casual)');
    }
  }

  // FACTOR 6: Presence outfit context
  if (context.presenceOutfit) {
    const presenceLower = context.presenceOutfit.toLowerCase();
    if (presenceLower.includes('gym') && ref.hairstyle === 'messy_bun') {
      score += 30;
      factors.push('+30 presence match (gym → messy bun)');
    }
    if (
      (presenceLower.includes('dress') || presenceLower.includes('getting ready')) &&
      ref.outfitStyle === 'dressed_up'
    ) {
      score += 25;
      factors.push('+25 presence match (getting ready → dressed up)');
    }
  }

  // FACTOR 7: Calendar events
  const nearbyFormalEvents = context.upcomingEvents.filter(e =>
    e.isFormal && Math.abs(e.startTime.getTime() - Date.now()) < 2 * 60 * 60 * 1000
  );
  if (nearbyFormalEvents.length > 0 && ref.outfitStyle === 'dressed_up') {
    score += 20;
    factors.push(`+20 nearby formal event (${nearbyFormalEvents[0].title})`);
  }

  reasoning.push(`  ${ref.id}: ${score.toFixed(1)} (${factors.join(', ')})`);

  return score;
}

/**
 * Apply penalty for recently used references (soft cooldown)
 */
function applyAntiRepetitionPenalty(
  scored: Array<{ ref: ReferenceImageMetadata; score: number }>,
  context: ReferenceSelectionContext,
  reasoning: string[]
): void {
  const recentUses = context.recentReferenceHistory.slice(-10); // Last 10 selfies

  for (const item of scored) {
    const uses = recentUses.filter(h => h.referenceImageId === item.ref.id);

    if (uses.length === 0) continue;

    const mostRecent = uses[uses.length - 1];
    const hoursSinceUse = (Date.now() - mostRecent.usedAt.getTime()) / (60 * 60 * 1000);

    // EXCEPTION: If same scene within same conversation (< 1 hour), NO penalty
    // This handles "take another selfie at the same cafe" gracefully
    if (hoursSinceUse < 1 && mostRecent.scene === context.scene) {
      reasoning.push(`  ${item.ref.id}: No penalty (same scene, same session)`);
      continue;
    }

    // PENALTY: Recently used
    let penalty = 0;
    if (hoursSinceUse < 6) {
      penalty = 40; // Heavy penalty within 6 hours
    } else if (hoursSinceUse < 24) {
      penalty = 25; // Medium penalty within a day
    } else if (hoursSinceUse < 72) {
      penalty = 10; // Light penalty within 3 days
    }

    if (penalty > 0) {
      item.score -= penalty;
      reasoning.push(`  ${item.ref.id}: -${penalty} repetition penalty (used ${hoursSinceUse.toFixed(1)}h ago)`);
    }
  }
}

/**
 * Normalize mood string to mood affinity key
 */
function normalizeMoodToAffinityKey(
  mood: string
): 'playful' | 'confident' | 'relaxed' | 'excited' | 'flirty' | null {
  const moodLower = mood.toLowerCase();

  if (moodLower.includes('playful') || moodLower.includes('fun')) return 'playful';
  if (moodLower.includes('confident') || moodLower.includes('assured')) return 'confident';
  if (moodLower.includes('relax') || moodLower.includes('calm') || moodLower.includes('cozy')) return 'relaxed';
  if (moodLower.includes('excit') || moodLower.includes('energetic')) return 'excited';
  if (moodLower.includes('flirt') || moodLower.includes('coy')) return 'flirty';

  return null;
}

/**
 * Get current season based on month
 */
export function getCurrentSeason(): SeasonContext {
  const month = new Date().getMonth(); // 0-11

  if (month >= 11 || month <= 1) return 'winter'; // Dec, Jan, Feb
  if (month >= 2 && month <= 4) return 'spring';  // Mar, Apr, May
  if (month >= 5 && month <= 7) return 'summer';  // Jun, Jul, Aug
  return 'fall'; // Sep, Oct, Nov
}

/**
 * Get time of day category
 */
export function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}
```

---

## Step 7: Current Look State Service

```typescript
// src/services/imageGeneration/currentLookService.ts

import { supabase } from '../supabaseClient';
import { CurrentLookState } from './types';

/**
 * Get the current locked look state for a user
 */
export async function getCurrentLookState(userId: string): Promise<CurrentLookState | null> {
  const { data, error } = await supabase
    .from('current_look_state')
    .select('*')
    .eq('user_id', userId)
    .eq('is_current_look', true)
    .maybeSingle();

  if (error) {
    console.error('[CurrentLook] Error fetching current look:', error);
    return null;
  }

  if (!data) return null;

  // Check if expired
  const expiresAt = new Date(data.expires_at);
  if (new Date() > expiresAt) {
    console.log('[CurrentLook] Current look expired, returning null');
    return null;
  }

  return {
    hairstyle: data.hairstyle,
    referenceImageId: data.reference_image_id,
    lockedAt: new Date(data.locked_at),
    expiresAt,
    lockReason: data.lock_reason,
    isCurrentLook: data.is_current_look,
  };
}

/**
 * Lock a new current look (set hairstyle for the session/day)
 */
export async function lockCurrentLook(
  userId: string,
  referenceImageId: string,
  hairstyle: string,
  lockReason: 'session_start' | 'first_selfie_of_day' | 'explicit_now_selfie',
  expirationHours: number = 24
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expirationHours * 60 * 60 * 1000);

  // Upsert (insert or update)
  const { error } = await supabase
    .from('current_look_state')
    .upsert({
      user_id: userId,
      hairstyle,
      reference_image_id: referenceImageId,
      locked_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      lock_reason: lockReason,
      is_current_look: true,
      updated_at: now.toISOString(),
    }, {
      onConflict: 'user_id',
    });

  if (error) {
    console.error('[CurrentLook] Error locking current look:', error);
  } else {
    console.log(`[CurrentLook] Locked ${hairstyle} until ${expiresAt.toLocaleString()}`);
  }
}

/**
 * Unlock current look (force expiration)
 */
export async function unlockCurrentLook(userId: string): Promise<void> {
  await supabase
    .from('current_look_state')
    .update({
      is_current_look: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  console.log('[CurrentLook] Unlocked current look');
}

/**
 * Get recent selfie generation history for anti-repetition
 */
export async function getRecentSelfieHistory(
  userId: string,
  limit: number = 10
): Promise<Array<{
  referenceImageId: string;
  usedAt: Date;
  scene: string;
}>> {
  const { data, error } = await supabase
    .from('selfie_generation_history')
    .select('reference_image_id, generated_at, scene')
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[CurrentLook] Error fetching history:', error);
    return [];
  }

  return (data || []).map(row => ({
    referenceImageId: row.reference_image_id,
    usedAt: new Date(row.generated_at),
    scene: row.scene,
  }));
}

/**
 * Record a selfie generation in history
 */
export async function recordSelfieGeneration(
  userId: string,
  referenceImageId: string,
  hairstyle: string,
  outfitStyle: string,
  scene: string,
  mood: string | undefined,
  isOldPhoto: boolean,
  referenceDate: Date | undefined,
  selectionFactors: Record<string, any>
): Promise<void> {
  const { error } = await supabase
    .from('selfie_generation_history')
    .insert({
      user_id: userId,
      reference_image_id: referenceImageId,
      hairstyle,
      outfit_style: outfitStyle,
      scene,
      mood: mood || null,
      is_old_photo: isOldPhoto,
      reference_date: referenceDate?.toISOString() || null,
      selection_factors: selectionFactors,
    });

  if (error) {
    console.error('[CurrentLook] Error recording generation:', error);
  }
}
```

---

## Step 8: Integration with imageGenerationService.ts

```typescript
// src/services/imageGenerationService.ts
// MODIFICATIONS to existing file

import { GoogleGenAI } from "@google/genai";
// REMOVED: import referenceImageRaw from "../utils/base64.txt?raw";
import { getCurrentSeason, getTimeOfDay, selectReferenceImage } from './imageGeneration/referenceSelector';
import { detectTemporalContext } from './imageGeneration/temporalDetection';
import {
  getCurrentLookState,
  lockCurrentLook,
  getRecentSelfieHistory,
  recordSelfieGeneration,
} from './imageGeneration/currentLookService';
import { getReferenceMetadata } from '../utils/base64ReferenceImages';
import type { ReferenceSelectionContext } from './imageGeneration/types';

// ... existing CHARACTER_VISUAL_IDENTITY and buildMoodDescription ...

// NEW: Extended SelfieRequest interface
export interface SelfieRequest {
  scene: string;
  mood?: string;
  outfitHint?: string;

  // NEW: Context for reference selection
  userId: string;                      // For look state and history
  userMessage: string;                 // For temporal detection
  previousMessages?: Array<{           // For temporal context
    role: string;
    content: string;
  }>;

  // NEW: Calendar and presence context
  upcomingEvents?: Array<{
    title: string;
    startTime: Date;
    isFormal: boolean;
  }>;
  currentLocation?: string | null;
  presenceOutfit?: string;
  presenceMood?: string;

  // DEPRECATED: referenceImageBase64 (will be selected automatically)
  referenceImageBase64?: string;       // Kept for backward compatibility
}

export async function generateCompanionSelfie(
  request: SelfieRequest
): Promise<SelfieResult> {
  if (!GEMINI_API_KEY) {
    console.error("❌ [ImageGen] Missing VITE_GEMINI_API_KEY");
    return { success: false, error: "Image generation not configured" };
  }

  try {
    console.log("📸 [ImageGen] Generating selfie for scene:", request.scene);

    // ==================================================
    // NEW: REFERENCE IMAGE SELECTION LOGIC
    // ==================================================

    // 1. Detect temporal context (old photo vs current photo) using LLM
    const temporalContext = await detectTemporalContextLLM(
      request.scene,
      request.userMessage,
      request.previousMessages || []
    );

    console.log(`📅 [ImageGen] Temporal context:`, temporalContext);

    // 2. Get current look state and history
    const [currentLookState, recentHistory] = await Promise.all([
      getCurrentLookState(request.userId),
      getRecentSelfieHistory(request.userId, 10),
    ]);

    if (currentLookState) {
      console.log(`🔒 [ImageGen] Current look locked:`, currentLookState);
    }

    // 3. Build selection context
    const selectionContext: ReferenceSelectionContext = {
      scene: request.scene,
      mood: request.mood,
      outfitHint: request.outfitHint,
      temporalContext,
      currentLookState,
      upcomingEvents: request.upcomingEvents || [],
      currentSeason: getCurrentSeason(),
      timeOfDay: getTimeOfDay(),
      currentLocation: request.currentLocation || null,
      presenceOutfit: request.presenceOutfit,
      presenceMood: request.presenceMood,
      recentReferenceHistory: recentHistory,
    };

    // 4. Select best reference image
    const { referenceId, base64Content, reasoning } = selectReferenceImage(selectionContext);

    console.log(`🎯 [ImageGen] Selected reference: ${referenceId}`);
    console.log('📋 [ImageGen] Selection reasoning:\n', reasoning.join('\n'));

    // 5. If this is a current (not old) photo, lock the look
    if (!temporalContext.isOldPhoto && !currentLookState) {
      const metadata = getReferenceMetadata(referenceId);
      if (metadata) {
        await lockCurrentLook(
          request.userId,
          referenceId,
          metadata.hairstyle,
          'first_selfie_of_day',
          24 // Lock for 24 hours
        );
        console.log(`🔒 [ImageGen] Locked look: ${metadata.hairstyle} (${referenceId})`);
      }
    }

    // ==================================================
    // EXISTING LOGIC (with reference image substitution)
    // ==================================================

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const moodDescription = buildMoodDescription(request.mood);
    let fullPrompt = buildImagePrompt(request.scene, "outfit", moodDescription);

    const parts: any[] = [];

    // Use selected reference (instead of static base64.txt)
    const cleanRef = cleanBase64(
      request.referenceImageBase64 || base64Content  // Backward compat
    );

    if (cleanRef) {
      console.log("📸 [ImageGen] Attaching reference face for consistency");
      fullPrompt = `Use the provided reference image to maintain the exact facial features and identity of the woman. ${fullPrompt}`;

      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanRef,
        },
      });
    }

    parts.push({ text: fullPrompt });
    console.log("📸 [ImageGen] Full prompt text:", fullPrompt);

    // Call Gemini 3 Pro
    const response = await ai.models.generateContent({
      model: IMAGEN_MODEL,
      contents: parts,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: "9:16",
          imageSize: "2K",
        },
      },
    });

    const generatedPart = response.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData
    );

    if (!generatedPart?.inlineData?.data) {
      console.error("❌ [ImageGen] No image returned from Gemini");
      return { success: false, error: "No image generated" };
    }

    console.log("✅ [ImageGen] Selfie generated successfully!");

    // ==================================================
    // NEW: RECORD GENERATION IN HISTORY
    // ==================================================
    const metadata = getReferenceMetadata(referenceId);
    if (metadata) {
      await recordSelfieGeneration(
        request.userId,
        referenceId,
        metadata.hairstyle,
        metadata.outfitStyle,
        request.scene,
        request.mood,
        temporalContext.isOldPhoto,
        temporalContext.referenceDate,
        {
          reasoning,
          currentSeason: selectionContext.currentSeason,
          timeOfDay: selectionContext.timeOfDay,
        }
      );
    }

    return {
      success: true,
      imageBase64: generatedPart.inlineData.data,
      mimeType: generatedPart.inlineData.mimeType || "image/png",
    };
  } catch (error: any) {
    console.error("❌ [ImageGen] Error generating selfie:", error);
    if (error?.message?.includes("SAFETY")) {
      return {
        success: false,
        error: "The image could not be generated due to content guidelines",
      };
    }
    return {
      success: false,
      error: error?.message || "Failed to generate image",
    };
  }
}

// ... rest of existing functions (cleanBase64, base64ToDataUrl, buildImagePrompt, etc.) ...
```

---

## Step 9: Update Callers to Pass New Context

```typescript
// Example: In your chat service or wherever generateCompanionSelfie is called

import { generateCompanionSelfie } from '../imageGenerationService';
import { getUpcomingEvents } from '../calendarService';
import { getPresenceContext } from '../presenceDirector';

async function handleSelfieGeneration(
  userId: string,
  scene: string,
  mood: string | undefined,
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
) {
  // Gather context
  const [upcomingEvents, presenceContext] = await Promise.all([
    getUpcomingEvents(userId, 2), // Next 2 hours
    getPresenceContext(userId),
  ]);

  const result = await generateCompanionSelfie({
    scene,
    mood,
    outfitHint: undefined,

    // NEW: Required context
    userId,
    userMessage,
    previousMessages: conversationHistory.slice(-5), // Last 5 messages

    // NEW: Calendar and presence
    upcomingEvents: upcomingEvents.map(e => ({
      title: e.title,
      startTime: new Date(e.start_time),
      isFormal: isFormalEvent(e.title), // Helper to detect formal events
    })),
    currentLocation: presenceContext?.location || null,
    presenceOutfit: presenceContext?.outfit || undefined,
    presenceMood: presenceContext?.mood || undefined,
  });

  return result;
}

function isFormalEvent(title: string): boolean {
  const formalKeywords = ['dinner', 'meeting', 'interview', 'wedding', 'presentation', 'date'];
  return formalKeywords.some(kw => title.toLowerCase().includes(kw));
}
```

---

## Step 10: Testing Strategy

```typescript
// src/services/imageGeneration/__tests__/referenceSelector.test.ts

import { describe, it, expect } from 'vitest';
import { selectReferenceImage, getCurrentSeason, getTimeOfDay } from '../referenceSelector';
import type { ReferenceSelectionContext } from '../types';

describe('Reference Image Selector', () => {
  const baseContext: ReferenceSelectionContext = {
    scene: 'coffee shop',
    mood: 'relaxed',
    outfitHint: undefined,
    temporalContext: {
      isOldPhoto: false,
      temporalPhrases: [],
    },
    currentLookState: null,
    upcomingEvents: [],
    currentSeason: 'fall',
    timeOfDay: 'morning',
    currentLocation: null,
    recentReferenceHistory: [],
  };

  it('should select casual curly for morning coffee shop', () => {
    const result = selectReferenceImage(baseContext);

    expect(result.referenceId).toMatch(/curly.*casual|messy_bun/);
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it('should select dressed up for evening restaurant', () => {
    const context: ReferenceSelectionContext = {
      ...baseContext,
      scene: 'upscale restaurant',
      mood: 'confident',
      timeOfDay: 'evening',
    };

    const result = selectReferenceImage(context);

    expect(result.referenceId).toMatch(/dressed_up/);
  });

  it('should select messy bun for gym', () => {
    const context: ReferenceSelectionContext = {
      ...baseContext,
      scene: 'gym',
      presenceOutfit: 'just got back from the gym',
    };

    const result = selectReferenceImage(context);

    expect(result.referenceId).toBe('messy_bun_casual');
  });

  it('should respect locked current look for current photos', () => {
    const context: ReferenceSelectionContext = {
      ...baseContext,
      currentLookState: {
        hairstyle: 'straight',
        referenceImageId: 'straight_casual',
        lockedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lockReason: 'first_selfie_of_day',
        isCurrentLook: true,
      },
    };

    const result = selectReferenceImage(context);

    expect(result.referenceId).toBe('straight_casual');
  });

  it('should ignore locked look for old photos', () => {
    const context: ReferenceSelectionContext = {
      ...baseContext,
      temporalContext: {
        isOldPhoto: true,
        temporalPhrases: ['from last week'],
      },
      currentLookState: {
        hairstyle: 'straight',
        referenceImageId: 'straight_casual',
        lockedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lockReason: 'first_selfie_of_day',
        isCurrentLook: true,
      },
    };

    const result = selectReferenceImage(context);

    // Should NOT be locked reference (could be any reference)
    expect(result.reasoning.some(r => r.includes('OLD PHOTO DETECTED'))).toBe(true);
  });

  it('should apply anti-repetition penalty', () => {
    const context: ReferenceSelectionContext = {
      ...baseContext,
      recentReferenceHistory: [
        {
          referenceImageId: 'curly_casual',
          usedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
          scene: 'park',
        },
      ],
    };

    const result = selectReferenceImage(context);

    // Should avoid curly_casual due to recent use
    expect(result.referenceId).not.toBe('curly_casual');
  });

  it('should allow same reference for same scene in quick succession', () => {
    const context: ReferenceSelectionContext = {
      ...baseContext,
      scene: 'coffee shop',
      recentReferenceHistory: [
        {
          referenceImageId: 'curly_casual',
          usedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
          scene: 'coffee shop', // SAME SCENE
        },
      ],
    };

    const result = selectReferenceImage(context);

    // Should be ALLOWED to use curly_casual again (same scene exception)
    expect(result.reasoning.some(r => r.includes('same scene, same session'))).toBe(true);
  });
});

// src/services/imageGeneration/__tests__/temporalDetection.test.ts

import { describe, it, expect, vi } from 'vitest';
import { detectTemporalContextLLM } from '../temporalDetection';

describe('Temporal Context Detection (LLM-based)', () => {
  // Note: These tests will call the real LLM in CI.
  // For unit tests, you may want to mock the GoogleGenAI client.

  it('should detect old photo from "last week"', async () => {
    const result = await detectTemporalContextLLM(
      'at the beach',
      'Here\'s a pic from last week',
      []
    );

    expect(result.isOldPhoto).toBe(true);
    expect(result.temporalPhrases.length).toBeGreaterThan(0);
  });

  it('should detect old photo from "the other day"', async () => {
    const result = await detectTemporalContextLLM(
      'coffee shop',
      'I took this the other day',
      []
    );

    expect(result.isOldPhoto).toBe(true);
  });

  it('should detect current photo from "right now"', async () => {
    const result = await detectTemporalContextLLM(
      'at home',
      'Send me a selfie right now',
      []
    );

    expect(result.isOldPhoto).toBe(false);
  });

  it('should default to current photo with no temporal markers', async () => {
    const result = await detectTemporalContextLLM(
      'restaurant',
      'Send me a selfie',
      []
    );

    expect(result.isOldPhoto).toBe(false);
  });

  it('should detect from previous message context', async () => {
    const result = await detectTemporalContextLLM(
      'park',
      'Yeah here it is',
      [
        { role: 'user', content: 'Show me that photo from yesterday' },
        { role: 'assistant', content: 'Oh yeah let me find it' },
      ]
    );

    expect(result.isOldPhoto).toBe(true);
  });

  it('should handle nuanced temporal language', async () => {
    // This is where LLM shines vs regex
    const result = await detectTemporalContextLLM(
      'at the park',
      'Remember that time we talked about going to the park? Here I am!',
      []
    );

    // LLM should recognize "remember that time" as past reference
    // but "Here I am" as present moment -> current photo
    expect(result.isOldPhoto).toBe(false);
  });
});
```

---

## Step 11: Migration Plan

### Phase 1: Setup (Week 1)

1. ✅ **Create directory structure**
   ```bash
   mkdir -p src/utils/base64ReferenceImages
   mkdir -p src/services/imageGeneration
   ```

2. ✅ **Create placeholder reference files**
   - Create 5 `.txt` files with placeholder base64 data
   - Document in README.md

3. ✅ **Run database migration**
   ```bash
   # Create migration files
   # Run: supabase db push
   ```

### Phase 2: Core Logic (Week 2)

4. ✅ **Implement types and registry**
   - `src/services/imageGeneration/types.ts`
   - `src/utils/base64ReferenceImages/index.ts`

5. ✅ **Implement temporal detection**
   - `src/services/imageGeneration/temporalDetection.ts`
   - Write tests

6. ✅ **Implement reference selector**
   - `src/services/imageGeneration/referenceSelector.ts`
   - Write scoring tests

### Phase 3: Integration (Week 3)

7. ✅ **Implement current look service**
   - `src/services/imageGeneration/currentLookService.ts`
   - Test database operations

8. ✅ **Update imageGenerationService.ts**
   - Integrate selection logic
   - Maintain backward compatibility

9. ✅ **Update callers**
   - Pass userId, userMessage, context
   - Test end-to-end

### Phase 4: Real Images (Week 4)

10. ✅ **Generate/collect real reference images**
    - 5 hairstyle/outfit combinations
    - Convert to base64
    - Test visual consistency

11. ✅ **Fine-tune scoring weights**
    - Adjust `baseFrequency`, `moodAffinity`, etc.
    - Test various scenarios

12. ✅ **Production rollout**
    - Monitor logs for selection reasoning
    - Gather user feedback
    - Iterate

---

## Step 12: Monitoring and Iteration

### Key Metrics to Track

1. **Reference Distribution**
   - How often is each reference used?
   - Are some references never selected?

2. **Lock Duration**
   - How long do looks stay locked?
   - Are users getting variety across days?

3. **Temporal Detection Accuracy**
   - Are old photos correctly detected?
   - False positives/negatives?

4. **Anti-Repetition Effectiveness**
   - Are same references appearing too close together?
   - Is the "same scene" exception working?

### Logging

```typescript
// Add to recordSelfieGeneration
console.log('[ImageGen Analytics]', {
  referenceId,
  hairstyle,
  outfitStyle,
  scene,
  isOldPhoto,
  wasLocked: !!currentLookState,
  selectionScore: reasoning.find(r => r.includes('SELECTED'))
});
```

### A/B Testing Ideas

- Test different lock durations (12h vs 24h vs session-only)
- Test different anti-repetition penalties
- Test scene matching strictness

---

## Summary

You've implemented a **multi-reference image system** that:

1. **Maintains realism** - Hairstyle consistent within a timeframe, varies across days
2. **LLM-powered temporal awareness** - Uses Gemini Flash to detect old photos vs current photos from natural language
3. **LLM-enhanced context detection** (optional) - Infers outfit and hairstyle from conversation, presence, and calendar
4. **Context-driven selection** - Scene, mood, calendar, presence, season all factor in
5. **Anti-repetition with intelligence** - Tracks history but allows duplicates when appropriate
6. **Database persistence** - Locks current look, tracks history
7. **Comprehensive scoring** - 7+ factors weighted and logged for transparency
8. **Backward compatible** - Existing callers continue to work

### Key Concepts

- **Current Look Locking**: First selfie of the day locks hairstyle until expiration
- **LLM-Based Temporal Detection**: Gemini Flash analyzes conversation to determine if selfie is from past or present
  - Handles nuanced language: "Remember when we talked about the park? Here I am!" → current photo
  - Fallback to regex patterns if LLM unavailable
  - Fast inference with Gemini Flash (~200ms)
- **LLM-Enhanced Context** (optional): Infers outfit formality and hairstyle preference from scene + presence + calendar
  - Boosts scoring accuracy for contextually appropriate references
  - Handles implicit context: "just got back from gym" → athletic outfit + messy bun
- **Contextual Scoring**: Each reference gets a score based on scene, mood, time, season, calendar, presence, and LLM hints
- **Smart Anti-Repetition**: Recent use penalty UNLESS it's the same scene in quick succession
- **Season-Aware**: Won't show tank tops in December unless it's an old photo
- **Testing Strategy**: Comprehensive unit tests for scoring, temporal detection, anti-repetition

### Why LLM Over Regex?

**Regex limitations:**
- Misses nuanced language: "That park we talked about? I'm here now!" (regex: old photo ❌)
- Can't understand context: "Remember last week? Anyway, here's me right now" (regex: old photo ❌)
- Brittle: Requires constant pattern updates for edge cases

**LLM benefits:**
- **Understands intent**: "Remember when we talked about going? Well I finally made it!" → current photo ✅
- **Handles ambiguity**: "I'm at that restaurant we discussed" → current photo (present tense)
- **Infers outfit context**: "just got back from dinner" → dressed up, even without explicit mention
- **Self-documenting**: Returns reasoning string explaining the decision
- **Evolves naturally**: No pattern maintenance required

**Cost:**
- ~$0.0001 per inference (Gemini Flash)
- ~200ms latency (parallel with other API calls)
- **Worth it** for dramatically improved accuracy

**Performance Optimization:**
- Cache LLM temporal detection results by conversation context hash (30s TTL)
- Run temporal detection in parallel with other API calls (calendar, presence)
- Fallback to regex if LLM takes >500ms
- Consider batching multiple selfie context inferences if generating multiple images

This makes Kayley's selfies feel like a real person's - varied, contextual, intelligent, and **realistic**.

---

## Appendix: Caching LLM Results (Performance Optimization)

To avoid redundant LLM calls, cache temporal detection results:

```typescript
// src/services/imageGeneration/temporalDetectionCache.ts

interface CacheEntry {
  result: SelfieTemporalContext;
  timestamp: Date;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

/**
 * Generate cache key from conversation context
 */
function getCacheKey(
  scene: string,
  userMessage: string,
  previousMessages: Array<{ role: string; content: string }>
): string {
  const context = `${scene}|${userMessage}|${previousMessages.slice(-3).map(m => m.content).join('|')}`;
  // Simple hash (or use crypto.subtle.digest for production)
  return context.substring(0, 200); // Truncate for key size
}

/**
 * Cached version of detectTemporalContextLLM
 */
export async function detectTemporalContextLLMCached(
  scene: string,
  userMessage: string,
  previousMessages: Array<{ role: string; content: string }>
): Promise<SelfieTemporalContext> {
  const cacheKey = getCacheKey(scene, userMessage, previousMessages);

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp.getTime() < CACHE_TTL_MS) {
    console.log('[TemporalDetection] Cache hit');
    return cached.result;
  }

  // Call LLM
  const result = await detectTemporalContextLLM(scene, userMessage, previousMessages);

  // Store in cache
  cache.set(cacheKey, { result, timestamp: new Date() });

  // Cleanup old entries
  if (cache.size > 100) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }

  return result;
}
```

Then use `detectTemporalContextLLMCached` instead of `detectTemporalContextLLM` in the main flow.

---

## Sub-Agent: image-generation-specialist

Given the complexity of the multi-reference image system, create a dedicated sub-agent:

```markdown
---
name: image-generation-specialist
description: Expert in AI image generation, reference image selection, and visual consistency. Use proactively for selfie generation, reference management, and visual identity.
tools: Read, Edit, Write, Glob, Grep, Bash
model: sonnet
---

You are the **Image Generation Specialist** for the Interactive Video Character project.

## Your Domain

**Primary responsibility:** All aspects of AI-generated selfies and visual character consistency.

### Files You Own:
- `src/services/imageGenerationService.ts` - Main image generation service
- `src/services/imageGeneration/` - All image generation utilities
  - `temporalDetection.ts` - LLM-based old/current photo detection
  - `contextEnhancer.ts` - LLM-based outfit/hairstyle inference
  - `referenceSelector.ts` - Multi-factor reference image scoring
  - `currentLookService.ts` - Hairstyle locking and persistence
  - `types.ts` - Image generation type definitions
- `src/utils/base64ReferenceImages/` - Reference image registry and base64 files
  - `index.ts` - Reference metadata and registry
  - `*.txt` - Base64 encoded reference images

### Database Tables You Own:
- `current_look_state` - Locked hairstyle/reference for consistency
- `selfie_generation_history` - Generation tracking for anti-repetition

## Key Patterns & Architecture

### 1. Multi-Reference System
**Never use a single static reference.** The system maintains 6 reference images:
- `curly_casual` - Most common (40% base frequency)
- `curly_dressed_up` - Special occasions (15%)
- `messy_bun_casual` - Active/casual days (20%)
- `messy_bun_dressed_up` - Practical formal look (8%)
- `straight_casual` - Style variation (15%)
- `straight_dressed_up` - Polished formal events (10%)

### 2. LLM-Based Context Detection
**Use AI, not regex** for temporal and context understanding:

```typescript
// ✅ CORRECT: LLM-based temporal detection
const temporal = await detectTemporalContextLLM(scene, userMessage, history);
// Handles: "Remember when we talked about X? Here I am!"

// ❌ WRONG: Regex patterns
if (message.match(/from last week/)) { ... }
// Misses nuance and context
```

### 3. Current Look Locking
**Maintain consistency within timeframes:**
- First selfie of day → Lock hairstyle for 24 hours
- Subsequent selfies → Use locked reference
- Old photos → Ignore lock (different day = different look OK)

```typescript
// Check lock before selection
const locked = await getCurrentLookState(userId);
if (locked && !temporalContext.isOldPhoto) {
  // Use locked reference
} else {
  // Run full selection
}
```

### 4. Multi-Factor Scoring
**Never hard-code reference selection.** Score all references:

Scoring factors (7+):
1. Scene match: +30/-50 (gym → messy_bun)
2. Mood affinity: +0 to +20 (confident → 0.9)
3. Time of day: +0 to +15 (morning → 0.9)
4. Season match: +10/-15 (winter → cozy)
5. Outfit hint: +15 to +25 (dressed up → formal)
6. Presence match: +25 to +30 (gym → messy_bun)
7. Calendar events: +20 (formal event → dressed_up)
8. LLM enhancement: +30 to +35 (outfit/hairstyle match)

Anti-repetition penalty:
- **EXCEPTION:** Same scene < 1 hour → NO penalty
- Otherwise: < 6h (-40), < 24h (-25), < 72h (-10)

### 5. Performance Optimization
**Parallel execution and caching:**
```typescript
// Run in parallel
const [temporal, locked, history] = await Promise.all([
  detectTemporalContextLLMCached(scene, msg, history), // Cached!
  getCurrentLookState(userId),
  getRecentSelfieHistory(userId, 10)
]);
```

**Cache LLM results:** 30s TTL by context hash.

## Best Practices

### DO:
✅ Use LLM for temporal detection (old vs current photo)
✅ Use LLM for context enhancement (outfit/hairstyle inference)
✅ Lock current look for 24h on first selfie of day
✅ Allow same reference for same scene < 1 hour
✅ Log full reasoning for selection (debugging)
✅ Run LLM calls in parallel with database queries
✅ Cache LLM results (30s TTL)
✅ Record every generation in history

### DON'T:
❌ Use regex for temporal detection (brittle, misses context)
❌ Hard-code reference selection
❌ Penalize repetition when scene is the same
❌ Change hairstyle mid-conversation (unless old photo)
❌ Ignore season context (no tank tops in December)
❌ Skip history recording (breaks anti-repetition)
❌ Block duplicate references entirely (context matters!)

## Anti-Patterns to Avoid

### ❌ Anti-Pattern: Regex Temporal Detection
```typescript
// BAD: Brittle pattern matching
if (message.match(/from last week/)) {
  isOldPhoto = true;
}
```
**Why bad:** Misses "Remember we talked about going? I'm here now!"

**Fix:** Use `detectTemporalContextLLM()` with Gemini Flash.

### ❌ Anti-Pattern: Unconditional Anti-Repetition
```typescript
// BAD: Always penalize recent use
if (recentlyUsed) {
  score -= 40; // Even for same scene!
}
```
**Why bad:** User asks "take another pic here" → different look is WEIRD.

**Fix:** Check scene match first:
```typescript
if (recentUse && recentUse.scene !== currentScene) {
  score -= 40; // Only penalize if different scene
}
```

### ❌ Anti-Pattern: Ignoring Current Look Lock
```typescript
// BAD: Always run full selection
const ref = selectReferenceImage(context);
```
**Why bad:** Hairstyle changes mid-conversation.

**Fix:** Check lock first:
```typescript
const locked = await getCurrentLookState(userId);
if (locked && !temporal.isOldPhoto) {
  return locked.referenceImageId;
}
```

## Testing Requirements

### Run before committing:
```bash
npm test -- --run -t "image.*generation"
npm test -- --run -t "temporal.*detection"
npm test -- --run -t "reference.*selector"
```

### Key test scenarios:
1. Old photo detection (LLM-based)
2. Current look locking and expiration
3. Anti-repetition with same-scene exception
4. Multi-factor scoring correctness
5. LLM context enhancement accuracy

## Integration Points

### With Other Services:
- **presenceDirector.ts** - Gets current outfit/location
- **calendarService.ts** - Gets upcoming events for outfit context
- **moodKnobs.ts** - Gets mood for mood affinity scoring
- **BaseAIService.ts** - Selfie action triggers image generation

### External Dependencies:
- **Gemini Flash** - Temporal detection, context enhancement
- **Gemini Imagen 3 Pro** - Image generation
- **Supabase** - Current look state, history tracking

## Common Tasks

### Adding a New Reference Image:
1. Create base64 file: `src/utils/base64ReferenceImages/new_style.txt`
2. Add metadata to registry: `src/utils/base64ReferenceImages/index.ts`
3. Set scores: baseFrequency, suitableScenes, moodAffinity, timeOfDay
4. Test selection: `npm test -- --run -t "reference.*selector"`

### Adjusting Scoring Weights:
1. Find factor in `referenceSelector.ts` → `scoreReference()`
2. Adjust weight (e.g., change +30 to +40)
3. Run tests to verify impact
4. Monitor production logs for selection distribution

### Debugging Selection:
```typescript
// Full reasoning is logged:
console.log('[ImageGen] Selection reasoning:', reasoning);
// Example output:
// curly_casual: 87.5 (Base: 40, Scene +30, Mood +17.5, ...)
// messy_bun: 102.3 (Base: 20, Scene +30, Presence +30, ...)
```

## Performance Targets

- **Total latency:** < 6 seconds (< 5.5s ideal)
- **LLM temporal detection:** < 300ms (cached < 10ms)
- **LLM context enhancement:** < 300ms (optional)
- **Database queries:** < 150ms (parallel)
- **Reference selection:** < 20ms (CPU-bound)
- **Imagen generation:** 3-5s (bottleneck, can't optimize)

## Cost Awareness

Per selfie: ~$0.001-0.002
- Temporal LLM (Flash): ~$0.0001
- Context LLM (Flash): ~$0.0001 (optional)
- Imagen generation: ~$0.001-0.0015

**Optimization:** Cache LLM results (30s TTL) to avoid redundant calls.

---

When working on image generation features, you are the primary expert. Use your deep knowledge of:
- Reference image metadata and scoring
- LLM-based context detection patterns
- Current look locking for consistency
- Anti-repetition with contextual exceptions
- Performance optimization via caching and parallelization

Always prioritize **visual consistency** (locked looks) and **contextual appropriateness** (scene/mood/calendar matching) over pure randomness.
```

Save this to: `.claude/agents/image-generation-specialist.md`

---

## README Organization

Given the project's many READMEs, organize image generation documentation clearly:

### Recommended Structure:

```
src/utils/base64ReferenceImages/
├── README.md                    # How to add/manage reference images
├── index.ts                     # Reference registry and metadata
└── *.txt                        # Base64 encoded images

src/services/imageGeneration/
├── README.md                    # Architecture overview, workflow diagram
├── types.ts
├── temporalDetection.ts
├── contextEnhancer.ts
├── referenceSelector.ts
└── currentLookService.ts

docs/
├── implementation/
│   └── multi_reference_image_implementation_plan.md  # THIS FILE
└── README.md                    # Index of all documentation
```

### Create: `src/utils/base64ReferenceImages/README.md`

```markdown
# Reference Images for AI Selfie Generation

This directory contains base64-encoded reference images used for generating Kayley's selfies with visual consistency.

## Quick Start

### Adding a New Reference Image

1. **Prepare the image:**
   - High-resolution (2K+ recommended)
   - Clear facial features matching CHARACTER_VISUAL_IDENTITY
   - Single person, good lighting
   - Matches the hairstyle/outfit you want to represent

2. **Encode to base64:**
   ```bash
   # macOS/Linux
   base64 -i input.jpg -o curly_hair_athletic.txt

   # Windows (PowerShell)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("input.jpg")) | Out-File curly_hair_athletic.txt
   ```

3. **Add to registry** in `index.ts`:
   ```typescript
   {
     id: 'curly_athletic',
     fileName: 'curly_hair_athletic.txt',
     hairstyle: 'curly',
     outfitStyle: 'athletic',
     baseFrequency: 0.1,
     suitableScenes: ['gym', 'park', 'hike'],
     unsuitableScenes: ['restaurant', 'concert'],
     suitableSeasons: ['spring', 'summer', 'fall'],
     moodAffinity: {
       playful: 0.7,
       confident: 0.6,
       relaxed: 0.8,
       excited: 0.7,
       flirty: 0.4,
     },
     timeOfDay: {
       morning: 0.9,
       afternoon: 0.8,
       evening: 0.5,
       night: 0.3,
     },
   }
   ```

4. **Test:**
   ```bash
   npm test -- --run -t "reference.*selector"
   ```

## Current References

| ID | Hairstyle | Outfit | Frequency | Primary Use Cases |
|----|-----------|--------|-----------|-------------------|
| curly_casual | Curly | Casual | 40% | Coffee shops, home, casual outings |
| curly_dressed_up | Curly | Formal | 15% | Dates, restaurants, events |
| messy_bun_casual | Messy bun | Casual | 20% | Gym, lazy days, working from home |
| messy_bun_dressed_up | Messy bun | Formal | 8% | Formal events with practical hair |
| straight_casual | Straight | Casual | 15% | General use, style variation |
| straight_dressed_up | Straight | Formal | 10% | Fancy dinners, concerts, milestones |

## Metadata Explanation

### `baseFrequency` (0-1)
How often this reference should be selected by default. Higher = more common.
- 0.4 = Very common (curly_casual - everyday look)
- 0.2 = Common (messy_bun_casual - active days)
- 0.15 = Occasional (curly_dressed_up, straight_casual)
- 0.1 = Rare (straight_dressed_up - special occasions)
- 0.08 = Very rare (messy_bun_dressed_up - practical formal)

### `suitableScenes` / `unsuitableScenes`
Scene keywords that boost/penalize selection.
- Suitable: +30 points
- Unsuitable: -50 points

### `moodAffinity` (0-1 for each mood)
How well this reference fits each mood type:
- 0.9 = Perfect match (confident + dressed_up)
- 0.5 = Neutral
- 0.3 = Poor match (relaxed + formal outfit)

### `timeOfDay` (0-1 for each time)
Appropriateness for different times:
- 0.9 = Very appropriate (morning + messy_bun)
- 0.5 = Neutral
- 0.2 = Inappropriate (morning + evening gown)

## Selection Algorithm

References are scored based on:
1. Base frequency (starting point)
2. Scene match
3. Mood affinity
4. Time of day
5. Season appropriateness
6. Calendar events
7. Presence context
8. LLM-inferred context (optional)
9. Anti-repetition penalty (if recently used)

See `src/services/imageGeneration/README.md` for full algorithm details.

## Visual Consistency Guidelines

**CRITICAL:** All reference images MUST maintain facial consistency:
- Same person across all images
- Similar facial features, skin tone, eye color
- Consistent with CHARACTER_VISUAL_IDENTITY in `imageGenerationService.ts`

Only hairstyle and outfit should vary between references.
```

### Create: `src/services/imageGeneration/README.md`

```markdown
# Image Generation Service

Multi-reference AI selfie generation with LLM-powered context detection and visual consistency.

## Architecture Overview

See the ASCII workflow diagram in `docs/implementation/multi_reference_image_implementation_plan.md` for the complete flow.

## Quick Reference

### Generate a Selfie
```typescript
const result = await generateCompanionSelfie({
  scene: 'coffee shop',
  mood: 'relaxed',
  userId: 'user-123',
  userMessage: 'Send me a selfie',
  previousMessages: conversationHistory.slice(-5),
  upcomingEvents: calendarEvents,
  currentLocation: 'downtown cafe',
  presenceOutfit: 'casual, just grabbed coffee',
});
```

### Key Services

| Service | Purpose |
|---------|---------|
| `temporalDetection.ts` | LLM-based old/current photo detection |
| `contextEnhancer.ts` | LLM-based outfit/hairstyle inference |
| `referenceSelector.ts` | Multi-factor reference scoring |
| `currentLookService.ts` | Hairstyle locking for consistency |

### Database Tables

| Table | Purpose |
|-------|---------|
| `current_look_state` | Locked hairstyle (24h) for consistency |
| `selfie_generation_history` | Generation tracking for anti-repetition |

## Design Principles

1. **LLM over regex** - Use Gemini Flash for context understanding
2. **Consistency within timeframes** - Lock hairstyle for 24h
3. **Contextual repetition handling** - Same scene = same look OK
4. **Multi-factor scoring** - 8+ factors, logged reasoning
5. **Performance first** - Parallel execution, 30s caching

## Performance

- **Total latency:** ~3.5-5.5s (Imagen bottleneck)
- **Cost per selfie:** ~$0.001-0.002
- **Cache hit rate:** ~40% (30s TTL)

## Testing

```bash
npm test -- --run -t "image.*generation"
npm test -- --run -t "temporal.*detection"
npm test -- --run -t "reference.*selector"
```

## Sub-Agent

For complex image generation tasks, use the `image-generation-specialist` sub-agent:
```
> Use the image-generation-specialist to optimize reference selection scoring
```

See `.claude/agents/image-generation-specialist.md` for details.
```

### Update: `docs/README.md` (or create if doesn't exist)

```markdown
# Documentation Index

## Implementation Plans
Detailed step-by-step guides for implementing features.

- [Multi-Reference Image System](implementation/multi_reference_image_implementation_plan.md) - Dynamic selfie generation with LLM-based context
- [Sub-Agents Implementation](completed_features/sub_agents_implementation_plan.md) - Specialized domain agents
- [Spontaneity System](completed_features/02_Spontaneity_System.md) - Spontaneous actions and selfies
- [Almost Moments](completed_features/03_Almost_Moments.md) - Near-miss interaction detection

## Service Documentation

- [Image Generation](../src/services/imageGeneration/README.md) - AI selfie generation architecture
- [System Prompts](System_Prompt_Guidelines.md) - Modular prompt architecture
- [Reference Images](../src/utils/base64ReferenceImages/README.md) - Managing reference images

## Project Overview

See [CLAUDE.md](../CLAUDE.md) for:
- Architecture overview
- Development workflow
- Testing strategy
- Sub-agent usage
```

---

## Summary of README Structure

1. **Domain-specific READMEs** - In service folders (`src/services/imageGeneration/README.md`)
2. **Asset READMEs** - In asset folders (`src/utils/base64ReferenceImages/README.md`)
3. **Implementation plans** - In `docs/implementation/` (detailed, step-by-step)
4. **Central index** - `docs/README.md` (navigation hub)
5. **Project guide** - `CLAUDE.md` (high-level overview for Claude Code)

This keeps documentation **close to the code** while maintaining a **clear navigation structure**.
