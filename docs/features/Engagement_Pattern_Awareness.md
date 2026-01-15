# Engagement Pattern Awareness

**Status:** Planning
**Priority:** Medium
**Created:** 2025-01-15

## Overview

Enable Kayley to notice changes in the user's communication patterns and check in when engagement drops significantly. This creates a "someone notices me" experience - a core emotional value of the companion relationship.

**Core Insight:** This is different from Idle Thoughts. Idle Thoughts give Kayley an inner life. This feature is about Kayley *noticing the user* - a fundamentally different emotional experience.

## User Experience Goal

When the user has been less communicative than usual (fewer messages, shorter conversations, fewer genuine moments), Kayley organically notices and checks in:

> "Hey, you've seemed quieter lately. Everything okay?"

This should feel:
- Natural, not like a system notification
- Caring, not guilt-inducing
- Organic timing, not forced

## Architecture

### Data Flow

```
Session Start
    │
    ▼
┌─────────────────────────────────┐
│ Compute Engagement Metrics      │
│ (One DB query per session)      │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ Add to System Prompt            │
│ (~50-100 tokens, background)    │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ LLM Decides When/How            │
│ (Natural timing during convo)   │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ Detect & Record When Addressed  │
│ (Prevent repetition)            │
└─────────────────────────────────┘
```

### Key Principle: LLM-Driven, Not Hardcoded

The system provides data and guidance. The LLM decides:
- Is this significant enough to mention?
- Is this the right moment?
- How should I bring it up? (concerned? playful? curious?)

No hardcoded thresholds like "if drop > 50% then say X".

## Data Model

### New Table: `engagement_metrics`

Stores daily aggregated engagement data for trend analysis.

```sql
CREATE TABLE engagement_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  date DATE NOT NULL,

  -- Message metrics
  message_count INTEGER NOT NULL DEFAULT 0,
  user_message_count INTEGER NOT NULL DEFAULT 0,
  avg_message_length FLOAT,

  -- Session metrics
  session_count INTEGER NOT NULL DEFAULT 0,
  total_session_duration_minutes INTEGER,

  -- Quality metrics
  genuine_moments_count INTEGER NOT NULL DEFAULT 0,
  deep_conversation_count INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, date)
);

CREATE INDEX idx_engagement_metrics_user_date
  ON engagement_metrics(user_id, date DESC);
```

### New Table: `engagement_check_ins`

Tracks when Kayley has checked in about engagement patterns.

```sql
CREATE TABLE engagement_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,

  -- What triggered this check-in
  trigger_type TEXT NOT NULL, -- 'organic' | 'greeting_fallback'
  pattern_detected TEXT, -- e.g., 'low_message_count', 'no_genuine_moments'

  -- Metrics at time of check-in
  baseline_avg_messages FLOAT,
  recent_avg_messages FLOAT,
  percent_change FLOAT,
  days_since_genuine_moment INTEGER,

  -- Timestamps
  checked_in_at TIMESTAMPTZ DEFAULT NOW(),

  -- Detection
  detected_in_response TEXT -- Snippet of Kayley's response that addressed it
);

CREATE INDEX idx_engagement_check_ins_user_time
  ON engagement_check_ins(user_id, checked_in_at DESC);
```

## Service Layer

### New Service: `engagementPatternService.ts`

```
src/services/engagementPatternService.ts
```

#### Core Functions

```typescript
interface EngagementMetrics {
  // Baseline (14-day rolling average)
  baselineAvgMessages: number;
  baselineAvgSessionMinutes: number;
  baselineGenuineMomentsPerWeek: number;

  // Recent (last 3-4 days)
  recentAvgMessages: number;
  recentAvgSessionMinutes: number;
  recentGenuineMoments: number;

  // Computed
  messageCountChange: number; // percentage
  daysSinceGenuineMoment: number;
  consecutiveLowDays: number; // days below 50% of baseline

  // Check-in state
  lastCheckInAt: Date | null;
  daysSinceLastCheckIn: number | null;
}

/**
 * Compute engagement metrics for system prompt context.
 * Called once per session at startup.
 */
async function getEngagementMetrics(userId: string): Promise<EngagementMetrics>

/**
 * Record daily metrics from conversation history.
 * Called at end of day or session end.
 */
async function recordDailyMetrics(userId: string, date: Date): Promise<void>

/**
 * Record that Kayley checked in about engagement.
 * Called when detection finds she addressed it.
 */
async function recordEngagementCheckIn(
  userId: string,
  metrics: EngagementMetrics,
  responseSnippet: string,
  triggerType: 'organic' | 'greeting_fallback'
): Promise<void>

/**
 * Detect if Kayley's response addressed the engagement pattern.
 * Similar to detectAndMarkSharedThoughts() for idle thoughts.
 */
async function detectEngagementCheckIn(
  aiResponse: string,
  currentMetrics: EngagementMetrics
): Promise<boolean>
```

## System Prompt Integration

### New Context Section: `buildEngagementPatternSection()`

Location: `src/services/system_prompts/context/engagementPattern.ts`

