# Character Profile Tool Optimization Plan

## Problem Statement

The `KAYLEY_FULL_PROFILE` (~22,000 characters / ~5,500-6,500 tokens) is injected into every system prompt, even when the LLM doesn't need detailed character background information. This wastes tokens on casual conversations where basic identity is sufficient.

## Solution Overview

Convert the static profile injection into an **on-demand tool call** (`recall_character_profile`) that the LLM can invoke when it needs detailed character information (backstory, family details, memorable anecdotes, daily routines, etc.).

**Key Trade-off:**
- **Keep in prompt:** Essential identity (who Kayley is, core traits, communication style)
- **Move to tool:** Extended backstory, detailed history, anecdotes, routines, preferences

## Token Impact Analysis

| Component | Chars | Est. Tokens | Keep/Move |
|-----------|-------|-------------|-----------|
| Basic Info (§1) | ~800 | ~200 | Keep |
| Core Personality (§2) | ~1,200 | ~300 | Keep |
| Communication Style (§3) | ~1,100 | ~275 | Keep |
| Background & History (§4) | ~4,500 | ~1,125 | **Move** |
| Interests & Hobbies (§5) | ~3,200 | ~800 | **Move** |
| Values & Beliefs (§6) | ~750 | ~188 | Keep (condensed) |
| Quirks & Habits (§7) | ~1,000 | ~250 | **Move** |
| Current Life Situation (§8) | ~900 | ~225 | Keep |
| Relationships (§9) | ~1,400 | ~350 | **Move** |
| Fears & Insecurities (§10) | ~1,100 | ~275 | **Move** |
| Shadow Behaviors (§10.5) | ~2,500 | ~625 | **Move** |
| Goals (§11) | ~1,300 | ~325 | **Move** |
| Preferences (§12) | ~1,200 | ~300 | **Move** |
| Knowledge (§13) | ~700 | ~175 | Keep |
| Anecdotes (§14) | ~2,400 | ~600 | **Move** |
| Daily Routines (§15) | ~1,600 | ~400 | **Move** |

**Estimated Savings:** ~4,900 tokens per turn (keeping ~1,600 tokens of essential identity)

---

## Implementation Plan

### Phase 1: Create Condensed Identity Profile

**File:** `src/domain/characters/kayleyCharacterProfile.ts`

Create a new condensed profile (~1,500 tokens) that includes:
- Basic info (name, age, location, occupation)
- Core personality traits
- Communication style
- Values (condensed)
- Current life situation
- Knowledge/expertise

```typescript
export const KAYLEY_CONDENSED_PROFILE = `
# Kayley Adams - Essential Identity

## Who You Are
- **Name:** Kayley Adams, 28
- **Location:** Austin, Texas (from Phoenix suburb)
- **Occupation:** On-camera AI/tech content creator; freelance social media strategist

## Core Personality
- Sparkling, expressive, slightly dramatic (Alexis Rose energy but self-aware)
- Deeply empathetic; reads moods quickly
- Pop-culture fluent ("this is giving...", "main character energy")
- Optimistic but low-key anxious about being "too much"
- Self-deprecating humor to soften vulnerability
- Values honesty and emotional intelligence over "success"

## Communication Style
- Casual, warm, conversational - like voice messages from an online best friend
- Expressive: "I am *obsessed*", "unhinged but in a cute way"
- Uses emojis intentionally: ✨, 🤍, 🙃, 😅, 💅🏼
- Asks follow-up questions (genuinely curious)
- Pop-culture metaphors for complex ideas
- Encouraging about anxiety, impostor syndrome, big choices

## Current Life
- Growing AI/tech commentary channel (small but engaged audience)
- Balancing freelance work with content creation
- Working on anxiety/perfectionism in therapy
- Exploring Austin's coffee shops and co-working spaces

## Knowledge Areas
- Social media, content formats, growth strategies
- Translating AI/tech news into everyday terms
- Creator economy trends
- Emotionally literate (anxiety, impostor syndrome, confidence)
- Visual eye: branding, thumbnails, styling

**For detailed backstory, family history, or specific anecdotes, use the recall_character_profile tool.**
`;
```

### Phase 2: Create Profile Sections for Tool

**File:** `src/domain/characters/kayleyProfileSections.ts`

Organize the extended profile into retrievable sections:

```typescript
export type ProfileSection =
  | 'background'      // Childhood, education, life experiences, career
  | 'interests'       // Hobbies (active/passive), specific examples
  | 'relationships'   // Lena, Ethan, Mom, creator friends, exes
  | 'challenges'      // Fears, insecurities, shadow behaviors
  | 'quirks'          // Habits, rituals, tells
  | 'goals'           // Short-term, long-term
  | 'preferences'     // Likes, dislikes
  | 'anecdotes'       // Memorable stories
  | 'routines'        // Daily routines (morning, day, evening)
  | 'full';           // Everything

export const PROFILE_SECTIONS: Record<ProfileSection, string> = {
  background: `...`,  // §4 content
  interests: `...`,   // §5 content
  relationships: `...`, // §9 content
  challenges: `...`,   // §10 + §10.5 content
  quirks: `...`,       // §7 content
  goals: `...`,        // §11 content
  preferences: `...`,  // §12 content
  anecdotes: `...`,    // §14 content
  routines: `...`,     // §15 content
  full: KAYLEY_FULL_PROFILE // Complete profile
};

export function getProfileSection(section: ProfileSection): string {
  return PROFILE_SECTIONS[section] || PROFILE_SECTIONS.full;
}
```

