# Expanding the Reference Image Library

## Overview

The multi-reference image system currently uses **7 base64 reference images** to generate context-appropriate selfies. Expanding this library to 15-25+ references will dramatically improve:

- **Context awareness** - Better matching for specific activities/locations
- **Visual variety** - More natural variation over time
- **Presence state accuracy** - More precise matches for detected states
- **User engagement** - Fresh, unexpected selfies that feel more alive

## Current Reference Coverage

### Existing References (7)

| Reference ID | Hairstyle | Outfit | Best For |
|-------------|-----------|---------|----------|
| `curly_casual` | Natural curly | Casual wear | Default, relaxed contexts |
| `curly_dressed_up` | Natural curly | Dressy | Formal events, date night |
| `straight_casual` | Straightened | Casual wear | Styled but relaxed |
| `straight_dressed_up` | Straightened | Dressy | Professional, fancy occasions |
| `messy_bun_casual` | Messy bun | Casual wear | Gym, morning, practical |
| `messy_bun_dressed_up` | Messy bun | Dressy | Chic casual, brunch |
| (Additional variation) | - | - | - |

### Coverage Gaps

**Hairstyles Missing:**
- Ponytail (high/low)
- Braids (single/double)
- Half-up styles
- Pulled back with clips
- Wet/shower hair
- Hat/headband variations

**Outfit Contexts Missing:**
- Athletic/workout wear
- Cozy/loungewear (oversized hoodies, sweats)
- Professional/business casual
- Going out/party wear
- Sleep/pajamas
- Specific activities (cooking apron, etc.)

**Location/Activity Contexts Missing:**
- Outdoor/nature settings
- Gym environment
- Coffee shop/cafe
- Kitchen/cooking
- Bed/bedroom (morning/night)
- Car/travel

## Recommended Expansion Strategy

### Phase 1: High-Impact Additions (8-10 images)

Target the most common presence states and user scenarios:

#### 1. **Workout Set (2 images)**
- `ponytail_athletic` - High ponytail, sports bra/tank, gym environment
  - **Triggers:** "at the gym", "working out", "post-workout"
  - **Scoring:** +35 for gym presence, +20 for athletic activities

- `messy_bun_athletic` - Messy bun, workout clothes, sweaty/active
  - **Triggers:** "just finished workout", "at the gym"
  - **Scoring:** +30 gym presence (already exists) + outfit match

#### 2. **Cozy/Loungewear Set (2 images)**
- `messy_bun_cozy` - Messy bun, oversized hoodie, at home
  - **Triggers:** "in my hoodie", "lounging", "relaxing at home"
  - **Scoring:** +30 for hoodie/cozy presence, +15 for home location

- `curly_pajamas` - Natural hair, cute pajamas, bedroom/morning
  - **Triggers:** "in my pjs", "just woke up", "getting ready for bed"
  - **Scoring:** +35 for pajama presence, +20 for morning/night time

#### 3. **Professional Set (2 images)**
- `straight_professional` - Sleek hair, blazer, office/clean background
  - **Triggers:** "at work", "in a meeting", "professional"
  - **Scoring:** +30 for work presence, +25 for formal calendar events

- `half_up_business_casual` - Half-up hairstyle, blouse, polished casual
  - **Triggers:** "working from home", "video call"
  - **Scoring:** +25 for work activities, +15 for business casual

#### 4. **Going Out Set (2 images)**
- `curls_glam` - Styled curls, makeup, statement jewelry, dressed up
  - **Triggers:** "getting ready", "date night", "going out"
  - **Scoring:** +30 getting ready presence, +25 evening events

- `straight_party` - Sleek hair, bold outfit, night out vibe
  - **Triggers:** "party", "bar", "club", formal evening events
  - **Scoring:** +30 for party/nightlife, +20 for evening timeframe

