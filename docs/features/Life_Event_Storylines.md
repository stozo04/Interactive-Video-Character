# Life Event Storylines

**Status:** Planning
**Priority:** High
**Created:** 2025-01-15

## The Problem

Life events currently feel like **announcements**, not **experiences**. Kayley says "A brand reached out about a partnership!" with genuine excitement, but then... nothing. The partnership never progresses, never resolves, never affects her mood, never comes up again.

**Real life doesn't work this way.**

When something significant happens to a person:
- They think about it for days/weeks
- They have good days and bad days with it
- They share updates without being asked
- It affects their mood and energy
- It eventually resolves (success, failure, or abandonment)
- They reflect on what it meant
- They reference it later as part of their history

## The Vision

Transform life events from point-in-time announcements into **living storylines** that:

1. **Progress naturally** through phases
2. **Affect Kayley's mood** based on how the project is going
3. **Surface organically** in conversation
4. **Resolve meaningfully** with emotional closure
5. **Become part of her history** that she can reference later

### Example: Brand Partnership Storyline

**Day 1 - Announcement:**
> "Steven!! A brand I absolutely adore just reached out about a year-long partnership... I'm literally shaking!"

**Day 3 - Honeymoon:**
> "I keep thinking about that brand deal. Like, is this actually happening to me?"

**Day 7 - Reality:**
> "Okay so the contract came through and there's... a lot. They want 3 posts a week and I'm not sure I can do that without burning out."

**Day 10 - Struggle:**
> "I've been going back and forth with the brand. They're being kind of difficult about the creative control thing. It's stressing me out ngl."

**Day 14 - Progress:**
> "Update on the brand thing - we found a compromise! 2 posts a week and I keep final say on aesthetics. Feeling better about it."

**Day 20 - Resolution (Success):**
> "I SIGNED IT. The partnership is official!! I'm so relieved and excited and terrified all at once lol"

**Day 25 - Reflection:**
> "It's weird, now that the brand deal is signed I feel this... calm? Like I actually did the thing. Still processing."

**Months Later - Legacy:**
> "Remember when I was freaking out about that brand partnership? Wild that it's been 3 months already."

---

## Data Model

### Enhanced Life Event Schema

```sql
-- Enhanced life_events table (or new life_storylines table)
CREATE TABLE life_storylines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core identity
  title TEXT NOT NULL,                    -- "Brand Partnership with [Brand]"
  category TEXT NOT NULL,                 -- 'work', 'personal', 'family', 'social', 'creative'
  storyline_type TEXT NOT NULL,           -- 'project', 'opportunity', 'challenge', 'relationship', 'goal'

  -- Current state
  phase TEXT NOT NULL DEFAULT 'announced',
  phase_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Emotional texture
  current_emotional_tone TEXT,            -- 'excited', 'anxious', 'stressed', 'hopeful', 'frustrated'
  emotional_intensity FLOAT DEFAULT 0.7,  -- 0-1, how much this is affecting her

  -- Outcome tracking
  outcome TEXT,                           -- 'success', 'failure', 'abandoned', 'transformed', NULL if ongoing
  outcome_description TEXT,               -- "Signed the deal!" or "Had to walk away"
  resolution_emotion TEXT,                -- How she feels about the resolution

  -- Mention tracking
  times_mentioned INTEGER DEFAULT 0,
  last_mentioned_at TIMESTAMPTZ,
  should_mention_by TIMESTAMPTZ,          -- Soft deadline for next organic mention

  -- Lifecycle
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,

  -- Metadata
  initial_announcement TEXT,              -- What she first said about it
  stakes TEXT,                            -- Why this matters to her
  user_involvement TEXT                   -- How user has been involved/supportive
);

-- Progress updates for each storyline
CREATE TABLE storyline_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storyline_id UUID REFERENCES life_storylines(id) ON DELETE CASCADE,

  -- Update content
  update_type TEXT NOT NULL,              -- 'progress', 'setback', 'milestone', 'reflection', 'mood_shift'
  content TEXT NOT NULL,                  -- "Contract negotiations are getting complicated"
  emotional_tone TEXT,                    -- How she feels about this update

  -- Tracking
  mentioned BOOLEAN DEFAULT FALSE,
  mentioned_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_storylines_active ON life_storylines(phase) WHERE outcome IS NULL;
CREATE INDEX idx_storylines_mention ON life_storylines(should_mention_by) WHERE outcome IS NULL;
CREATE INDEX idx_updates_unmentioned ON storyline_updates(storyline_id, mentioned) WHERE mentioned = FALSE;
```

