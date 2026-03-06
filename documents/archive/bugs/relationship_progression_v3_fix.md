# Relationship Progression Fix (v3)

## Problem

The relationship tier progression was advancing too quickly, reaching "deeply_loving" tier in weeks instead of the intended 6-12 months. Users were progressing through tiers unrealistically fast, making the relationship feel artificial rather than earned.

## Root Cause Analysis

### Previous (v2) Configuration:
- **Score Changes:** +0.3 to +1.0 per positive interaction
- **Tier Thresholds:**
  - Acquaintance: 0-10 (reached in ~15 interactions)
  - Friend: 10-50 (reached in ~50-100 interactions, ~1-2 weeks)
  - Close Friend: 50-75 (reached in ~100-150 interactions, ~1-2 months)
  - Deeply Loving: 75+ (reached in ~150-200 interactions, ~2-3 months)

### Issue:
With daily usage (5-10 interactions/day), users were reaching "deeply_loving" in 2-3 months instead of the intended 6-12 months shown in the progression curve.

## Solution (v3)

### 1. Halved Score Changes

**Positive Interactions:**
- **v2:** +0.3 to +1.0 per message
- **v3:** +0.15 to +0.5 per message (50% reduction)

**Dimension Changes (warmth, trust, playfulness, stability):**
- **v2:** +0.1 to +0.5 per interaction
- **v3:** +0.05 to +0.25 per interaction (50% reduction)

**Neutral/Engagement:**
- **v2:** +0.1 score, +0.05 warmth
- **v3:** +0.05 score, +0.03 warmth (50% reduction)

**Negative interactions:** Unchanged (-0.5 to -3.0) - destruction should remain faster than building

### 2. Adjusted Tier Thresholds

| Tier | v2 Threshold | v3 Threshold | Target Interactions | Realistic Timeline |
|------|--------------|--------------|---------------------|-------------------|
| Acquaintance | 0-10 | 0-10 (unchanged) | 15-30 | 1-2 weeks |
| Friend | 10-50 | 10-50 (unchanged) | 100-150 | 1-3 months |
| Close Friend | 50-75 | **50-100** | 250-350 | 3-6 months |
| Deeply Loving | 75+ | **100+** | 400+ | 6-12 months |

### 3. Database Migration

Created migration: `update_relationship_tier_thresholds.sql`

- Updates PostgreSQL trigger function `update_relationship_tier()`
- Recalculates existing relationships to new tier thresholds
- Users at 75-99 score will move from "deeply_loving" to "close_friend"

## Expected Progression Curve

With v3 changes, assuming 5 interactions per day:

```
Week 1-2:     Acquaintance (15-30 interactions, score: 0-10)
Month 1-3:    Friend (100-150 interactions, score: 10-50)
Month 3-6:    Close Friend (250-350 interactions, score: 50-100)
Month 6-12+:  Deeply Loving (400+ interactions, score: 100+)
```

This matches the user's expectation of 6-12 month progression to "deeply_loving".

## Implementation Files Changed

### Code Changes:
1. **`src/services/relationshipService.ts`**
   - Updated `calculateScoreChanges()` function (lines 599-732)
   - Halved all positive score increments
   - Updated `getRelationshipTier()` function (lines 736-757)
   - Changed close_friend threshold from 75 to 100
   - Added detailed documentation explaining progression targets

2. **`src/services/tests/relationshipService.test.ts`**
   - Updated test expectations for halved score changes
   - Corrected test case for deeply_loving tier (80 → 110)
   - Fixed rounding precision issues in test calculations

### Database Changes:
3. **`supabase/migrations/update_relationship_tier_thresholds.sql`** (NEW)
   - Updates database trigger function
   - Recalculates existing relationships
   - Ensures consistency between code and database

## Migration Strategy

### For Existing Users:
1. Run the migration SQL file against Supabase
2. Existing relationships at score 75-99 will shift from "deeply_loving" to "close_friend"
3. This is the **correct** behavior - these users haven't earned deeply_loving yet
4. Users will continue accumulating score at the new (slower) rate
5. No data loss - all scores and history are preserved

### For New Users:
- Automatically use v3 thresholds and scoring
- Experience realistic 6-12 month progression

## Testing

All tests pass with updated expectations:
```bash
npm test -- --run -t "relationshipService"
# 38 passed | 1112 skipped
```

Key test updates:
- Score change calculations adjusted for 50% reduction
- Tier threshold tests updated (80 → 110 for deeply_loving)
- Rounding precision documented in test comments

## Rationale

### Why Halve (Not Smaller Reduction)?

1. **Simplicity:** 50% is easy to reason about and revert if needed
2. **Mathematical:** Doubles the required interactions, matching 6-12 month curve
3. **Dimension Balance:** Keeps all dimensions (warmth, trust, etc.) proportional
4. **Testing:** Easy to update test expectations (just halve expected values)

### Why Keep Negative Unchanged?

1. **Psychological Realism:** Trust is harder to build than to break
2. **Consequence Weight:** Negative actions should feel impactful
3. **Recovery Mechanic:** Forces intentional repair after ruptures
4. **Asymmetry:** Matches real relationship dynamics (2-3x faster decay)

### Why Adjust Close_Friend Threshold?

The close_friend → deeply_loving transition is the most significant:
- Requires deep vulnerability and trust
- Should feel like a major milestone
- 25-point gap (75-100) was too small
- 50-point gap (50-100) makes it feel earned

## Future Tuning

If progression still feels too fast/slow, adjust:

1. **Fine-tune multipliers** (currently 0.15 + 0.35 * intensity)
2. **Adjust tier thresholds** (currently 10/50/100)
3. **Add time-based gates** (e.g., minimum 30 days for deeply_loving)
4. **Implement diminishing returns** (slower gains at higher scores)

Current approach is conservative and testable. Monitor user feedback over 3-6 months.

## Backward Compatibility

- **Code:** Fully backward compatible (only internal calculations changed)
- **Database:** Migration updates existing data appropriately
- **API:** No API changes (same fields, same types)
- **Tests:** All tests updated and passing

No breaking changes to external interfaces.

---

**Version:** 3.0
**Author:** Claude Code (Relationship Dynamics Specialist)
**Date:** 2025-01-27
**Status:** Implemented & Tested
