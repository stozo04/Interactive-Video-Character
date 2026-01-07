# Multi-Reference Image Generation System

This directory contains the multi-reference image generation system that dynamically selects reference images for AI companion selfies based on rich contextual factors.

## Overview

Instead of using a single static reference image, this system:
- Maintains 7+ reference images with different hairstyles and outfit styles
- Selects the most appropriate reference using multi-factor scoring
- Locks hairstyle for 24h consistency ("current look")
- Detects temporal context (old photo vs current photo) using LLM
- Tracks generation history for anti-repetition
- Allows same-scene exceptions for natural conversation flow

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Image Generation Flow                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  1. Get Current Look State           │
        │     (from current_look_state table)  │
        └──────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  2. Detect Temporal Context (LLM)    │
        │     • Old photo? (last week, etc.)   │
        │     • Current photo? (now, today)    │
        └──────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  3. Get Recent History               │
        │     (from selfie_generation_history) │
        └──────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  4. Build Selection Context          │
        │     • Scene, mood, time, season      │
        │     • Calendar events                │
        │     • Presence (outfit/mood)         │
        └──────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  5. Score All References             │
        │     • Base frequency                 │
        │     • Scene suitability (+30/-50)    │
        │     • Mood affinity (+0 to +20)      │
        │     • Time of day (+0 to +15)        │
        │     • Season (+10/-15)               │
        │     • Outfit hint (+15 to +25)       │
        │     • Presence match (+25 to +30)    │
        │     • Calendar events (+20)          │
        └──────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  6. Apply Anti-Repetition Penalty   │
        │     • < 6h: -40 points               │
        │     • < 24h: -25 points              │
        │     • < 72h: -10 points              │
        │     • EXCEPTION: Same scene < 1h     │
        └──────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  7. Select Highest Scored Reference  │
        └──────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  8. Lock Current Look (if "now")     │
        │     • 24h expiration                 │
        │     • Bypass for old photos          │
        └──────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  9. Generate Image with Selected Ref │
        └──────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────┐
        │  10. Record in History               │
        │      (for future anti-repetition)    │
        └──────────────────────────────────────┘
```

## File Structure

```
src/services/imageGeneration/
├── types.ts                    # Type definitions for the system
├── referenceSelector.ts        # Multi-factor scoring algorithm
├── temporalDetection.ts        # LLM-based old vs current photo detection
├── contextEnhancer.ts          # Optional LLM-based context inference
├── currentLookService.ts       # Database operations for state/history
└── README.md                   # This file

src/utils/referenceImages/
├── index.ts                    # Reference image registry + metadata
├── curlyHairCasual/            # Curly hair casual reference images
├── curlyHairFormal/            # Curly hair formal reference images
├── straightHairCasual/         # Straight hair casual reference images
├── straightHairFormal/         # Straight hair formal reference images
├── curly_hair_casual.jpg       # Legacy reference images
├── curly_hair_dressed_up.jpg
├── curly_hair_messy_bun_casual.jpg
├── curly_hair_messy_bun_dressed_up.jpg
├── straight_hair_casual.jpg
├── straight_hair_dressed_up.jpg
└── straight_hair_bun_casual.jpg

supabase/migrations/
└── create_image_generation_tables.sql  # Database schema
```

## Key Concepts

### 1. Current Look Locking

**Problem:** Hairstyle changing every 5 minutes within the same conversation is unrealistic.

**Solution:** Lock the hairstyle for 24h after the first "current" selfie.

**Implementation:**
- `current_look_state` table stores locked hairstyle per user
- Lock reasons: `session_start`, `first_selfie_of_day`, `explicit_now_selfie`
- Expiration: 24 hours by default
- Bypass: Old photos can use different hairstyles

**Example:**
```
User: "Send me a selfie at the coffee shop"
→ Selects curly_casual, locks for 24h

User: "Now send me one at the gym"
→ Uses curly_casual (locked), different outfit/scene OK

