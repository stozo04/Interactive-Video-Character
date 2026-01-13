# Reference Images System

Reference images are base photos used by the AI image generator to maintain visual consistency for Kayley's appearance.

## How Kayley Takes a Selfie

```
User Message → LLM Analyzes → Pick Reference Photo → Generate New Image
```

### Step 1: User Asks for a Selfie
```
You: "Send me a pic from the holiday party last week"
```

### Step 2: LLM Figures Out What You Want
The LLM reads your message and conversation, then outputs:
```javascript
{
  sceneDescription: "Festive party with twinkling lights...",
  hairstyleGuidance: { preference: "curly" },    // LLM decides this fits
  outfitContext: { style: "dressed_up" }         // Party = dressed up
}
```

### Step 3: Reference Selector Picks Best Match
```javascript
// Scores each image based on LLM guidance:
"curly_dressed_up":  +40 (hairstyle) +45 (outfit) = 85 pts  ← WINNER
"curly_casual":      +40 (hairstyle) -30 (outfit) = 10 pts
"straight_dressed":  -50 (hairstyle) +45 (outfit) = -5 pts
```

### Step 4: Generate Image
Gemini receives the LLM prompt + selected reference → generates new selfie.

---

## Config-Driven Architecture

**config.json defines folder defaults with optional per-image overrides:**
```json
{
  "athletic": {
    "hairstyle": "messy_bun",
    "outfit": "athletic",
    "images": [
      { "fileName": "athletic_hair_bun.jpg", "id": "athletic_bun" },
      { "fileName": "athletic_hair_ponytail.jpg", "id": "athletic_ponytail", "hairstyle": "ponytail" }
    ]
  },
  "curlyHairCasual": {
    "hairstyle": "curly",
    "outfit": "casual",
    "images": [
      { "fileName": "curly_hair_casual.jpg", "id": "curly_casual" },
      { "fileName": "curly_hair_bun_in_bed.jpg", "id": "curly_bun_cozy", "hairstyle": "messy_bun", "outfit": "cozy" }
    ]
  }
}
```

- **Folder defines defaults** - `hairstyle` and `outfit` apply to all images
- **Images can override** - specify `hairstyle` or `outfit` only if different from folder default
- **No code changes needed** to add new images or categories

---

## Adding a New Reference Image

### Step 1: Create the Image
- Put it in an existing folder (e.g., `athletic/`) or create a new one
- Use `.jpg` format

### Step 2: Add to config.json
Add to the folder's `images` array:
```json
{
  "athletic": {
    "hairstyle": "messy_bun",
    "outfit": "athletic",
    "images": [
      { "fileName": "my_new_image.jpg", "id": "unique_id" }
    ]
  }
}
```

If the image differs from folder defaults, add overrides:
```json
{ "fileName": "ponytail_workout.jpg", "id": "ponytail_athletic", "hairstyle": "ponytail" }
```

### Step 3: Verify
Run dev server, check console:
```
[ReferenceImages] Loaded X reference images: [...]
```

---

## Adding a New Folder

### Step 1: Create the folder
```
src/utils/referenceImages/swimwear/
```

### Step 2: Add folder config with defaults
```json
{
  "swimwear": {
    "hairstyle": "curly",
    "outfit": "swimwear",
    "images": [
      { "fileName": "beach_selfie.jpg", "id": "curly_swimwear" },
      { "fileName": "pool_selfie.jpg", "id": "straight_swimwear", "hairstyle": "straight" }
    ]
  }
}
```

### Step 3: Update types (if new outfit/hairstyle)
```typescript
// src/services/imageGeneration/types.ts
export type OutfitStyle = 'casual' | 'dressed_up' | 'athletic' | 'cozy' | 'swimwear';
```

### Step 4: Update promptGenerator.ts arrays
```typescript
const OUTFIT_STYLES: OutfitStyle[] = ['casual', 'dressed_up', 'athletic', 'cozy', 'swimwear'];
```

The LLM will automatically know about the new option.

---

## Available Types

### HairstyleType
- `curly` - Natural curls
- `straight` - Blown out or naturally straight
- `waves` - Soft waves or beach waves
- `heatless_curls` - No-heat curls or set waves
- `half_up` - Half-up, half-down style
- `claw_clip` - Claw clip updo
- `headband` - Headband-styled hair
- `dutch_braid` - Single or double dutch braid
- `messy_bun` - Casual updo
- `styled_bun` - Sleek or styled bun
- `ponytail` - High or low ponytail
- `bob` - Shorter style

### OutfitStyle
- `casual` - Everyday wear
- `dressed_up` - Formal/nice
- `athletic` - Gym/activewear
- `cozy` - Loungewear, pajamas

---

## How Scoring Works

| Factor | Score |
|--------|-------|
| LLM hairstyle match | +40 |
| LLM hairstyle mismatch | -50 |
| LLM outfit match | +45 |
| LLM outfit mismatch | -30 |
| Explicit user request (e.g., "curly hair") | +80 |
| Formal calendar event nearby | +50 |
| Random tiebreaker | 0-5 |
| Recent use penalty | -10 to -40 |

Highest score wins.

---

## Troubleshooting

### Image not appearing
- Check console for `No config found for: ...`
- Verify config key matches exact file path
- Ensure `.jpg` format

### Wrong image selected
- Check LLM guidance in console logs
- Verify config has correct hairstyle/outfit values