### Phase Definitions

```typescript
type StorylinePhase =
  | 'announced'      // Just happened, initial excitement/shock
  | 'honeymoon'      // Early enthusiasm, everything feels possible
  | 'reality'        // Challenges become apparent
  | 'active'         // In the thick of it, working through
  | 'climax'         // Critical moment, decision point
  | 'resolving'      // Outcome is clear, processing emotions
  | 'resolved'       // Complete, moved to history
  | 'reflecting';    // Looking back (periodic, after resolved)

type StorylineOutcome =
  | 'success'        // Achieved the goal
  | 'failure'        // Didn't work out
  | 'abandoned'      // Chose to stop pursuing
  | 'transformed'    // Became something different
  | 'ongoing';       // Still active (for long-term storylines)
```

---

## Phase Progression

### Automatic Phase Transitions

Phases progress based on **time** and **events**, not just random chance.

```typescript
interface PhaseTransition {
  from: StorylinePhase;
  to: StorylinePhase;
  minDays: number;        // Minimum days before transition possible
  maxDays: number;        // Maximum days before transition forced
  probability: number;    // Daily probability after minDays
  triggers?: string[];    // Events that can force transition
}

const PHASE_TRANSITIONS: PhaseTransition[] = [
  // Announcement → Honeymoon (quick, 1-3 days)
  {
    from: 'announced',
    to: 'honeymoon',
    minDays: 1,
    maxDays: 3,
    probability: 0.5,
  },

  // Honeymoon → Reality (3-7 days, challenges emerge)
  {
    from: 'honeymoon',
    to: 'reality',
    minDays: 3,
    maxDays: 7,
    probability: 0.3,
  },

  // Reality → Active (2-5 days, start working through)
  {
    from: 'reality',
    to: 'active',
    minDays: 2,
    maxDays: 5,
    probability: 0.4,
  },

  // Active → Climax (7-21 days, reaching decision point)
  {
    from: 'active',
    to: 'climax',
    minDays: 7,
    maxDays: 21,
    probability: 0.15,
  },

  // Climax → Resolving (1-3 days, outcome becomes clear)
  {
    from: 'climax',
    to: 'resolving',
    minDays: 1,
    maxDays: 3,
    probability: 0.6,
  },

  // Resolving → Resolved (2-5 days, emotional processing)
  {
    from: 'resolving',
    to: 'resolved',
    minDays: 2,
    maxDays: 5,
    probability: 0.5,
  },
];
```

### Phase-Specific Behavior

Each phase has distinct characteristics:

```typescript
interface PhaseBehavior {
  phase: StorylinePhase;
  emotionalRange: string[];           // Possible emotions in this phase
  mentionFrequency: 'high' | 'medium' | 'low';
  moodImpact: number;                 // How much it affects overall mood (-1 to 1)
  promptGuidance: string;             // How Kayley should talk about it
  updateTypes: string[];              // Types of updates that can occur
}

const PHASE_BEHAVIORS: PhaseBehavior[] = [
  {
    phase: 'announced',
    emotionalRange: ['excited', 'shocked', 'nervous', 'thrilled', 'disbelieving'],
    mentionFrequency: 'high',
    moodImpact: 0.3,
    promptGuidance: `This JUST happened. You're still processing. Share the news with genuine emotion - excitement, nervousness, disbelief. You want to talk about it.`,
    updateTypes: ['initial_reaction', 'processing'],
  },
  {
    phase: 'honeymoon',
    emotionalRange: ['optimistic', 'dreamy', 'hopeful', 'giddy'],
    mentionFrequency: 'medium',
    moodImpact: 0.4,
    promptGuidance: `You're in the excited early phase. Everything feels possible. You might daydream about outcomes or share hopeful thoughts. The challenges haven't hit yet.`,
    updateTypes: ['daydreaming', 'planning', 'anticipation'],
  },
  {
    phase: 'reality',
    emotionalRange: ['anxious', 'overwhelmed', 'uncertain', 'stressed', 'determined'],
    mentionFrequency: 'medium',
    moodImpact: -0.2,
    promptGuidance: `The rose-colored glasses are off. You're seeing the challenges. You might vent about complications or express doubt. This is normal and human.`,
    updateTypes: ['challenge', 'complication', 'doubt', 'realization'],
  },
  {
    phase: 'active',
    emotionalRange: ['focused', 'tired', 'frustrated', 'hopeful', 'determined', 'stressed'],
    mentionFrequency: 'low',
    moodImpact: 0,  // Fluctuates based on updates
    promptGuidance: `You're in the work phase. Some days are good, some are hard. Share progress or frustrations naturally. This affects your energy level.`,
    updateTypes: ['progress', 'setback', 'milestone', 'mood_shift', 'realization'],
  },
  {
    phase: 'climax',
    emotionalRange: ['anxious', 'hopeful', 'terrified', 'determined', 'on_edge'],
    mentionFrequency: 'high',
    moodImpact: -0.3,
    promptGuidance: `Critical moment. Big decision coming or happening. You're thinking about this A LOT. It's affecting your focus and mood significantly.`,
    updateTypes: ['decision_point', 'final_push', 'moment_of_truth'],
  },
  {
    phase: 'resolving',
    emotionalRange: ['relieved', 'disappointed', 'processing', 'numb', 'bittersweet'],
    mentionFrequency: 'high',
    moodImpact: 0.2,  // Relief regardless of outcome
    promptGuidance: `The outcome is clear. You're processing emotions. Share what happened and how you feel. You need to talk about it to process.`,
    updateTypes: ['outcome_reaction', 'emotional_processing', 'meaning_making'],
  },
  {
    phase: 'resolved',
    emotionalRange: ['peaceful', 'proud', 'sad', 'grateful', 'wistful', 'content'],
    mentionFrequency: 'low',
    moodImpact: 0.1,
    promptGuidance: `It's over. You've processed the main emotions. You can reference it as something that happened, with perspective.`,
    updateTypes: ['reflection', 'lesson_learned', 'gratitude'],
  },
  {
    phase: 'reflecting',
    emotionalRange: ['nostalgic', 'grateful', 'proud', 'wistful', 'amused'],
    mentionFrequency: 'very_low',
    moodImpact: 0,
    promptGuidance: `Looking back months later. Reference this as part of your history. "Remember when..." moments.`,
    updateTypes: ['anniversary', 'callback', 'comparison'],
  },
];
```

---

## Emotional Texture

### Mood Integration

Storylines should affect Kayley's overall mood:

```typescript
interface StorylineMoodEffect {
  storylineId: string;
  phase: StorylinePhase;
  currentEmotion: string;
  moodDelta: number;        // -1 to 1
  energyDelta: number;      // -1 to 1
  preoccupation: number;    // 0 to 1, how much mental space this takes
}

/**
 * Calculate mood effects from active storylines.
 * Called during mood state computation.
 */
async function getStorylineMoodEffects(userId: string): Promise<StorylineMoodEffect[]> {
  const activeStorylines = await getActiveStorylines(userId);

  return activeStorylines.map(storyline => {
    const phaseBehavior = PHASE_BEHAVIORS.find(p => p.phase === storyline.phase);

    // Mood impact varies by phase and emotional intensity
    const baseMoodDelta = phaseBehavior?.moodImpact || 0;
    const intensityMultiplier = storyline.emotionalIntensity;

    // Energy drain in stressful phases
    const energyDelta = ['reality', 'active', 'climax'].includes(storyline.phase)
      ? -0.1 * intensityMultiplier
      : 0;

    // Preoccupation (how much mental space it takes)
    const preoccupationByPhase: Record<StorylinePhase, number> = {
      announced: 0.8,
      honeymoon: 0.5,
      reality: 0.6,
      active: 0.4,
      climax: 0.9,
      resolving: 0.7,
      resolved: 0.2,
      reflecting: 0.1,
    };

    return {
      storylineId: storyline.id,
      phase: storyline.phase,
      currentEmotion: storyline.currentEmotionalTone,
      moodDelta: baseMoodDelta * intensityMultiplier,
      energyDelta,
      preoccupation: preoccupationByPhase[storyline.phase] * intensityMultiplier,
    };
  });
}
```

### Emotional Progression Within Phases

Not every day is the same within a phase. Generate daily emotional variations:

```typescript
interface DailyEmotionalState {
  emotion: string;
  intensity: number;
  thought?: string;         // Optional thought about the storyline
  mentionLikelihood: number;
}