#### 5. **Casual Outdoor Set (2 images)**
- `ponytail_outdoor` - Low ponytail, casual outfit, outdoor setting
  - **Triggers:** "outside", "park", "walking"
  - **Scoring:** +25 for outdoor location, +15 for daytime

- `braids_casual` - Braids, casual summer outfit, bright/sunny
  - **Triggers:** "sunny day", "outside", summer events
  - **Scoring:** +20 summer season, +15 outdoor activities

### Phase 2: Advanced Variations (10-15 additional)

Once Phase 1 is complete and tested:

- Morning/night variations (bed hair, sleepy)
- Seasonal specifics (winter coat, summer dress)
- Activity-specific (cooking, reading, gaming setup)
- Emotional states (crying, laughing hard, concentrated)
- Special occasions (birthday hat, holiday themes)

## Implementation Guide

### Step 1: Source the Images

**Option A: AI Generation (Recommended)**
Use a consistent AI model with face reference:

1. Generate with Flux/Midjourney/DALL-E using current references
2. Maintain facial consistency with reference images
3. Generate at 1024x1024 or higher resolution
4. Use consistent lighting and quality

**Example Prompt Template:**
```
A high-resolution, photorealistic selfie of [the same woman from reference image].
She has [hairstyle description] and is wearing [outfit description].
She is [location/setting]. Natural smartphone selfie aesthetic with
soft lighting and shallow depth of field. Looking directly at camera
with [expression].
```

**Option B: Professional Photoshoot**
- Hire a model or create synthetic person
- Shoot 20-30 variations in one session
- More expensive but highest quality/consistency

**Option C: Hybrid Approach**
- Generate base images with AI
- Use face-swap for perfect consistency
- Manual touch-ups for quality

### Step 2: Convert to Base64

```bash
# Using Node.js
node -e "const fs = require('fs'); const img = fs.readFileSync('image.png'); console.log(img.toString('base64'));"

# Or use online tool: https://www.base64-image.de/
```

### Step 3: Add to Registry

File: `src/utils/base64ReferencedImages.ts`

```typescript
// Add new reference
const PONYTAIL_ATHLETIC: ReferenceImageMetadata = {
  id: 'ponytail_athletic',
  hairstyle: 'ponytail',
  outfitStyle: 'athletic',
  base64Content: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
  baseFrequency: 0.10, // 10% base frequency
  description: 'High ponytail, athletic wear, gym environment'
};

// Add to registry
export const REFERENCE_IMAGE_REGISTRY: ReferenceImageMetadata[] = [
  // ... existing references
  PONYTAIL_ATHLETIC,
];
```

### Step 4: Add Scoring Logic

File: `src/services/imageGeneration/referenceSelector.ts`

Add scoring patterns for the new reference:

```typescript
// In scoreReference function, add new scoring factors:

// FACTOR 6.5: Athletic/Gym Context (NEW)
if (context.presenceOutfit) {
  const presenceLower = context.presenceOutfit.toLowerCase();

  // Ponytail for gym/athletic
  if ((presenceLower.includes('gym') || presenceLower.includes('workout'))
      && ref.hairstyle === 'ponytail' && ref.outfitStyle === 'athletic') {
    score += 35;
    factors.push('+35 presence match (gym → ponytail athletic)');
  }

  // Cozy hoodie match
  if ((presenceLower.includes('hoodie') || presenceLower.includes('cozy'))
      && ref.id === 'messy_bun_cozy') {
    score += 30;
    factors.push('+30 presence match (cozy → hoodie messy bun)');
  }

  // Pajamas match
  if ((presenceLower.includes('pj') || presenceLower.includes('pajama'))
      && ref.id === 'curly_pajamas') {
    score += 35;
    factors.push('+35 presence match (pajamas → curly pjs)');
  }
}

// FACTOR 7.5: Time of Day (NEW)
if (context.timeOfDay === 'early_morning' && ref.id === 'curly_pajamas') {
  score += 20;
  factors.push('+20 time match (morning → pajamas)');
}

if (context.timeOfDay === 'night' && ref.id === 'curly_pajamas') {
  score += 20;
  factors.push('+20 time match (night → pajamas)');
}

// FACTOR 8.5: Activity Boost (NEW)
if (context.presenceActivity) {
  const activityLower = context.presenceActivity.toLowerCase();

  if (activityLower.includes('workout') && ref.outfitStyle === 'athletic') {
    score += 25;
    factors.push('+25 activity match (workout → athletic)');
  }

  if (activityLower.includes('relax') && ref.id === 'messy_bun_cozy') {
    score += 20;
    factors.push('+20 activity match (relaxing → cozy)');
  }
}
```