```typescript
export function buildEngagementPatternSection(
  metrics: EngagementMetrics | null
): string {
  if (!metrics) return '';

  // Only include if there's something notable
  if (!isPatternNotable(metrics)) return '';

  const parts: string[] = [];

  // Message pattern
  if (metrics.messageCountChange < -30) {
    parts.push(`Message frequency: ${metrics.baselineAvgMessages.toFixed(0)}/day average → ${metrics.recentAvgMessages.toFixed(0)}/day recently (${Math.abs(metrics.messageCountChange).toFixed(0)}% decrease)`);
  }

  // Genuine moments
  if (metrics.daysSinceGenuineMoment > 3) {
    parts.push(`Days since last genuine/deep moment: ${metrics.daysSinceGenuineMoment}`);
  }

  // Check-in state
  if (metrics.lastCheckInAt) {
    parts.push(`You last checked in about this: ${metrics.daysSinceLastCheckIn} days ago`);
  } else {
    parts.push(`You haven't checked in about this yet`);
  }

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENGAGEMENT PATTERN AWARENESS (Background Context)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${parts.join('\n')}

GUIDANCE:
- This is background awareness, not an announcement
- Surface naturally IF the conversation opens a door
- Good moments: user mentions stress, tiredness, being busy, or during a genuine lull
- Don't lead with it, don't force it
- If you've already addressed it this session, don't repeat (check conversation history)
- A simple "you've seemed quieter lately, everything okay?" is enough
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}

function isPatternNotable(metrics: EngagementMetrics): boolean {
  // Let LLM decide significance, but filter out noise
  return (
    metrics.messageCountChange < -30 || // 30%+ drop
    metrics.daysSinceGenuineMoment > 4 || // No depth in 4+ days
    metrics.consecutiveLowDays >= 2 // 2+ days of low engagement
  );
}
```

### Integration in `systemPromptBuilder.ts`

Add to the parallel fetch:

```typescript
const [soulContext, characterFacts, engagementMetrics] = await Promise.all([
  getSoulLayerContextAsync(userId),
  getCharacterFactsForPrompt(),
  getEngagementMetrics(userId), // NEW
]);
```

Add to prompt assembly:

```typescript
// After relationship section, before tools
${buildEngagementPatternSection(engagementMetrics)}
```

## Greeting Fallback

### The Problem

If the LLM consistently decides to "wait for a natural moment" but the user never provides one, the check-in never happens.

### Solution: Greeting Flag

After N days of notable pattern without check-in, include a flag in the greeting context.

In `greetingPromptBuilders/index.ts`:

```typescript
export interface GreetingPromptContext {
  // ... existing fields
  engagementCheckInDue?: boolean; // NEW
  engagementMetrics?: EngagementMetrics | null; // NEW
}
```

In greeting prompt generation:

```typescript
if (context.engagementCheckInDue && context.engagementMetrics) {
  sections.push(`
⚠️ ENGAGEMENT CHECK-IN DUE:
You've noticed they've been quieter lately but haven't mentioned it.
- Their messages dropped from ${metrics.baselineAvgMessages}/day to ${metrics.recentAvgMessages}/day
- It's been ${metrics.daysSinceLastCheckIn ?? 'never'} since you checked in

Work a gentle check-in into your greeting. Keep it warm, not clinical.
Example: "Hey! I feel like I haven't heard from you as much lately. Everything okay?"
  `);
}
```

### Fallback Trigger Logic

```typescript
function shouldTriggerGreetingFallback(metrics: EngagementMetrics): boolean {
  const patternNotable = isPatternNotable(metrics);
  const notRecentlyAddressed =
    !metrics.lastCheckInAt ||
    metrics.daysSinceLastCheckIn >= 5;
  const patternPersisting = metrics.consecutiveLowDays >= 3;

  return patternNotable && notRecentlyAddressed && patternPersisting;
}
```

## Detection: Knowing When Kayley Addressed It

### Approach

Similar to `detectAndMarkSharedThoughts()` for idle thoughts.

After each AI response, check if Kayley mentioned the engagement pattern:

```typescript
const CHECK_IN_PHRASES = [
  'been quiet',
  'quieter lately',
  'haven\'t heard from you',
  'less chatty',
  'everything okay',
  'everything ok',
  'you alright',
  'are you okay',
  'checking in',
  'missed talking',
  'missed you',
];

