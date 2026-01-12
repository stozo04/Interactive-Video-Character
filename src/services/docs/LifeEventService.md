# Life Event Service

The `lifeEventService.ts` tracks recent events in Kayley's life that inform autonomous thought generation. These events provide context for the LLM when generating thoughts, making them feel grounded in her current life situation.

## Core Responsibilities

1. **Record Life Events**: Store events with description, category, and intensity
2. **Retrieve Recent Events**: Fetch last N events (typically 5) for thought generation context
3. **Simple API**: Two-function interface for recording and retrieving

## The Purpose

Autonomous thoughts need grounding in what's actually happening in Kayley's life. Without life events:
- Thoughts become abstract ("thinking about stuff")
- No progression or change over time
- Can't reference current projects or situations

With life events:
- Thoughts have specificity ("this video edit is fighting me")
- Life progresses naturally (project starts → progresses → completes)
- Conversations feel more authentic (user asks "how's that project going?")

## Tables Interaction

| Table Name | Action | Description |
| :--- | :--- | :--- |
| `life_events` | Read / Write | Stores events with description, category, intensity, timestamp |

### Schema

```sql
CREATE TABLE life_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  intensity NUMERIC(3, 2) NOT NULL CHECK (intensity >= 0 AND intensity <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_life_events_created_at ON life_events (created_at DESC);
```

**Fields:**
- `id` - Unique identifier
- `description` - Human-readable event description (e.g., "Started working on a new video editing project")
- `category` - Event category: `'personal'`, `'family'`, `'social'`, `'work'`
- `intensity` - How significant (0.0 = minor, 1.0 = life-changing)
- `created_at` - When event was recorded

## Workflow Interaction

```text
[Manual/Scheduled Event Recording]
         |
         V
[recordLifeEvent(description, category, intensity)]
         |
         V
[Insert into life_events table]
         |
         V
[Event stored with timestamp]


[Autonomous Thought Generation]
         |
         V
[ongoingThreads.buildThoughtContextBase()]
         |
         V
[getRecentLifeEvents(5)] -> Fetch last 5 events
         |
         V
[Pass to autonomousThoughtService]
         |
         V
[LLM uses events for context]
         |
         V
"this video edit is fighting me... trying to figure out the right pacing"
// ✓ References the "Started video project" life event
```

## Does it use an LLM?

**No.** This is a simple CRUD service. The LLM consumes these events in `autonomousThoughtService`, but this service just stores/retrieves them.

## API Reference

### `getRecentLifeEvents(limit: number = 5): Promise<LifeEvent[]>`

Retrieves the most recent life events, ordered by creation time (newest first).

**Parameters:**
- `limit` - Maximum number of events to return (default: 5)

**Returns:**
```typescript
LifeEvent[] = [
  {
    id: "uuid",
    description: "Started working on a new video editing project",
    category: "personal",
    intensity: 0.6,
    createdAt: Date
  },
  // ... up to `limit` events
]
```

**Error Handling:**
- Returns `[]` (empty array) on error
- Logs error but never throws
- Safe to call even if table doesn't exist

**Example:**
```typescript
const events = await getRecentLifeEvents(); // Get last 5
const manyEvents = await getRecentLifeEvents(10); // Get last 10
```

---

### `recordLifeEvent(description: string, category: string, intensity: number = 0.5): Promise<LifeEvent | null>`

Records a new life event.

**Parameters:**
- `description` - Human-readable event description
- `category` - Event category (should be `'personal' | 'family' | 'social' | 'work'`)
- `intensity` - Significance level (0.0 to 1.0, default: 0.5)

**Returns:**
- `LifeEvent` object if successful
- `null` if error occurred

