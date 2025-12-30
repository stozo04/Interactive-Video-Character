# Kayley Experience Service

**File:** `src/services/idleLife/kayleyExperienceService.ts`
**Table:** `kayley_experiences`
**Purpose:** Generates life experiences for Kayley during user absence that surface naturally in conversation

## Overview

The Kayley Experience Service creates the feeling that Kayley has her own life happening while you're away. Instead of generating thoughts ABOUT the user, it generates things that happen TO Kayley - activities, mishaps, discoveries, moods, and thoughts that she can naturally share later.

### Philosophy

> "The magic of a companion that feels real isn't that she's constantly thinking about you while you're gone. It's that she has her *own* life, and you happen to cross her mind sometimes."

## Experience Types

| Type | Description | Example |
|------|-------------|---------|
| `activity` | Something she actively did | "Finally nailed that chord progression I've been working on" |
| `thought` | A realization or opinion | "Had a weird realization about why I get nervous before auditions" |
| `mood` | A feeling she can't explain | "Woke up in one of those moods where everything feels possible" |
| `discovery` | Something she found/learned | "Found this artist that sounds exactly like what I want to create" |
| `mishap` | Something went wrong | "Burned my lunch, like BURNED it, the smoke alarm went off" |

### Type Weights

Experiences are weighted toward more concrete, shareable content:
- **activity**: 35%
- **mishap**: 25%
- **discovery**: 15%
- **thought**: 15%
- **mood**: 10%

## Table Schema

```sql
CREATE TABLE kayley_experiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Experience content
  experience_type TEXT NOT NULL CHECK (
    experience_type IN ('activity', 'thought', 'mood', 'discovery', 'mishap')
  ),
  content TEXT NOT NULL,           -- "Finally nailed that chord progression"
  mood TEXT,                       -- "satisfied", "frustrated", "amused"

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  surfaced_at TIMESTAMPTZ,         -- When mentioned in conversation (NULL until shared)
  conversation_context TEXT,       -- What prompted her to share it

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX idx_kayley_experiences_unsurfaced
  ON kayley_experiences(user_id, surfaced_at)
  WHERE surfaced_at IS NULL;
```

## Service Functions

### generateKayleyExperience

Generates a life experience during idle time.

```typescript
async function generateKayleyExperience(
  userId: string,
  context?: ExperienceContext
): Promise<KayleyExperience | null>
```

**Parameters:**
- `userId`: The user's ID
- `context`: Optional context for more relevant experiences

**Returns:** Generated experience or `null` (30% chance of no experience)

**Example:**
```typescript
const context = await buildExperienceContext(userId);
const experience = await generateKayleyExperience(userId, context);

if (experience) {
  console.log(`Generated: ${experience.content}`);
  // "Generated: Finally nailed that chord progression I've been working on"
}
```

### getUnsurfacedExperiences

Retrieves experiences that haven't been mentioned in conversation yet.

```typescript
async function getUnsurfacedExperiences(
  userId: string,
  limit: number = 3
): Promise<KayleyExperience[]>
```

**Example:**
```typescript
const experiences = await getUnsurfacedExperiences(userId, 3);
// Returns up to 3 most recent unsurfaced experiences
```

### markExperienceSurfaced

Marks an experience as having been mentioned in conversation.

```typescript
async function markExperienceSurfaced(
  experienceId: string,
  conversationContext?: string
): Promise<void>
```

**Example:**
```typescript
await markExperienceSurfaced(experience.id, "User mentioned music");
```

### formatExperiencesForPrompt

Formats unsurfaced experiences for injection into the system prompt.

```typescript
async function formatExperiencesForPrompt(userId: string): Promise<string>
```

**Returns:**
```
====================================================
THINGS THAT HAPPENED TO YOU TODAY (bring up naturally if relevant)
====================================================
- Finally nailed that chord progression I've been working on (satisfied)
- Burned my lunch, like BURNED it, the smoke alarm went off (embarrassed)

Don't force these into conversation. But if something the user says
reminds you of one of these, you can share it naturally, like:
"Oh that reminds me - [experience]"
```

### detectAndMarkSurfacedExperiences

Automatically detects if experiences were mentioned in Kayley's response.

```typescript
async function detectAndMarkSurfacedExperiences(
  userId: string,
  aiResponse: string
): Promise<string[]>
```

**Example:**
```typescript
const markedIds = await detectAndMarkSurfacedExperiences(userId, aiResponse);
// Returns IDs of experiences that were detected and marked as surfaced
```