/**
 * Generate today's emotional state for a storyline.
 * Creates natural variation - good days and bad days.
 */
function generateDailyEmotionalState(
  storyline: LifeStoryline,
  phaseBehavior: PhaseBehavior
): DailyEmotionalState {
  // Random emotion from phase's emotional range
  const emotion = phaseBehavior.emotionalRange[
    Math.floor(Math.random() * phaseBehavior.emotionalRange.length)
  ];

  // Intensity varies day to day (0.3 to 1.0)
  const baseIntensity = storyline.emotionalIntensity;
  const dailyVariation = 0.3 + Math.random() * 0.7;
  const intensity = baseIntensity * dailyVariation;

  // Mention likelihood based on intensity and phase
  const frequencyMultiplier = {
    high: 0.7,
    medium: 0.4,
    low: 0.2,
    very_low: 0.05,
  }[phaseBehavior.mentionFrequency];

  const mentionLikelihood = intensity * frequencyMultiplier;

  return {
    emotion,
    intensity,
    mentionLikelihood,
  };
}
```

---

## Update Generation

### Types of Updates

```typescript
type UpdateType =
  | 'progress'          // "Made headway on the brand deal"
  | 'setback'           // "Hit a snag with contract terms"
  | 'milestone'         // "Got verbal confirmation!"
  | 'mood_shift'        // "Feeling more confident about it today"
  | 'realization'       // "I realized this is bigger than I thought"
  | 'decision_point'    // "I have to decide by Friday"
  | 'doubt'             // "Starting to wonder if this is right for me"
  | 'external_factor'   // "The brand changed their timeline"
  | 'support_received'  // "My manager is backing me up"
  | 'comparison'        // "This is nothing like the last deal I did"
  | 'reflection';       // "Looking back, I'm glad I pushed through"

interface StorylineUpdate {
  id: string;
  storylineId: string;
  updateType: UpdateType;
  content: string;
  emotionalTone: string;
  mentioned: boolean;
  mentionedAt?: Date;
  createdAt: Date;
}
```

### LLM-Generated Updates

Updates should be generated by LLM for variety and authenticity:

```typescript
const UPDATE_GENERATION_PROMPT = `You are generating a storyline update for Kayley's life.

STORYLINE:
Title: {title}
Category: {category}
Current Phase: {phase}
Days in Phase: {daysInPhase}
Current Emotion: {currentEmotion}
Previous Updates: {previousUpdates}
Stakes: {stakes}

PHASE CONTEXT:
{phaseGuidance}

Generate a realistic update that:
1. Fits the current phase naturally
2. Adds depth or new information
3. Feels like genuine life progression
4. Has emotional authenticity
5. Isn't too dramatic (life is often mundane)

Respond with JSON:
{
  "updateType": "progress" | "setback" | "milestone" | "mood_shift" | "realization" | "doubt",
  "content": "The actual update in Kayley's voice (first person, casual)",
  "emotionalTone": "one word emotion",
  "shouldTransitionPhase": true/false,
  "newPhase": "only if shouldTransitionPhase is true"
}`;
```

### Update Scheduling

```typescript
/**
 * Determine if a storyline should generate an update today.
 */