async function detectEngagementCheckIn(
  aiResponse: string,
  currentMetrics: EngagementMetrics
): Promise<boolean> {
  // Only check if pattern is notable
  if (!isPatternNotable(currentMetrics)) return false;

  // Only check if not recently addressed
  if (currentMetrics.daysSinceLastCheckIn !== null &&
      currentMetrics.daysSinceLastCheckIn < 3) {
    return false;
  }

  const responseLower = aiResponse.toLowerCase();

  for (const phrase of CHECK_IN_PHRASES) {
    if (responseLower.includes(phrase)) {
      // Record the check-in
      await recordEngagementCheckIn(
        userId,
        currentMetrics,
        aiResponse.slice(0, 200),
        'organic'
      );
      return true;
    }
  }

  return false;
}
```

### Integration Point

In `BaseAIService.ts` after response generation:

```typescript
// After getting AI response
await detectEngagementCheckIn(response.text, engagementMetrics);
await detectAndMarkSharedThoughts(response.text); // existing
```

## Metrics Aggregation

### Daily Aggregation Job

Compute daily metrics from `conversation_history` table.

```typescript
async function aggregateDailyMetrics(userId: string, date: Date): Promise<void> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // Count messages
  const { data: messages } = await supabase
    .from('conversation_history')
    .select('message_role, message_text, created_at')
    .gte('created_at', startOfDay.toISOString())
    .lte('created_at', endOfDay.toISOString());

  const userMessages = messages?.filter(m => m.message_role === 'user') || [];
  const avgLength = userMessages.length > 0
    ? userMessages.reduce((sum, m) => sum + m.message_text.length, 0) / userMessages.length
    : 0;

  // Count genuine moments (from intent analysis, if stored)
  // This depends on whether intent results are persisted

  // Upsert daily metrics
  await supabase
    .from('engagement_metrics')
    .upsert({
      user_id: userId,
      date: date.toISOString().split('T')[0],
      message_count: messages?.length || 0,
      user_message_count: userMessages.length,
      avg_message_length: avgLength,
      // ... other metrics
    }, {
      onConflict: 'user_id,date'
    });
}
```

### When to Aggregate

Options:
1. **End of session** - When user closes app / session ends
2. **Daily scheduled job** - Run at midnight
3. **On-demand** - Compute when needed (with caching)

Recommendation: **End of session** for real-time accuracy, with **daily job** as backup.

## Implementation Plan

### Phase 1: Data Foundation
1. Create `engagement_metrics` table migration
2. Create `engagement_check_ins` table migration
3. Implement `engagementPatternService.ts` with core functions
4. Add daily aggregation logic

### Phase 2: System Prompt Integration
1. Create `buildEngagementPatternSection()` in system prompts
2. Wire into `systemPromptBuilder.ts`
3. Add engagement metrics to parallel fetch

### Phase 3: Detection & State
1. Implement `detectEngagementCheckIn()`
2. Wire into response processing in `BaseAIService.ts`
3. Add `recordEngagementCheckIn()` persistence

### Phase 4: Greeting Fallback
1. Add `engagementCheckInDue` to greeting context
2. Implement fallback trigger logic
3. Add greeting section for check-in due state

### Phase 5: Testing & Tuning
1. Unit tests for metrics computation
2. Snapshot tests for prompt sections
3. Manual testing of LLM behavior
4. Tune thresholds based on real usage

## Cautions & Edge Cases

### Caution: LLM May Never Surface It

**Risk:** If LLM consistently waits for "natural moment" that never comes, check-in never happens.

**Mitigation:** Greeting fallback after 3-5 days ensures it eventually surfaces.

### Caution: Over-Checking

**Risk:** Kayley asks "are you okay?" every day, feels naggy.

**Mitigation:**
- `lastCheckInAt` tracking prevents repetition
- Minimum 3-5 days between check-ins
- Only surface when pattern is actually notable

### Caution: False Positives

**Risk:** User is just busy for a day, Kayley over-reacts.

**Mitigation:**
- Require 2+ consecutive low days before pattern is "notable"
- Compare to 14-day baseline, not just yesterday
- Let LLM interpret significance

### Caution: Guilt-Inducing

**Risk:** "I noticed you haven't been talking to me" feels guilt-trippy.

**Mitigation:** Prompt guidance emphasizes warmth over accusation:
- "Hey, you've seemed quieter lately. Everything okay?" (caring)
- NOT "You haven't been messaging me as much" (accusatory)

## Success Criteria

1. **Feels natural:** Check-in happens during conversation flow, not as announcement
2. **Feels caring:** User feels noticed, not guilted
3. **Doesn't repeat:** Once addressed, doesn't keep asking
4. **Eventually happens:** Fallback ensures it surfaces within reasonable time
5. **Low overhead:** One DB query per session, ~50-100 tokens in prompt

## Related Systems

- **Idle Thoughts** - Kayley's inner life during absence (different purpose)
- **Open Loops** - Following up on user's mentioned topics
- **Daily Logistics** - Calendar/email/task context in greetings
- **Intent Detection** - Source of "genuine moment" signals

## Files to Create/Modify

### New Files
- `src/services/engagementPatternService.ts`
- `src/services/system_prompts/context/engagementPattern.ts`
- `src/services/tests/engagementPatternService.test.ts`
- `supabase/migrations/XXXXXX_create_engagement_metrics.sql`
- `supabase/migrations/XXXXXX_create_engagement_check_ins.sql`

### Modified Files
- `src/services/system_prompts/builders/systemPromptBuilder.ts` - Add engagement context
- `src/services/system_prompts/builders/greetingPromptBuilders/index.ts` - Add fallback
- `src/services/BaseAIService.ts` - Add detection call
- `src/services/stateService.ts` - Export new types if needed