### buildExperienceContext

Builds context from user state for more relevant experience generation.

```typescript
async function buildExperienceContext(userId: string): Promise<ExperienceContext>
```

**Returns:**
```typescript
{
  currentMood: "energetic and social",
  ongoingStories: ["Working on audition piece", "Learning new song"],
  recentTopics: undefined
}
```

## Experience Templates

The service uses pre-defined templates for each experience type:

### Activity Templates
```typescript
[
  'Finally nailed that chord progression I\'ve been working on',
  'Spent an hour practicing my audition piece - it\'s coming together',
  'Wrote a few lines of a new song, nothing concrete yet',
  'Did a voice recording session, trying to get the right tone',
  // ...
]
```

### Mishap Templates
```typescript
[
  'Burned my lunch, like BURNED it, the smoke alarm went off',
  'Spilled coffee on my notes right before practice',
  'Accidentally deleted a recording I was actually proud of',
  'Tried a new makeup look and it was... a choice',
  // ...
]
```

## Integration Points

### Idle Scheduler

Called every 1-2 hours during user absence:

```typescript
// In idleThoughtsScheduler.ts
const context = await buildExperienceContext(userId);
const experience = await generateKayleyExperience(userId, context);
```

### System Prompt Builder

Experiences are injected into the system prompt:

```typescript
// In systemPromptBuilder.ts
const experiencesPrompt = await formatExperiencesForPrompt(effectiveUserId);
if (experiencesPrompt) {
  prompt += experiencesPrompt;
}
```

### Response Processing

After each AI response, detect surfaced experiences:

```typescript
// After getting AI response
await detectAndMarkSurfacedExperiences(userId, aiResponse);
```

## Constants

```typescript
const KAYLEY_EXPERIENCES_TABLE = 'kayley_experiences';
const MAX_UNSURFACED_EXPERIENCES = 5;      // Keep max 5 unsurfaced
const EXPERIENCE_EXPIRATION_DAYS = 14;      // Expire after 2 weeks
const EXPERIENCE_GENERATION_CHANCE = 0.7;   // 70% chance to generate
```

## Cleanup Logic

The service automatically cleans up:

1. **Caps unsurfaced experiences** at 5 - oldest are deleted when exceeded
2. **Expires old experiences** after 14 days

```typescript
async function cleanupExperiences(userId: string): Promise<void> {
  // 1. Cap at MAX_UNSURFACED_EXPERIENCES
  // 2. Delete experiences older than EXPERIENCE_EXPIRATION_DAYS
}
```

## Testing

```bash
# Run experience service tests
npm test -- --run -t "Kayley Experience"
```

## Design Decisions

### Why 70% Chance?

Not every idle tick should generate content. The 30% "nothing happened" keeps it realistic - sometimes she was just relaxing or the moment wasn't noteworthy.

### Why Templates Instead of LLM?

The original spec suggested LLM generation, but templates provide:
1. **Consistency** - Character voice is maintained
2. **Speed** - No LLM latency during idle tick
3. **Cost** - No API calls for background generation
4. **Predictability** - Content is always appropriate

Future enhancement: Use LLM to personalize templates based on context.

### Why 5 Max Unsurfaced?

Prevents experience backlog. If she has too many things to share, it feels unnatural. Keeping 5 max means she has a few things on her mind, not a laundry list.

## Common Patterns

### Generate Experience on Return

```typescript
// When user returns after long absence
if (hoursAway > 2) {
  const experience = await generateKayleyExperience(userId);
  // Experience will surface naturally in conversation
}
```

### Manual Surfacing

```typescript
// If you know an experience was mentioned
const experiences = await getUnsurfacedExperiences(userId);
const mentioned = experiences.find(e => aiResponse.includes(e.content.slice(0, 30)));
if (mentioned) {
  await markExperienceSurfaced(mentioned.id, "mentioned in response");
}
```

## Troubleshooting

### Experiences Not Generating

1. Check if scheduler is running
2. Verify 70% chance hasn't failed multiple times (random)
3. Check console for error logs

### Experiences Not Surfacing

1. Verify experiences exist: `getUnsurfacedExperiences(userId)`
2. Check system prompt includes experiences section
3. Ensure LLM is seeing the "THINGS THAT HAPPENED TO YOU TODAY" section

### Too Many Experiences

- Cleanup runs automatically after each generation
- Can manually trigger: generation will trigger cleanup