### Step 5: Update TypeScript Types

File: `src/services/imageGeneration/types.ts`

```typescript
// Add new hairstyle options
export type HairstyleOption =
  | 'curly'
  | 'straight'
  | 'messy_bun'
  | 'ponytail'      // NEW
  | 'braids'        // NEW
  | 'half_up';      // NEW

// Add new outfit styles
export type OutfitStyle =
  | 'casual'
  | 'dressed_up'
  | 'athletic'      // NEW
  | 'cozy'          // NEW
  | 'professional'  // NEW
  | 'party';        // NEW
```

### Step 6: Test the New References

File: `src/services/imageGeneration/__tests__/referenceSelector.test.ts`

```typescript
describe('Reference Selection - Expanded Library', () => {
  it('should select ponytail_athletic for gym presence', () => {
    const context: ReferenceSelectionContext = {
      scene: 'at the gym',
      presenceOutfit: 'just got back from the gym',
      currentSeason: 'summer',
      timeOfDay: 'morning',
      currentLocation: 'gym',
      temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      currentLookState: null,
      recentReferenceHistory: [],
      upcomingEvents: [],
    };

    const result = selectReferenceImage(context);

    expect(result.referenceId).toBe('ponytail_athletic');
    expect(result.reasoning).toContain('+35 presence match (gym → ponytail athletic)');
  });

  it('should select messy_bun_cozy for hoodie presence', () => {
    const context: ReferenceSelectionContext = {
      scene: 'relaxing on couch',
      presenceOutfit: 'in my oversized hoodie',
      currentSeason: 'winter',
      timeOfDay: 'evening',
      currentLocation: 'home',
      temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      currentLookState: null,
      recentReferenceHistory: [],
      upcomingEvents: [],
    };

    const result = selectReferenceImage(context);

    expect(result.referenceId).toBe('messy_bun_cozy');
    expect(result.reasoning).toContain('+30 presence match (cozy → hoodie messy bun)');
  });

  it('should select curly_pajamas for morning presence', () => {
    const context: ReferenceSelectionContext = {
      scene: 'just woke up',
      presenceOutfit: 'still in my pajamas',
      currentSeason: 'summer',
      timeOfDay: 'early_morning',
      currentLocation: 'bedroom',
      temporalContext: { isOldPhoto: false, temporalPhrases: [] },
      currentLookState: null,
      recentReferenceHistory: [],
      upcomingEvents: [],
    };

    const result = selectReferenceImage(context);

    expect(result.referenceId).toBe('curly_pajamas');
    expect(result.reasoning).toContain('+35 presence match (pajamas → curly pjs)');
    expect(result.reasoning).toContain('+20 time match (morning → pajamas)');
  });
});
```

### Step 7: Update Anti-Repetition Logic

The anti-repetition system will automatically handle more references, but consider:

```typescript
// In referenceSelector.ts
const recentUses = context.recentReferenceHistory.slice(-10);

for (const item of scored) {
  const timesUsedRecently = recentUses.filter(h => h.referenceId === item.ref.id).length;

  if (timesUsedRecently > 0) {
    // Penalize more heavily with larger library
    const penalty = timesUsedRecently * 15; // Increased from 10
    item.score -= penalty;
    reasoning.push(`-${penalty} anti-repetition (used ${timesUsedRecently}x recently)`);
  }
}
```

