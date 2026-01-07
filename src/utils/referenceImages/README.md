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

**config.json specifies everything:**
```json
{
  "gym/curly_workout.jpg": {
    "id": "curly_athletic",
    "hairstyle": "curly",
    "outfit": "athletic"
  }
}
```

- **Folder structure is just for organization** - doesn't affect behavior
- **Config.json is the source of truth** for hairstyle + outfit
- **No code changes needed** to add new categories

---

## Adding a New Reference Image

### Step 1: Create the Image
- Put it in any folder you want (folder name doesn't matter)
- Use `.jpg` format

### Step 2: Add to config.json
```json
{
  "myFolder/my_new_image.jpg": {
    "id": "unique_id",
    "hairstyle": "curly",      // curly | straight | messy_bun | ponytail | bob
    "outfit": "athletic"        // casual | dressed_up | athletic | cozy
  }
}
```

### Step 3: Verify
Run dev server, check console:
```
[ReferenceImages] Loaded X reference images: [...]
```

---

## Adding a New Category (e.g., "swimwear")

### Step 1: Add to OutfitStyle type
```typescript
// src/services/imageGeneration/types.ts
export type OutfitStyle =
  | 'casual'
  | 'dressed_up'
  | 'athletic'
  | 'cozy'
  | 'swimwear';    // ← Add new type
```

### Step 2: Add images with new outfit
```json
{
  "beach/curly_swimsuit.jpg": {
    "id": "curly_swimwear",
    "hairstyle": "curly",
    "outfit": "swimwear"
  }
}
```

That's it! The LLM already knows to suggest outfit styles based on context.

---

## Available Types

### HairstyleType
- `curly` - Natural curls
- `straight` - Blown out or naturally straight
- `messy_bun` - Casual updo
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