User: "Show me that pic from last week at the beach"
→ Can use straight_dressed_up (old photo bypass)
```

### 2. Temporal Detection

**Problem:** Need to distinguish "now" photos from "old" photos to allow hairstyle variation.

**Solution:** LLM-based detection of temporal phrases with caching.

**Implementation:**
- Uses Gemini Flash (cheap, fast) with 0.1 temperature
- Analyzes conversation context + user message
- Detects phrases: "last week", "yesterday", "when I was at...", etc.
- 30s TTL cache for performance
- Fallback heuristics if LLM unavailable

**Example Detections:**
```
"Send me a selfie" → now (isOldPhoto: false)
"Here's a pic from last weekend" → old (isOldPhoto: true, timeframe: last_week)
"Remember when we talked about going? I'm here now!" → now (context-aware)
```

### 3. Multi-Factor Scoring

**Problem:** Need intelligent reference selection, not random.

**Solution:** Score each reference on 8+ factors, select highest.

**Factors:**
1. **Base Frequency** (×100): curly_casual = 40%, straight_dressed_up = 10%
2. **Scene Match** (+30 suitable, -50 unsuitable): gym → messy_bun +30, restaurant -50
3. **Mood Affinity** (+0 to +20): confident → straight_dressed_up +19, curly_casual +12
4. **Time of Day** (+0 to +15): evening → dressed_up +14, casual +9
5. **Season** (+10 match, -15 mismatch): winter → winter-suitable +10
6. **Outfit Hint** (+15 to +25): "dressed up" in scene → dressed_up +25
7. **Presence Match** (+25 to +30): "gym" in presence → messy_bun +30
8. **Calendar Events** (+20): formal event within 2h → dressed_up +20

**Example Scoring:**
```
Scene: "restaurant", Mood: "confident", Time: 8pm, Season: winter

curly_casual:
  Base: 40, Scene: -50 (unsuitable), Mood: +12, Time: +9, Season: +10
  TOTAL: 21

straight_dressed_up:
  Base: 10, Scene: +30 (suitable), Mood: +19, Time: +14, Season: +10
  TOTAL: 83 ← SELECTED
```

### 4. Anti-Repetition with Same-Scene Exception

**Problem:** Don't want same reference image every day, but repeated scene is OK.

**Solution:** Penalize recent use, but skip penalty for same scene < 1 hour.

**Penalties:**
- Used < 6h ago: -40 points
- Used < 24h ago: -25 points
- Used < 72h ago: -10 points
- **EXCEPTION:** Same scene within 1h → NO penalty

**Why the exception?** Natural conversation:
```
User: "Send me a selfie at the cafe"
→ Uses curly_casual