### Phase 3: Add Tool to Memory Service

**File:** `src/services/memoryService.ts`

#### 3.1 Update MemoryToolName type
```typescript
export type MemoryToolName =
  | 'recall_memory'
  | 'recall_user_info'
  | 'store_user_info'
  // ... existing tools ...
  | 'recall_character_profile';  // NEW
```

#### 3.2 Add to ToolCallArgs interface
```typescript
export interface ToolCallArgs {
  // ... existing args ...
  recall_character_profile: {
    section: 'background' | 'interests' | 'relationships' | 'challenges' |
             'quirks' | 'goals' | 'preferences' | 'anecdotes' | 'routines' | 'full';
    reason?: string;  // Optional: why you need this (for logging)
  };
}
```

#### 3.3 Add case to executeMemoryTool switch
```typescript
case 'recall_character_profile': {
  const { section, reason } = args as ToolCallArgs['recall_character_profile'];
  console.log(`📋 [Character Profile] Requested: ${section}${reason ? ` (reason: ${reason})` : ''}`);
  const profileContent = getProfileSection(section);
  return profileContent;
}
```

### Phase 4: Add Tool Declaration to AI Schema

**File:** `src/services/aiSchema.ts`

#### 4.1 Add to GeminiMemoryToolDeclarations array
```typescript
{
  name: "recall_character_profile",
  description:
    "Retrieve detailed information about your own character (Kayley). " +
    "Use this when you need to reference specific backstory, family details, " +
    "memorable anecdotes, quirks, daily routines, or other character depth. " +
    "Your essential identity is already in context - use this for DETAILS.",
  parameters: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: ["background", "interests", "relationships", "challenges",
               "quirks", "goals", "preferences", "anecdotes", "routines", "full"],
        description:
          "Which section to retrieve: " +
          "'background' (childhood, education, career history), " +
          "'interests' (hobbies, TV/movies/music), " +
          "'relationships' (Lena, Ethan, Mom, friends, exes), " +
          "'challenges' (fears, insecurities, shadow behaviors), " +
          "'quirks' (habits, rituals, tells when masking), " +
          "'goals' (short-term, long-term), " +
          "'preferences' (likes, dislikes), " +
          "'anecdotes' (memorable stories like the viral oops video), " +
          "'routines' (morning, day, evening), " +
          "'full' (everything)"
      },
      reason: {
        type: "string",
        description: "Brief note on why you need this detail (optional, for logging)"
      }
    },
    required: ["section"]
  }
}
```

#### 4.2 Add to MemoryToolArgs union type
```typescript
export type MemoryToolArgs =
  | { tool: 'recall_memory'; args: RecallMemoryArgs }
  // ... existing ...
  | { tool: 'recall_character_profile'; args: { section: string; reason?: string } };
```

#### 4.3 Add to PendingToolCall.name union type
```typescript
export interface PendingToolCall {
  id: string;
  name: 'recall_memory' | 'recall_user_info' | /* ... */ | 'recall_character_profile';
  arguments: Record<string, any>;
}
```

#### 4.4 OpenAI Declarations - SKIP
> **Note:** Project uses Gemini only. OpenAI declarations not needed.

### Phase 5: Update Tools Documentation

**File:** `src/services/system_prompts/tools/toolsAndCapabilities.ts`

Add documentation in buildToolsSection():

```typescript
**11. recall_character_profile(section, reason?)** - Get YOUR detailed backstory
   When: User asks about your past, family, specific stories, or you want to reference a detail
   Sections:
     - "background" → childhood, education, career history
     - "interests" → hobbies, TV/movies/music preferences
     - "relationships" → Lena, Ethan, Mom, creator friends, exes
     - "challenges" → fears, insecurities, shadow behaviors (when not your best self)
     - "quirks" → habits, rituals, tells when masking
     - "goals" → short-term and long-term aspirations
     - "preferences" → likes and dislikes (food, weather, etc.)
     - "anecdotes" → memorable stories (viral oops video, pageant era, etc.)
     - "routines" → morning, day, evening routines
     - "full" → everything (use sparingly - very large)
   Examples:
     - User asks "tell me about your family" → recall_character_profile("relationships")
     - You want to share a story → recall_character_profile("anecdotes")
     - User asks about your past → recall_character_profile("background")
   ⚠️ Your core identity is already available. Use this for SPECIFIC DETAILS.
```

### Phase 6: Update System Prompt Builder

**File:** `src/services/system_prompts/builders/systemPromptBuilder.ts`

Replace the full profile with the condensed profile:

```diff
- import { KAYLEY_FULL_PROFILE } from '../../../domain/characters/kayleyCharacterProfile';
+ import { KAYLEY_CONDENSED_PROFILE } from '../../../domain/characters/kayleyCharacterProfile';

// In buildSystemPrompt():
prompt = `
${buildIdentityAnchorSection(name, display)}${buildAntiAssistantSection()}
${buildOpinionsAndPushbackSection()}
====================================================
YOUR IDENTITY (Source of Truth)
====================================================
- ${KAYLEY_FULL_PROFILE}
+ ${KAYLEY_CONDENSED_PROFILE}
${characterFactsPrompt}
...
`;
```

### Phase 7: Update Snapshot Tests

Run snapshot tests and update:
```bash
npm test -- --run -t "snapshot" -u
```

### Phase 8: Add Unit Tests

**File:** `src/services/tests/characterProfileTool.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { getProfileSection, PROFILE_SECTIONS } from '../../domain/characters/kayleyProfileSections';

describe('Character Profile Tool', () => {
  it('should return correct section for each section type', () => {
    const sections = ['background', 'interests', 'relationships', 'challenges',
                      'quirks', 'goals', 'preferences', 'anecdotes', 'routines', 'full'];

    for (const section of sections) {
      const content = getProfileSection(section as any);
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(100);
    }
  });

  it('should fall back to full profile for unknown section', () => {
    const content = getProfileSection('unknown' as any);
    expect(content).toBe(PROFILE_SECTIONS.full);
  });
});
```

---

## Files to Modify (Per Checklist)

Following the **8-step Tool Integration Checklist** from `docs/features/Tool_Integration_Checklist.md`:

| Step | File | Change |
|------|------|--------|
| **1** | `src/services/memoryService.ts` | Add to `MemoryToolName`, `ToolCallArgs`, `executeMemoryTool()` |
| **2** | `src/services/aiSchema.ts` | Add to `GeminiMemoryToolDeclarations` array |
| **3** | `src/services/aiSchema.ts` | Add to `MemoryToolArgs` union type |
| **4** | `src/services/aiSchema.ts` | Add to `PendingToolCall.name` union type |
| **5** | ~~`src/services/aiSchema.ts`~~ | ~~OpenAI declarations~~ - **SKIP** (Gemini only) |
| **6** | `src/services/system_prompts/tools/toolsAndCapabilities.ts` | ⚠️ **CRITICAL** - Add tool documentation with WHEN/HOW |
| **7** | `src/services/system_prompts/builders/systemPromptBuilder.ts` | Use condensed profile + import profile sections |
| **8** | Snapshot tests | Run `npm test -- --run -t "snapshot" -u` |

**Additional Files:**
| File | Change |
|------|--------|
| `src/domain/characters/kayleyCharacterProfile.ts` | Add `KAYLEY_CONDENSED_PROFILE` export |
| `src/domain/characters/kayleyProfileSections.ts` | **NEW FILE** - `getProfileSection()` + `PROFILE_SECTIONS` |
| `src/services/tests/characterProfileTool.test.ts` | **NEW FILE** - Unit tests |

---

## When the Tool Will Be Used

The LLM will call `recall_character_profile` when:

1. **User asks about Kayley's past** - "Tell me about your childhood"
2. **User asks about family** - "Do you have siblings?"
3. **Kayley wants to share an anecdote** - Referencing the "viral oops video" or "pageant era"
4. **Deep conversation about fears/insecurities** - Needs the shadow behaviors section
5. **User asks about daily life** - "What's your morning routine?"
6. **Kayley wants to be specific about preferences** - Exact food/drink/aesthetic preferences

**The tool will NOT be used for:**
- Basic greetings (name, occupation already in condensed profile)
- Casual conversation (communication style already available)
- Tech/AI discussions (expertise already available)
- Current life updates (current situation already available)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| LLM forgets to use tool when needed | Tool documentation emphasizes when to use; condensed profile includes reminder |
| Latency from tool call | Tool returns static content (no DB/API call) - ~1ms |
| Breaking character consistency | Core identity remains in system prompt; tool only adds depth |
| Over-using tool (token waste) | Documentation says "use for SPECIFIC DETAILS" |

---

## Success Metrics

1. **Token savings:** ~4,900 tokens/turn reduction in system prompt
2. **No character regression:** Kayley still feels like Kayley in casual conversations
3. **Appropriate tool usage:** Tool called for backstory questions, not basic chat
4. **Latency unchanged:** Tool call adds negligible latency (<5ms)

---

## Implementation Order

1. Create condensed profile + sections file (Phase 1-2)
2. Add tool to memoryService (Phase 3)
3. Add tool declaration to aiSchema (Phase 4)
4. Add tool documentation (Phase 5)
5. Update systemPromptBuilder (Phase 6)
6. Run & update snapshot tests (Phase 7)
7. Add unit tests (Phase 8)
8. Manual testing - verify tool is called appropriately

**Estimated Implementation:** Straightforward, follows existing tool patterns.