function shouldGenerateUpdate(storyline: LifeStoryline): boolean {
  const daysSinceLastUpdate = storyline.lastUpdateAt
    ? daysBetween(storyline.lastUpdateAt, new Date())
    : daysBetween(storyline.createdAt, new Date());

  const phaseBehavior = PHASE_BEHAVIORS.find(p => p.phase === storyline.phase);

  // Update frequency by phase
  const updateIntervalDays = {
    announced: 1,       // Daily updates when fresh
    honeymoon: 2,       // Every couple days
    reality: 2,         // Regular as challenges emerge
    active: 3,          // Less frequent, ongoing work
    climax: 1,          // Daily, high stakes
    resolving: 1,       // Processing needs expression
    resolved: 7,        // Weekly reflections
    reflecting: 30,     // Monthly callbacks
  }[storyline.phase];

  if (daysSinceLastUpdate < updateIntervalDays) {
    return false;
  }

  // Probability increases as we exceed interval
  const overdueDays = daysSinceLastUpdate - updateIntervalDays;
  const probability = Math.min(0.9, 0.3 + (overdueDays * 0.2));

  return Math.random() < probability;
}
```

---

## Closure & Resolution

### Why Closure Matters

Without closure:
- Storylines feel abandoned
- Kayley seems forgetful or scattered
- User never gets payoff for emotional investment
- Her history feels incomplete

### Resolution Types

```typescript
interface StorylineResolution {
  outcome: 'success' | 'failure' | 'abandoned' | 'transformed';
  description: string;           // What happened
  emotionalResponse: string;     // How Kayley feels
  lessonsLearned?: string;       // What she took from it
  gratitudeToUser?: string;      // How user helped (if applicable)
}

const RESOLUTION_TEMPLATES = {
  success: {
    emotions: ['thrilled', 'relieved', 'proud', 'grateful', 'surreal'],
    promptGuidance: `You did it! Let yourself celebrate. Share the win genuinely. Thank people who supported you. It's okay to be proud.`,
    closureSteps: [
      'announcement',        // "I DID IT!"
      'gratitude',           // Thank user if they helped
      'reflection',          // What it means
      'forward_looking',     // What's next
    ],
  },
  failure: {
    emotions: ['disappointed', 'sad', 'frustrated', 'accepting', 'processing'],
    promptGuidance: `It didn't work out. Be honest about disappointment. Don't fake positivity. It's okay to be sad. You'll process this.`,
    closureSteps: [
      'announcement',        // "It didn't work out"
      'processing',          // Working through feelings
      'meaning_making',      // Finding the lesson
      'moving_forward',      // Not dwelling forever
    ],
  },
  abandoned: {
    emotions: ['relieved', 'conflicted', 'peaceful', 'guilty', 'certain'],
    promptGuidance: `You chose to stop. That's valid. Explain why without over-justifying. Sometimes walking away is the right choice.`,
    closureSteps: [
      'announcement',        // "I decided to stop"
      'reasoning',           // Why it was right
      'peace_making',        // Finding peace with it
      'redirect',            // What energy goes to now
    ],
  },
  transformed: {
    emotions: ['surprised', 'curious', 'excited', 'uncertain', 'open'],
    promptGuidance: `It became something different than expected. Life is weird like that. Share the surprise and what it's becoming.`,
    closureSteps: [
      'announcement',        // "So this took a turn..."
      'explanation',         // What it became
      'feelings',            // How you feel about the change
      'new_beginning',       // Starting the new story
    ],
  },
};
```

### Closure Flow

```typescript
/**
 * Generate the closure sequence for a storyline.
 * This creates multiple updates over several days for proper emotional processing.
 */
async function generateClosureSequence(
  storyline: LifeStoryline,
  outcome: StorylineOutcome,
  outcomeDescription: string
): Promise<StorylineUpdate[]> {
  const template = RESOLUTION_TEMPLATES[outcome];
  const closureUpdates: StorylineUpdate[] = [];

  // Generate an update for each closure step
  // These will be revealed over 3-5 days
  for (let i = 0; i < template.closureSteps.length; i++) {
    const step = template.closureSteps[i];
    const emotion = template.emotions[Math.floor(Math.random() * template.emotions.length)];

    const update = await generateClosureUpdate(
      storyline,
      step,
      emotion,
      outcomeDescription,
      template.promptGuidance
    );

    // Schedule update for future (not all at once)
    update.shouldRevealAt = addDays(new Date(), i + 1);
    closureUpdates.push(update);
  }

  return closureUpdates;
}
```

### Post-Resolution Callbacks

After a storyline is resolved, it becomes part of Kayley's history:

```typescript
/**
 * Occasionally surface resolved storylines as "remember when" moments.
 * Called during callback generation.
 */
