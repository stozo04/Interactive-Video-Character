# Spontaneity System

This module provides Kayley with spontaneous behaviors - making her feel alive by having her share things, make jokes, form associations, and surprise the user.

## Visual State Mapper

The Visual State Mapper (`visualStateMapper.ts`) bridges Kayley's internal emotional states to visual video manifests, ensuring visual consistency.

### Purpose

When Kayley says she's at a cafe, the UI should reflect that. When she's feeling vulnerable, her video and background should match her emotional state.

### Core Functions

#### `mapEmotionalStateToVideo()`

Maps an emotional state to a specific video manifest:

```typescript
const mapping = await mapEmotionalStateToVideo(
  'playful',     // emotionalState
  'high',        // energyLevel
  'happy',       // moodCategory
  'cafe'         // location (optional)
);

// Returns:
// {
//   idleVideoManifestId: 'idle_playful',
//   backgroundId: 'bg_cafe',  // Location override!
//   transitionStyle: 'quick',
//   ...
// }
```

#### `getVisualContext()`

Single entry point that takes the full character state and returns complete visual context:

```typescript
const visualContext = await getVisualContext({
  momentum: emotionalMomentum,
  moodState: moodState,
  presenceContext: presenceContext  // Contains location info
});

// Returns:
// {
//   videoManifestId: 'idle_playful',
//   backgroundId: 'bg_cafe',
//   transitionStyle: 'quick',
//   expressionHints: { ... }
// }
```

### Classification Logic

#### Emotional States (Priority Order)

1. **Vulnerable** - Active vulnerability exchange OR low mood with negative momentum
2. **Flirty** - Very high mood (>0.7) with strong positive momentum (>0.5)
3. **Playful** - High mood (>0.5) with positive streak (3+)
4. **Open** - Positive mood (>0)
5. **Guarded** - Default/neutral state

#### Energy Levels

- **Low**: Combined energy/social battery < 0.4
- **Medium**: 0.4 ≤ combined < 0.7
- **High**: combined ≥ 0.7

#### Mood Categories

- **Excited**: mood > 0.7
- **Happy**: mood > 0.3
- **Neutral**: mood > -0.3
- **Anxious**: mood > -0.6
- **Sad**: mood ≤ -0.6

### Location Overrides

The mapper automatically detects location mentions in active loops and overrides the background:

- `cafe`, `coffee shop` → `bg_cafe`
- `beach` → `bg_beach`
- `park` → `bg_park`
- `gym` → `bg_gym`
- `office`, `work` → `bg_office`
- `home`, `bedroom` → `bg_warm` (default)

### Database Integration

The mapper queries the `visual_state_mapping` table in Supabase for custom mappings. If no database mapping is found, it falls back to default in-memory mappings.

Default mappings are seeded in the migration file (`supabase/migrations/create_spontaneity_tables.sql`).

### Adding New Mappings

#### Option 1: Database (Recommended for Production)

```sql
INSERT INTO visual_state_mapping (
  emotional_state,
  energy_level,
  mood_category,
  idle_video_manifest_id,
  background_id,
  transition_style,
  location_context,  -- Optional
  priority           -- Higher = more specific
) VALUES (
  'excited',
  'high',
  'happy',
  'idle_bouncing',
  'bg_party',
  'dramatic',
  NULL,
  10
);
```

#### Option 2: Code (For Development/Fallback)

Add to `DEFAULT_MAPPINGS` array in `visualStateMapper.ts`:

```typescript
{
  emotionalState: 'excited',
  energyLevel: 'high',
  moodCategory: 'happy',
  idleVideoManifestId: 'idle_bouncing',
  backgroundId: 'bg_party',
  transitionStyle: 'dramatic',
  priority: 0,
}
```

### Testing

Run the comprehensive test suite:

```bash
npm test -- --run src/services/spontaneity/__tests__/visualStateMapper.test.ts
```

Tests cover:
- Energy level classification
- Emotional state classification (all 5 states)
- Mood category classification
- Location extraction from presence context
- Location background mapping
- Full state-to-visual pipeline
- Emotional state transitions
- Fuzzy matching and fallbacks

### Integration Example

```typescript
import { getVisualContext } from '@/services/spontaneity';

// During chat response processing...
const fullState = {
  momentum: await getEmotionalMomentum(userId),
  moodState: await getMoodState(userId),
  presenceContext: await getPresenceContext(userId)
};

const visual = await getVisualContext(fullState);

// Use visual.videoManifestId to select video
// Use visual.backgroundId to set UI background
// Use visual.transitionStyle for animations
```

### Design Principles

1. **Supabase is source of truth** - Database mappings take precedence
2. **Safe fallbacks** - Always returns valid visual context, never null
3. **Location-aware** - Extracts location from presence context automatically
4. **Emotion-first** - More specific states (flirty, vulnerable) checked before generic (open, guarded)
5. **Performance** - Single function call, minimal DB queries, in-memory fallbacks

### Future Enhancements

- Cache frequently-used mappings (30s TTL)
- Support for time-of-day backgrounds (morning/night)
- Weather-based visual adjustments
- Multi-location transitions (cafe → beach)
- Expression hint system for subtle facial variations