**Error Handling:**
- Returns `null` on error (doesn't throw)
- Logs error for debugging
- Safe to call and ignore result

**Example:**
```typescript
// Record a significant event
await recordLifeEvent(
  "Had a breakthrough on my motion graphics technique",
  "personal",
  0.8 // High intensity
);

// Record a minor event
await recordLifeEvent(
  "Group chat has been extra active lately",
  "social",
  0.4 // Low intensity
);

// Use default intensity
await recordLifeEvent(
  "My mom called earlier",
  "family"
  // intensity defaults to 0.5
);
```

## Integration with Other Services

### Used By

- **`autonomousThoughtService.ts`** - Primary consumer
  - Calls `getRecentLifeEvents()` in prompt context
  - LLM uses events to ground thoughts in reality

- **`ongoingThreads.ts`** - Indirect consumer
  - Calls `getRecentLifeEvents()` in `buildThoughtContextBase()`
  - Passes to thought service

### Dependencies

- **`supabaseClient.ts`** - Database client for CRUD operations

## Event Categories

Events are grouped into 4 categories that align with autonomous thread themes:

| Category | Description | Thread Themes | Example Events |
|----------|-------------|---------------|----------------|
| **personal** | Creative projects, self-improvement, hobbies | `creative_project`, `self_improvement` | "Started learning motion graphics", "Organized my apartment" |
| **family** | Family interactions, calls, visits | `family` | "Had a good call with my mom", "Ethan sent me some memes" |
| **social** | Friend interactions, group chats, hangouts | `social` | "Lena and I had a deep conversation", "Group chat drama" |
| **work** | Client work, brand deals, professional activities | `work` | "Client project deadline approaching", "Brand deal came through" |

**Note:** No `existential` category - existential thoughts emerge naturally without specific events.

## Intensity Guidelines

| Intensity | Level | Examples |
|-----------|-------|----------|
| **0.2-0.3** | Minor | "Saw a good movie", "Had coffee with a friend" |
| **0.4-0.6** | Moderate | "Started a new project", "Family call went well" |
| **0.7-0.8** | Significant | "Had a breakthrough", "Big argument with friend" |
| **0.9-1.0** | Life-changing | "Got engaged", "Lost a loved one", "Career change" |

Use moderate intensity (0.5) as default unless event is clearly high/low impact.

## Seeding Life Events

The migration includes seed data for initial realism:

```sql
INSERT INTO life_events (description, category, intensity) VALUES
  ('Started working on a new video editing project', 'personal', 0.6),
  ('Had a good call with my mom', 'family', 0.5),
  ('Group chat has been extra active lately', 'social', 0.4);
```

These provide context even for new users before organic events accumulate.

## Event Lifecycle

### Creation
- **Manual**: Developer/admin records via `recordLifeEvent()`
- **Automated**: Future system could auto-generate based on:
  - Time-based triggers ("Working on video project for 2 weeks now")
  - Conversation analysis (user mentions Kayley's project)
  - External APIs (calendar events, social media)

### Storage
- Stored indefinitely in `life_events` table
- Indexed by `created_at` for fast recent queries

### Retrieval
- Only recent events retrieved (last 5 by default)
- Older events naturally fade from context

### Cleanup
- **Current**: No automatic cleanup (events accumulate)
- **Future Enhancement**: Auto-delete events >30 days old

## Common Patterns

### Pattern 1: Seeding Initial Events

```typescript
// After user signup or onboarding
await Promise.all([
  recordLifeEvent("Just finished setting up my new editing space", "personal", 0.6),
  recordLifeEvent("Been thinking about starting a podcast", "personal", 0.4),
  recordLifeEvent("My little sister starts college next week", "family", 0.7)
]);
```

### Pattern 2: Event-Driven Thoughts

```typescript
// Event recorded:
await recordLifeEvent(
  "Started learning motion graphics for work",
  "personal",
  0.8
);

// Later, autonomous thought generated:
{
  theme: "creative_project",
  content: "trying to wrap my head around motion graphics keyframes... it's frustrating but kinda fascinating",
  intensity: 0.7
}
// ✓ Thought directly references the life event
```

### Pattern 3: Conversation Continuity

```typescript
// User: "How's that video project going?"

// System fetches recent events:
const events = await getRecentLifeEvents();
// → "Started working on a new video editing project" (10 days ago)

// Kayley responds with continuity:
"honestly it's been a journey lol... i keep rethinking the intro but i think i'm finally getting somewhere with it"
```

## Performance Characteristics

### Costs

| Operation | Cost |
|-----------|------|
| `getRecentLifeEvents(5)` | Single SELECT query with LIMIT 5 |
| `recordLifeEvent()` | Single INSERT query |
| Database storage | Negligible (<1KB per event) |

### Latency

| Operation | Latency |
|-----------|---------|
| `getRecentLifeEvents()` | 10-50ms (indexed query) |
| `recordLifeEvent()` | 20-80ms (INSERT + RETURNING) |

**Note:** Events are fetched as part of parallel context assembly in `ongoingThreads`, so latency is hidden.

## Testing

See `src/services/tests/lifeEventService.test.ts` for:
- Event recording with validation
- Event retrieval with limits
- Error handling (database failures)
- Date filtering and ordering

## Troubleshooting

### Problem: Events not appearing in thoughts

**Symptom**: Generated thoughts ignore recent life events

**Causes**:
1. Events not actually stored (check `recordLifeEvent()` return value)
2. Events too old (only last 5 fetched)
3. Event descriptions too vague ("did some work")

**Fix**:
```typescript
// Verify storage
const event = await recordLifeEvent("desc", "personal", 0.5);
console.log("Stored event:", event); // Should not be null

// Add specific descriptions
await recordLifeEvent(
  "Spent 3 hours editing the intro sequence - still not happy with the pacing",
  "personal",
  0.6
);
// ✓ Specific enough for LLM to use
```

---

### Problem: Too many old events

**Symptom**: Events from months ago still being fetched

**Cause**: No automatic cleanup implemented

**Fix**: Manually clean old events
```sql
-- Delete events older than 30 days
DELETE FROM life_events
WHERE created_at < NOW() - INTERVAL '30 days';
```

**Future Enhancement**: Add automatic cleanup:
```typescript
export async function cleanupOldEvents(daysToKeep: number = 30): Promise<void> {
  const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  await supabase
    .from('life_events')
    .delete()
    .lt('created_at', cutoffDate.toISOString());
}
```

---

### Problem: Category validation

**Symptom**: Invalid categories stored (e.g., "misc", "other")

**Cause**: No TypeScript enforcement, no database constraint

**Fix 1**: Add to migration
```sql
ALTER TABLE life_events
ADD CONSTRAINT valid_category
CHECK (category IN ('personal', 'family', 'social', 'work'));
```

**Fix 2**: Add TypeScript type
```typescript
export type LifeEventCategory = 'personal' | 'family' | 'social' | 'work';

export async function recordLifeEvent(
  description: string,
  category: LifeEventCategory, // Type enforcement
  intensity: number = 0.5
): Promise<LifeEvent | null>
```

---

### Problem: Intensity out of bounds

**Symptom**: Intensity values like 1.5 or -0.2

**Cause**: Database constraint exists, but not enforced in TypeScript

**Current State**: ✅ Database already has constraint:
```sql
CHECK (intensity >= 0 AND intensity <= 1)
```

Database will reject invalid values. TypeScript can add client-side validation:
```typescript
export async function recordLifeEvent(
  description: string,
  category: string,
  intensity: number = 0.5
): Promise<LifeEvent | null> {
  // Clamp intensity
  const clampedIntensity = Math.min(1, Math.max(0, intensity));

  // ... rest of function
}
```

## Future Enhancements

### 1. Event Progression

Track events that evolve over time:

```typescript
interface LifeEventProgress {
  eventId: string;
  status: 'started' | 'in_progress' | 'completed' | 'abandoned';
  updates: string[];
}

// User: "how's that video project?"
// System knows: Started 10 days ago → in_progress → almost done
```

### 2. Event Clustering

Group related events:

```typescript
// Cluster: "Video Editing Project"
- "Started new video project" (10 days ago)
- "Spent 3 hours on intro" (7 days ago)
- "Finally got the pacing right" (2 days ago)

// Thought references cluster:
"been grinding on this video for like a week and a half but i think it's actually coming together now"
```

### 3. User-Visible Events

Allow users to see/edit Kayley's life events:

```tsx
<LifeEventTimeline>
  <Event date="Jan 8" category="personal" intensity={0.6}>
    Started working on a new video editing project
  </Event>
  <Event date="Jan 10" category="family" intensity={0.5}>
    Had a good call with my mom
  </Event>
</LifeEventTimeline>
```

### 4. External Integrations

Auto-generate events from:
- Calendar API ("Kayley has a client meeting tomorrow")
- Social media ("Kayley posted a new video")
- Analytics ("Kayley's video hit 10k views")

## Summary

The Life Event Service provides grounding for autonomous thoughts by tracking what's happening in Kayley's life. It's intentionally simple:
- **Two functions**: Record and retrieve
- **No LLM**: Pure CRUD operations
- **No complex logic**: Just storage and retrieval
- **Error resilient**: Never crashes, always returns safe defaults

The complexity lives in `autonomousThoughtService`, which uses these events to generate contextual, realistic thoughts.