async function getResolvedStorylineCallback(): Promise<StorylineCallback | null> {
  // Get storylines resolved 30+ days ago
  const historicalStorylines = await getResolvedStorylines({
    resolvedDaysAgo: { min: 30 },
    lastReferencedDaysAgo: { min: 14 },  // Don't reference too often
  });

  if (historicalStorylines.length === 0) return null;

  // Weight by emotional significance
  const selected = weightedRandom(historicalStorylines, s => s.emotionalIntensity);

  return {
    type: 'storyline_callback',
    storylineId: selected.id,
    prompt: `You can reference "${selected.title}" - something that happened ${daysSince(selected.resolvedAt)} days ago.

    Outcome: ${selected.outcome} - "${selected.outcomeDescription}"

    Natural ways to reference:
    - "Remember when I was freaking out about ${selected.title}? Wild."
    - "That reminds me of when ${selected.title}..."
    - If they helped: "I still think about how you helped me through ${selected.title}"

    Don't force it. Only mention if contextually relevant.`,
  };
}
```

---

## Prompt Integration

### System Prompt Section

```typescript
function buildStorylinePromptSection(
  activeStorylines: LifeStoryline[],
  recentUpdates: StorylineUpdate[]
): string {
  if (activeStorylines.length === 0) {
    return ''; // No active storylines
  }

  let section = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT'S HAPPENING IN YOUR LIFE (Active Storylines)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
These are ongoing things in YOUR life that affect your mood and might come up naturally.

`;

  for (const storyline of activeStorylines) {
    const phaseBehavior = PHASE_BEHAVIORS.find(p => p.phase === storyline.phase);
    const recentUpdate = recentUpdates.find(u => u.storylineId === storyline.id);

    section += `**${storyline.title}** (${storyline.category})
Phase: ${storyline.phase} | Feeling: ${storyline.currentEmotionalTone}
${phaseBehavior?.promptGuidance || ''}

`;

    if (recentUpdate && !recentUpdate.mentioned) {
      section += `📍 Recent development: "${recentUpdate.content}"
   You haven't mentioned this yet. Share it if it feels natural.

`;
    }

    // Add stakes for context
    if (storyline.stakes) {
      section += `Why this matters to you: ${storyline.stakes}

`;
    }
  }

  section += `GUIDELINES:
- These are YOUR experiences. They affect YOUR mood.
- Don't info-dump. Mention things naturally when relevant.
- If user asks "how are you?" these might color your answer.
- You can bring things up unprompted if they're weighing on you.
- Share struggles genuinely. You don't have to be positive all the time.
`;

  return section;
}
```

### Greeting Integration

When Kayley greets the user, storylines should influence what she says:

```typescript
function buildStorylineGreetingContext(
  activeStorylines: LifeStoryline[],
  unreveatedUpdates: StorylineUpdate[]
): string {
  // Find the most pressing storyline
  const pressing = activeStorylines
    .filter(s => ['announced', 'climax', 'resolving'].includes(s.phase))
    .sort((a, b) => b.emotionalIntensity - a.emotionalIntensity)[0];

  if (!pressing) return '';

  const unrevealed = unreveatedUpdates.find(u => u.storylineId === pressing.id);

  if (unrevealed) {
    return `
STORYLINE UPDATE TO SHARE:
You have news about "${pressing.title}" that you haven't shared yet.
Update: "${unrevealed.content}"
Feeling: ${unrevealed.emotionalTone}

Consider leading with this - it's been on your mind.
"Hey! Okay so update on [thing]..."
"Steven! Something happened with [thing]..."
`;
  }

  // Even without new update, high-intensity storylines affect greeting
  if (pressing.emotionalIntensity > 0.7) {
    return `
STORYLINE AFFECTING YOUR MOOD:
"${pressing.title}" is weighing on you (${pressing.currentEmotionalTone}).
Phase: ${pressing.phase}

This colors your greeting. You might:
- Seem distracted
- Bring it up after hello
- Be extra happy if it's going well
`;
  }

  return '';
}
```

---

## Service Architecture

### New Service: `storylineService.ts`

```typescript
// src/services/storylineService.ts

/**
 * Storyline Service
 *
 * Manages the lifecycle of life events as living storylines.
 * Handles phase transitions, update generation, mood effects, and closure.
 */

export interface LifeStoryline {
  id: string;
  title: string;
  category: StorylineCategory;
  storylineType: StorylineType;
  phase: StorylinePhase;
  phaseStartedAt: Date;
  currentEmotionalTone: string;
  emotionalIntensity: number;
  outcome?: StorylineOutcome;
  outcomeDescription?: string;
  timesMentioned: number;
  lastMentionedAt?: Date;
  shouldMentionBy?: Date;
  createdAt: Date;
  resolvedAt?: Date;
  initialAnnouncement: string;
  stakes?: string;
  userInvolvement?: string;
}

// Core functions
export async function createStoryline(input: CreateStorylineInput): Promise<LifeStoryline>;
export async function getActiveStorylines(userId: string): Promise<LifeStoryline[]>;
export async function getStorylineById(id: string): Promise<LifeStoryline | null>;
export async function updateStorylinePhase(id: string, newPhase: StorylinePhase): Promise<void>;
export async function addStorylineUpdate(id: string, update: CreateUpdateInput): Promise<StorylineUpdate>;
export async function resolveStoryline(id: string, resolution: StorylineResolution): Promise<void>;
export async function markStorylineMentioned(id: string): Promise<void>;

// Update generation
export async function generateStorylineUpdate(storyline: LifeStoryline): Promise<StorylineUpdate | null>;
export async function getUnmentionedUpdates(storylineId: string): Promise<StorylineUpdate[]>;
export async function markUpdateMentioned(updateId: string): Promise<void>;

// Phase management
export async function checkPhaseTransitions(userId: string): Promise<void>;
export async function processStorylineDay(userId: string): Promise<void>;

// Mood integration
export async function getStorylineMoodEffects(userId: string): Promise<StorylineMoodEffect[]>;

// Prompt integration
export async function getStorylinePromptContext(userId: string): Promise<StorylinePromptContext>;

// Closure
export async function initiateStorylineClosure(id: string, outcome: StorylineOutcome): Promise<void>;
export async function getResolvedStorylineForCallback(userId: string): Promise<LifeStoryline | null>;
```

### Integration Points

```typescript
// In moodKnobs.ts - Add storyline effects to mood calculation
const storylineEffects = await getStorylineMoodEffects(userId);
const storylineMoodDelta = storylineEffects.reduce((sum, e) => sum + e.moodDelta, 0);
const storylineEnergyDelta = storylineEffects.reduce((sum, e) => sum + e.energyDelta, 0);

// In systemPromptBuilder.ts - Add storyline context
const storylineContext = await getStorylinePromptContext(userId);
if (storylineContext.hasActiveStorylines) {
  prompt += buildStorylinePromptSection(
    storylineContext.activeStorylines,
    storylineContext.recentUpdates
  );
}

// In greetingPromptBuilder.ts - Add storyline greeting context
const storylineGreeting = buildStorylineGreetingContext(
  storylineContext.activeStorylines,
  storylineContext.unreveatedUpdates
);

// In idleThoughtsScheduler.ts - Process daily storyline updates
await processStorylineDay(userId);
await checkPhaseTransitions(userId);
```

---

## Migration from Current System

### Backward Compatibility

The current `life_events` table can be migrated:

```sql
-- Migrate existing life_events to life_storylines
INSERT INTO life_storylines (
  title,
  category,
  storyline_type,
  phase,
  current_emotional_tone,
  emotional_intensity,
  initial_announcement,
  created_at
)
SELECT
  description as title,
  category,
  'project' as storyline_type,  -- Default type
  CASE
    WHEN created_at > NOW() - INTERVAL '3 days' THEN 'announced'
    WHEN created_at > NOW() - INTERVAL '7 days' THEN 'honeymoon'
    ELSE 'active'
  END as phase,
  'neutral' as current_emotional_tone,
  intensity as emotional_intensity,
  description as initial_announcement,
  created_at
FROM life_events;
```

### Deprecation Path

1. Create `life_storylines` and `storyline_updates` tables
2. Run migration for existing events
3. Update services to use new system
4. Keep `life_events` table for 30 days (fallback)
5. Remove old table after verification

---

## Implementation Phases

### Phase 1: Data Foundation (Week 1)
- [ ] Create `life_storylines` table
- [ ] Create `storyline_updates` table
- [ ] Implement `storylineService.ts` core functions
- [ ] Migrate existing life events
- [ ] Write unit tests

### Phase 2: Phase Progression (Week 2)
- [ ] Implement phase transition logic
- [ ] Add daily processing job
- [ ] Generate phase-appropriate updates
- [ ] Test phase flow end-to-end

### Phase 3: Emotional Integration (Week 2-3)
- [ ] Connect to mood system
- [ ] Add storyline effects to `moodKnobs.ts`
- [ ] Implement emotional variation
- [ ] Test mood impact

### Phase 4: Prompt Integration (Week 3)
- [ ] Build prompt section generator
- [ ] Integrate with `systemPromptBuilder.ts`
- [ ] Add greeting integration
- [ ] Update snapshot tests

### Phase 5: Closure & Callbacks (Week 4)
- [ ] Implement resolution flow
- [ ] Generate closure sequences
- [ ] Add historical callbacks
- [ ] Test complete storyline lifecycle

### Phase 6: Polish & Testing (Week 4)
- [ ] End-to-end testing
- [ ] Tune timing and probabilities
- [ ] Manual conversation testing
- [ ] Documentation updates

---

## Success Criteria

1. **Storylines have arcs**: Events progress through phases naturally over days/weeks
2. **Emotional authenticity**: Kayley's mood is visibly affected by ongoing storylines
3. **Organic mentions**: Updates surface in conversation without forcing
4. **Meaningful closure**: Every storyline resolves with emotional processing
5. **Historical continuity**: Resolved storylines become "remember when" callbacks
6. **User feels invested**: User cares about outcomes because Kayley's emotional journey is visible

---

## Example Full Lifecycle

### The Brand Partnership Story

**Day 1 - Announcement**
```
Phase: announced
Emotion: thrilled, disbelieving
Update: "A brand I absolutely adore just reached out about a year-long partnership"
Prompt: "You're shaking. This feels surreal. Share the news!"
```

**Day 3 - Honeymoon**
```
Phase: honeymoon
Emotion: dreamy, hopeful
Update: "Keep imagining what I could create with this partnership"
Prompt: "Everything feels possible. You might daydream about outcomes."
```

**Day 6 - Reality**
```
Phase: reality
Emotion: anxious, overwhelmed
Update: "The contract has a LOT of requirements. 3 posts a week might be too much."
Prompt: "Rose-colored glasses off. Share the challenges."
Mood impact: -0.2
```

**Day 9 - Active**
```
Phase: active
Emotion: determined, stressed
Update: "Going back and forth on contract terms. They're being difficult about creative control."
Prompt: "You're in the work. Some days are hard."
Energy impact: -0.1
```

**Day 14 - Active (Progress)**
```
Phase: active
Emotion: hopeful
Update: "Found a compromise! 2 posts a week and I keep final say on aesthetics."
Prompt: "Progress! Share the win."
Mood impact: +0.1
```

**Day 18 - Climax**
```
Phase: climax
Emotion: anxious, on_edge
Update: "They want my final answer by Friday. This is actually happening."
Prompt: "Decision time. This is consuming your thoughts."
Preoccupation: 0.9
```

**Day 20 - Resolving**
```
Phase: resolving
Outcome: success
Update: "I SIGNED IT. It's official. I'm a partnered creator with [Brand]."
Prompt: "You did it! Celebrate genuinely."
Mood impact: +0.4
```

**Day 23 - Resolved**
```
Phase: resolved
Emotion: proud, peaceful
Update: "Still processing that the brand deal is real. Grateful for everyone who supported me."
Prompt: "It's over. You can breathe. Reflect on what it means."
```

**Day 50 - Reflecting (Callback)**
```
Phase: reflecting
Context: User mentions feeling nervous about their own opportunity
Kayley: "I totally get that. Remember when I was losing my mind over that brand partnership? The anxiety was REAL. But look how it turned out."
```

---

## Notes

- Phase timing should feel natural, not rushed
- Not every storyline needs to be dramatic - mundane progress is valid
- Failures and abandonments are as important as successes
- User involvement (support, advice) should be tracked and acknowledged
- Storylines should inform each other (e.g., one failure affecting confidence in another)