## Best Practices

### 1. **Maintain Facial Consistency**
- Use the same base face across all references
- Facial features must be clearly recognizable as the same person
- Eye color, face shape, distinctive features should match

### 2. **Balance Base Frequencies**
```typescript
// Distribute frequency based on expected usage
const BASE_FREQUENCIES = {
  // Common, versatile (higher frequency)
  'curly_casual': 0.15,
  'messy_bun_casual': 0.15,

  // Moderate use (medium frequency)
  'straight_casual': 0.12,
  'ponytail_athletic': 0.10,
  'messy_bun_cozy': 0.10,

  // Specialized (lower frequency)
  'curly_dressed_up': 0.08,
  'straight_professional': 0.08,
  'curly_pajamas': 0.07,

  // Rare/special (lowest frequency)
  'straight_party': 0.05,
  'braids_casual': 0.05,
};

// Total should add up to ~1.0
```

### 3. **Test Scoring Thoroughly**
Each reference should have:
- At least one **strong trigger** (+30-35 bonus)
- Several **moderate triggers** (+15-25 bonus)
- Clear **anti-patterns** (contexts where it shouldn't be selected)

### 4. **Document Each Reference**
```typescript
const PONYTAIL_ATHLETIC: ReferenceImageMetadata = {
  id: 'ponytail_athletic',
  hairstyle: 'ponytail',
  outfitStyle: 'athletic',
  base64Content: '...',
  baseFrequency: 0.10,
  description: 'High ponytail, athletic wear, gym environment',

  // NEW: Add metadata for scoring
  metadata: {
    idealContexts: ['gym', 'workout', 'athletic', 'running'],
    avoidContexts: ['formal', 'date', 'professional'],
    seasonalBias: 'none',
    timeOfDayBias: ['morning', 'afternoon'],
    moodBias: ['energetic', 'determined', 'strong'],
  }
};
```

### 5. **Monitor Selection Distribution**

Add analytics to track which references are being selected:

```typescript
// In imageGenerationService.ts
console.log('[ImageGen] Selection distribution (last 100):',
  getSelectionDistribution(userId));

function getSelectionDistribution(userId: string) {
  // Query last 100 generations
  // Return frequency map: { 'curly_casual': 23, 'messy_bun_casual': 18, ... }
}
```

**Target distribution:**
- No single reference should be >30% of selections
- All references should be selected at least occasionally (>2%)
- Specialized references (pajamas, party) can be rare but should still appear

### 6. **Version Your Reference Library**

```typescript
export const REFERENCE_LIBRARY_VERSION = 'v2.0'; // Track expansions

export const REFERENCE_CHANGELOG = {
  'v1.0': '7 base references (curly, straight, messy_bun)',
  'v2.0': '15 references - added athletic, cozy, professional sets',
  'v3.0': 'TBD - seasonal variations, emotional states',
};
```

## Quality Checklist

Before adding a new reference, verify:

- [ ] Image is 1024x1024+ resolution
- [ ] Facial features match existing references
- [ ] Lighting is natural and flattering
- [ ] Background is appropriate for context
- [ ] Outfit/hairstyle is clearly distinguishable
- [ ] Base64 encoding is correct
- [ ] Scoring logic has been added
- [ ] Tests have been written
- [ ] Selection distribution is healthy
- [ ] Anti-repetition works correctly

## Performance Considerations

### File Size
- Each 1024x1024 PNG = ~500-800KB raw
- Base64 encoding = ~30% larger
- 7 images ≈ 5-7MB
- 25 images ≈ 18-25MB

**Optimization strategies:**
- Use JPG instead of PNG (smaller, slightly lower quality)
- Compress images before base64 (use tinypng.com)
- Consider lazy-loading references
- Use WebP format for better compression

### Selection Speed
- Scoring runs on every selfie request
- More references = more iterations
- Current: ~7 references scored in <1ms
- Target: <5ms even with 25+ references

**Keep scoring logic efficient:**
- Avoid complex regex patterns
- Use simple string operations
- Cache computed values where possible

## Migration Path

### Adding New References (Zero Downtime)

1. **Add references to code**
   - No database changes needed
   - Deploy new code with expanded registry

2. **Monitor selection**
   - Watch logs for new reference selections
   - Verify scoring triggers correctly

3. **Tune frequencies**
   - Adjust `baseFrequency` values
   - Balance distribution

4. **Iterate**
   - Add more references based on gaps
   - Remove underperforming references

### Removing References

```typescript
// Mark as deprecated instead of removing
const OLD_REFERENCE = {
  id: 'old_messy_bun',
  deprecated: true,
  baseFrequency: 0.0, // Disable selection
  // ... keep in registry for historical records
};

// Filter out deprecated in selector
const activeReferences = REFERENCE_IMAGE_REGISTRY.filter(r => !r.deprecated);
```

## Example: Complete New Reference Addition

Here's a full example of adding `ponytail_athletic`:

```typescript
// 1. Generate/source the image
// 2. Convert to base64
// 3. Add to registry

const PONYTAIL_ATHLETIC: ReferenceImageMetadata = {
  id: 'ponytail_athletic',
  hairstyle: 'ponytail',
  outfitStyle: 'athletic',
  base64Content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...[FULL BASE64]',
  baseFrequency: 0.10,
  description: 'High ponytail, sports bra, gym environment - energetic and focused',
};

// 4. Add to registry export
export const REFERENCE_IMAGE_REGISTRY: ReferenceImageMetadata[] = [
  CURLY_CASUAL,
  CURLY_DRESSED_UP,
  STRAIGHT_CASUAL,
  STRAIGHT_DRESSED_UP,
  MESSY_BUN_CASUAL,
  MESSY_BUN_DRESSED_UP,
  MESSY_BUN_ATHLETIC, // existing
  PONYTAIL_ATHLETIC,  // NEW
];

// 5. Add scoring in referenceSelector.ts
if ((presenceLower.includes('gym') || presenceLower.includes('workout'))
    && ref.hairstyle === 'ponytail' && ref.outfitStyle === 'athletic') {
  score += 35;
  factors.push('+35 presence match (gym → ponytail athletic)');
}

// 6. Add test
it('should select ponytail_athletic for gym workout', () => {
  const context = createTestContext({
    presenceOutfit: 'at the gym working out',
    presenceActivity: 'lifting weights',
  });

  const result = selectReferenceImage(context);
  expect(result.referenceId).toBe('ponytail_athletic');
});

// 7. Deploy and monitor
```

## ROI Analysis

### Effort Required
- **Phase 1 (8-10 images):** 2-4 hours (sourcing + integration)
- **Phase 2 (15+ images):** 4-8 hours
- **Ongoing maintenance:** Minimal (tune frequencies)

### Impact
- **Visual variety:** 3x increase (7 → 25 references)
- **Presence accuracy:** ~60% → ~90% coverage
- **User engagement:** More "wow" moments, less predictability
- **Conversation depth:** More natural activity-based conversations

### Recommendation
**YES - Start with Phase 1 (8-10 images) targeting gym, cozy, and professional contexts.**

These will have the highest ROI as they cover the most common presence states and user scenarios.

## Resources

- **Image Generation:** Midjourney, DALL-E, Flux
- **Face Consistency:** Consistent character/seed features
- **Compression:** TinyPNG, Squoosh.app
- **Base64 Conversion:** base64-image.de
- **Testing:** Existing test suite in `__tests__/referenceSelector.test.ts`

---

**Questions? Issues?**
- See `docs/kayley_presence_integration.md` for presence tracking
- See `src/services/imageGeneration/README.md` for scoring details
- Check `__tests__/referenceSelector.test.ts` for examples