User: "Take another one with the latte in frame"
→ Still at cafe, < 1h → Uses curly_casual (no penalty, realistic!)
```

## Database Schema

### `current_look_state`

Stores locked "current look" for 24h consistency.

```sql
CREATE TABLE current_look_state (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  hairstyle TEXT NOT NULL,           -- 'curly', 'straight', 'messy_bun'
  reference_image_id TEXT NOT NULL,  -- 'curly_casual', etc.
  locked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  lock_reason TEXT NOT NULL,         -- 'session_start', etc.
  is_current_look BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `selfie_generation_history`

Tracks all generations for anti-repetition.

```sql
CREATE TABLE selfie_generation_history (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  reference_image_id TEXT NOT NULL,
  hairstyle TEXT NOT NULL,
  outfit_style TEXT NOT NULL,        -- 'casual', 'dressed_up', etc.
  scene TEXT NOT NULL,
  mood TEXT,
  is_old_photo BOOLEAN DEFAULT FALSE,
  reference_date TIMESTAMPTZ,        -- For old photos
  selection_factors JSONB,           -- Scoring reasoning
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_selfie_history_user_generated
  ON selfie_generation_history(user_id, generated_at DESC);
```

## API Usage

### Basic Usage (Legacy - No Multi-Reference)

```typescript
import { generateCompanionSelfie } from '@/services/imageGenerationService';

const result = await generateCompanionSelfie({
  scene: 'coffee shop',
  mood: 'happy',
  outfit: 'casual',
});
// Uses default reference, no dynamic selection
```

### Advanced Usage (Multi-Reference Enabled)

```typescript
const result = await generateCompanionSelfie({
  scene: 'restaurant',
  mood: 'confident',
  outfit: 'dressed up',

  // Enable multi-reference system
  userId: 'user@example.com',
  userMessage: 'Send me a selfie at dinner',
  conversationHistory: [
    { role: 'user', content: 'Going to a fancy restaurant tonight' },
    { role: 'assistant', content: 'Oh nice! Have fun!' },
  ],

  // Optional: Presence and calendar context
  presenceOutfit: 'getting ready for dinner',
  presenceMood: 'excited',
  upcomingEvents: [
    { title: 'Dinner with Sarah', startTime: new Date(), isFormal: true },
  ],
});
```

## Testing

Run all image generation tests:

```bash
npm test -- --run -t "imageGeneration"
```

Test individual services:

```bash
# Reference selection
npm test -- --run -t "referenceSelector"

# Temporal detection
npm test -- --run -t "temporalDetection"

# Current look service
npm test -- --run -t "currentLookService"
```

## Performance Characteristics

- **LLM Calls:** 1 per selfie (temporal detection, 30s cache)
- **Database Queries:** 2 reads (current look, history), 2 writes (lock, record)
- **Total Overhead:** ~200-400ms (parallel execution)
- **Cache Hit Rate:** ~80% for temporal detection (conversations < 30s apart)

## Debugging

Enable verbose logging:

```typescript
console.log('📸 [ImageGen] Selected reference:', selectedReferenceId);
console.log('📸 [ImageGen] Selection reasoning:', selectionReasoning);
```

**Selection reasoning output example:**
```
📸 [ImageGen] Selection reasoning: [
  "Using locked current look: curly",
  "Locked at: 12/27/2025, 10:30:00 AM",
  "Reason: explicit_now_selfie",
  "curly_casual: 95.0 (+30 scene match (coffee), +14 mood (relaxed: 0.8), ...)",
  "🎯 SELECTED: curly_casual (score: 95.00)"
]
```

## Reference Image Metadata Example

```typescript
{
  id: 'curly_casual',
  fileName: 'curly_hair_casual.txt',
  hairstyle: 'curly',
  outfitStyle: 'casual',
  baseFrequency: 0.4, // 40% default selection rate

  suitableScenes: ['coffee', 'cafe', 'home', 'park', 'city'],
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
    morning: 0.9,    // Great for morning coffee
    afternoon: 0.8,
    evening: 0.6,
    night: 0.5,
  },
}
```

## Adding New Reference Images

1. **Create Base64 File**
   ```bash
   # Convert image to base64
   base64 -i new_image.jpg > src/utils/referenceImages/ponytail_athletic.txt
   ```

2. **Add Metadata to Registry**
   ```typescript
   // src/utils/referenceImages/index.ts
   import ponytailAthleticRaw from './ponytail_athletic.txt?raw';

   export const REFERENCE_IMAGE_REGISTRY: ReferenceImageMetadata[] = [
     // ... existing references
     {
       id: 'ponytail_athletic',
       fileName: 'ponytail_athletic.txt',
       hairstyle: 'ponytail',
       outfitStyle: 'athletic',
       baseFrequency: 0.15,
       suitableScenes: ['gym', 'park', 'run', 'yoga'],
       unsuitableScenes: ['restaurant', 'concert'],
       suitableSeasons: ['spring', 'summer', 'fall'],
       moodAffinity: { playful: 0.8, confident: 0.9, relaxed: 0.5, excited: 0.9, flirty: 0.4 },
       timeOfDay: { morning: 0.9, afternoon: 0.8, evening: 0.6, night: 0.3 },
     },
   ];

   const REFERENCE_IMAGE_CONTENT: Record<string, string> = {
     // ... existing mappings
     'ponytail_athletic.txt': ponytailAthleticRaw,
   };
   ```

3. **Update Types (if new hairstyle)**
   ```typescript
   // src/services/imageGeneration/types.ts
   export type HairstyleType = 'curly' | 'straight' | 'messy_bun' | 'ponytail';
   ```

4. **Update Migration (if new hairstyle)**
   ```sql
   -- supabase/migrations/create_image_generation_tables.sql
   hairstyle TEXT NOT NULL
     CHECK (hairstyle IN ('curly', 'straight', 'messy_bun', 'ponytail')),
   ```

5. **Test Integration**
   ```bash
   npm test -- --run -t "referenceSelector"
   ```

## Troubleshooting

### Hairstyle keeps changing every selfie

**Cause:** Current look not being locked.

**Fix:** Ensure `userId` is passed to `generateCompanionSelfie()`.

```typescript
// ❌ Bad - No userId
const result = await generateCompanionSelfie({ scene: 'cafe' });

// ✅ Good - Multi-reference enabled
const result = await generateCompanionSelfie({
  scene: 'cafe',
  userId: 'user@example.com',
  userMessage: '...',
  conversationHistory: [...],
});
```

### Old photo detection not working

**Cause:** LLM not receiving enough context.

**Fix:** Pass more conversation history:

```typescript
conversationHistory: chatHistory.slice(-10).map(msg => ({
  role: msg.role === 'user' ? 'user' : 'assistant',
  content: msg.text,
}))
```

### Same reference every time despite variety

**Cause:** Anti-repetition disabled or broken.

**Check:** Database has recent history:
```sql
SELECT * FROM selfie_generation_history
WHERE user_id = 'user@example.com'
ORDER BY generated_at DESC LIMIT 10;
```

### LLM temporal detection errors

**Fallback:** Heuristic detection still works:
```typescript
// Automatically falls back to keyword matching
// if LLM fails or API key missing
```

## Future Enhancements

- [ ] Location-aware selection (GPS → beach reference if at beach)
- [ ] Weather-aware selection (sunny → outdoor references)
- [ ] User preference learning (track which refs user likes)
- [ ] Confidence scoring (show "experimental" badge for low-confidence selections)
- [ ] A/B testing framework for scoring weights

## Related Documentation

- [Implementation Plan](../../../docs/implementation/multi_reference_image_implementation_plan.md)
- [Sub-Agent Specialist](.claude/agents/image-generation-specialist.md)
- [Main Image Service](../imageGenerationService.ts)
