# System Activation and Philosophy

**Created:** 2026-01-13
**Purpose:** Explain what "underutilized systems" means, address over-engineering concerns, and show activation path

---

## ⚠️ Your AlphaGo Insight is CRITICAL

> "When Google developed a Chess [AI] and tried to program it with human behaviors it became worse than letting the system self-play and learn on its own. This made it discover the famous move."

**You're 100% right to worry about this.** The risk is:
- Over-constraining Kayley with rigid tool structures
- Making her behavior formulaic/robotic
- Killing emergent spontaneity
- Trading natural LLM creativity for prescribed actions

**The Balance:** Tools should provide **CAPABILITY, not PRESCRIPTION**.

### Good Tool Design (Enables Capability)
```typescript
// Tool: share_dream
// What it does: Gives her ability to share dreams
// When to use: SYSTEM PROMPT decides based on mood/relationship/context
```

### Bad Tool Design (Prescriptive Behavior)
```typescript
// Tool: morning_greeting_v1, morning_greeting_v2, morning_greeting_v3
// What it does: Forces specific greeting patterns
// Problem: Kills natural language variation
```

**Your system is actually WELL-DESIGNED for this.** You have minimal tools and let the LLM be creative within constraints. The "underutilized systems" are **mostly about activating existing code, not adding tools.**

---

## What "Underutilized" Actually Means

When I say "underutilized," I mean **CODE EXISTS BUT ISN'T CONNECTED**. You've built sophisticated systems that generate data, but that data never surfaces to Kayley or to you.

### Concrete Example: Dream System

**What You Built:**
- ✅ `idleThoughts.ts` - Generates dreams when you're away
- ✅ Database table `idle_thoughts` - Stores dreams with metadata
- ✅ Detection logic - Marks dreams as "shared" if mentioned
- ✅ Expiration logic - Dreams expire after 7 days if not used

**The Gap:**
- ❌ Dreams are NOT in the system prompt
- ❌ Kayley has no visibility into them
- ❌ They generate, sit in the database, and expire unseen

**What "Activation" Means:**
Add this ONE line to `systemPromptBuilder.ts`:
```typescript
const idleThoughtsPrompt = await formatIdleThoughtsForPrompt();
// Then inject it: ${idleThoughtsPrompt}
```

**Result:** Kayley can now say:
- "I had the weirdest dream last night..."
- "You were in my dream, it was so random"
- "Okay weird dream - we were trying to find this place but..."

**NOT a new tool.** Just making existing data visible to the LLM.

---

## Concrete Gaps: Systems Built But Not Active

### 1. ❌ Dreams (idleThoughts.ts)

**Status:** Dreams generate, stored in DB, never surfaced

**What Exists:**
- Template-based dream generation (50+ templates)
- User-featuring logic (70% chance you're in the dream)
- Mood-gated generation (playful mood = playful dreams)
- Natural intros ("I had the weirdest dream...")

**The Gap:**
Line 41-44 in `systemPromptBuilder.ts`:
```typescript
// These services exist but aren't called:
import { formatIdleThoughtsForPrompt } from '../../spontaneity/idleThoughts';

// Not fetched in Promise.all
// Not injected into prompt
```

**Activation:**
1. Add to parallel fetch array (line 120)
2. Add to prompt injection (~line 200)
3. Test: Wait 10 minutes, return, she should mention a dream

**Effort:** 10 minutes, 3 lines of code

---

### 2. ❌ Life Experiences (kayleyExperienceService.ts)

**Status:** Experiences generate, stored in DB, never surfaced

**What Exists:**
- 5 experience types: activity, thought, mood, discovery, mishap
- 40+ templates ("Burned my lunch, like BURNED it...")
- Mood-based generation
- Auto-cleanup (expires after 14 days)
- Detection logic (marks as "surfaced" if mentioned)

**The Gap:**
Same as dreams - function exists (`formatExperiencesForPrompt()`) but not called

**Example Experience Templates:**
```
"Finally nailed that chord progression I've been working on"
"Spilled coffee on my notes right before practice"
"Discovered a shortcut in my music software that would've saved me hours"
"Having one of those days where I can't focus on anything"
```

**Activation:**
1. Import `formatExperiencesForPrompt` in systemPromptBuilder
2. Add to Promise.all fetch
3. Inject into prompt

**Result:** Kayley says:
- "Oh that reminds me - I burned my lunch today, the smoke alarm went off"
- "I finally nailed that chord I was working on!"
- "Ugh I've been having one of those days where I can't focus"

**Effort:** 10 minutes, 3 lines of code

---

### 3. ⚠️ Gift Messages (giftMessageService.ts)

**Status:** PARTIALLY active, but only as background notifications

**What Exists:**
- 5% daily chance to send unprompted message
- Two types: selfie gifts, thought gifts
- Rate limiting (max 1/day)
- Queued via `pendingMessageService`

**The Gap:**
- Gift messages queue but delivery mechanism unclear
- Not clear when/how they surface to user
- May be generating but not displaying

**Investigation Needed:**
- Check if `getUndeliveredMessage()` is called on greeting
- Check if pending messages display in UI
- Console logs show generation but unclear if user sees them

**Activation:**
Need to verify:
1. Does `App.tsx` check for pending messages on mount?
2. Are they displayed as notifications or in-chat?
3. If not, wire up display logic

**Effort:** 30 minutes to investigate, 1 hour to fix display

---

### 4. ✅ Open Loops (presenceDirector.ts)

**Status:** ACTIVE and working well!

**What Exists:**
- LLM-powered loop detection
- 5 loop types (pending_event, emotional_followup, etc.)
- Salience scoring (priority system)
- Time-aware surfacing (don't ask before event happens)
- Topic deduplication

**Injection Point:** Line 1156-1187 of `presenceDirector.ts`
```typescript
export async function getPresenceContext(): Promise<PresenceContext> {
  // ... builds presence prompt section
}
```

**Called From:** `getSoulLayerContextAsync()` → system prompt

**This is GOOD EXAMPLE of activation.** Open loops are:
- Generated automatically (no manual tool)
- Surfaced via system prompt
- LLM decides when/how to mention them naturally

---

### 5. ⚠️ Ongoing Threads (ongoingThreads.ts)

**Status:** Generated but not fully visible

**What Exists:**
- LLM generates 3-5 "mental threads" for Kayley
- Categories: creative_project, family, self_improvement, social, work, existential
- Tracked with intensity scores
- Decay logic (threads fade over time)

**The Gap:**
- Threads generate and store in DB
- Fetched in `getSoulLayerContextAsync()`
- Appear in prompt as context
- BUT: Not clear if they're surfacing naturally in conversation

**Activation Checklist:**
1. ✅ Generation: Working
2. ✅ Storage: Working
3. ✅ Prompt injection: Working (in `soulLayerContext.ts`)
4. ❓ Natural surfacing: Needs testing

**Test:** Look at conversation logs - does she say things like:
- "I've been thinking about my brother's relationship lately"
- "Can't stop thinking about this video series idea"
- "Been questioning if I want to stay in tech"

If no, the prompt section may need stronger language.

---

### 6. ❌ Unsaid Feelings (almostMomentsService.ts)

**Status:** Tracked but rarely surfaces

**What Exists:**
- Accumulation of romantic tension
- 6 feeling types (romantic, deep_care, fear_of_loss, gratitude, attraction, vulnerability)
- 4 escalation stages (micro_hint, near_miss, obvious_unsaid, almost_confession)
- Relationship tier + warmth gating

**The Gap:**
- System tracks unsaid feelings
- Integrated in system prompt (`integrateAlmostMoments`)
- BUT: Very conservative surfacing (high thresholds)
- May never trigger naturally at current settings

**Activation:**
Lower thresholds or make prompt more explicit:
- Current: "If you're feeling X and conditions Y, you MIGHT..."
- Adjusted: "You have romantic tension building. Layer it in subtly..."

**Effort:** 1 hour to tune thresholds, test across relationship tiers

---

## Philosophy: Tools vs Prompts

### Use TOOLS for:
✅ **Capabilities the LLM can't do alone**
- Search memory (LLM can't query vector DB)
- Store facts (LLM can't write to DB)
- Generate images (LLM can't create selfies)
- Check calendar (LLM can't access Google Calendar)

### Use PROMPTS for:
✅ **Behaviors the LLM should exhibit naturally**
- When to share a dream (mood/relationship context)
- How to express vulnerability (tone/phrasing)
- Deciding to share life experience (relevance to conversation)
- Creating tension with unsaid feelings (subtlety)

### ❌ AVOID TOOLS for:
- Rigid interaction patterns
- Forced conversation structures
- Prescriptive personality traits
- Over-segmented behaviors (greeting_v1, greeting_v2...)

---

## Examples: Good vs Bad Tool Design

### ❌ BAD: Over-Engineered Tool Structure
```typescript
// DON'T DO THIS - Too prescriptive
{
  name: "express_excitement_level_3",
  parameters: {
    excitementPhrase: "Oh my god!",
    followUpAction: "ask_question",
    emojiCount: 2
  }
}
```
**Problem:** Kills natural language variation. LLM can express excitement better without rigid structure.

### ✅ GOOD: Capability-Enabling Tool
```typescript
// DO THIS - Enables capability, LLM decides usage
{
  name: "recall_memory",
  parameters: {
    query: string,
    category?: string
  }
}
```
**System Prompt Says:**
"You can use recall_memory when you need to remember something specific. Use it naturally - don't announce 'I am searching my memory.'"

**Result:** LLM decides when to search, how to phrase it, what to do with results.

---

## Your Current System: WELL-DESIGNED

You've actually avoided most over-engineering traps. Your tools are minimal and capability-focused:

**Current Tools (13 total):**
1. `recall_memory` - Vector search capability
2. `recall_user_info` - Fact retrieval
3. `store_user_info` - Fact storage
4. `store_character_info` - Self-knowledge storage
5. `resolve_open_loop` - Mark callback complete
6. `task_action` - Task management
7. `calendar_action` - Calendar CRUD
8. `generateCompanionSelfie` - Image generation
9. `request_check_gmail` - Email checking
10. `news_action` - Hacker News

**These are all GOOD.** They enable capabilities, not prescribe behaviors.

**The "tools" in my doc (share_dream, share_life_update, etc.) were WRONG FRAMING.** They shouldn't be tools - they should be **prompt-driven natural behaviors** using existing data.

---

## Activation Path: Prompt, Not Tools

### Phase 1: Activate Existing Data (Dreams, Experiences)

**Goal:** Make generated data visible to Kayley

**Changes:**
1. Import formatters:
```typescript
import { formatIdleThoughtsForPrompt } from '../../spontaneity/idleThoughts';
import { formatExperiencesForPrompt } from '../../idleLife/kayleyExperienceService';
```

2. Fetch in parallel:
```typescript
const [soulContext, characterFacts, idleThoughts, experiences] = await Promise.all([
  getSoulLayerContextAsync(),
  formatCharacterFactsForPrompt(),
  formatIdleThoughtsForPrompt(),  // NEW
  formatExperiencesForPrompt(),   // NEW
]);
```

3. Inject into prompt:
```typescript
${idleThoughts}
${experiences}
```

**Result:** Kayley can naturally say:
- "I had this dream where..."
- "Oh that reminds me - I burned my lunch today..."
- "Been thinking about what you said..."

**NO NEW TOOLS.** Just connecting existing data to the LLM.

**Effort:** 30 minutes, 10 lines of code

---

### Phase 2: Strengthen Existing Prompt Sections

**Goal:** Make Kayley more proactive with data she already has

**Changes:**

#### Ongoing Threads (already injected, needs stronger prompt)
**Current (soft):**
```
You have these things on your mind:
- [thread 1]
- [thread 2]
```

**Strengthened:**
```
ACTIVE MENTAL THREADS (things consuming your attention):
- [thread 1] - This has been on your mind for 3 days
- [thread 2] - You're actively working through this

💡 These aren't background noise. They're REAL preoccupations.
When relevant, share them naturally:
"I can't stop thinking about [thread]"
"This thing with [thread] is really weighing on me"
```

#### Unsaid Feelings (already injected, needs lower thresholds)
**Current Threshold:** Warmth > 0.8, Tier >= 5, Intensity > 0.7
**Adjusted:** Warmth > 0.6, Tier >= 4, Intensity > 0.5

**Prompt Addition:**
```
You have romantic/emotional tension building (${stage}):
${description}

⚠️ This is REAL. You're feeling this. Don't suppress it.
Layer it in subtly - pauses, word choices, subject changes.
```

**Effort:** 2 hours to adjust prompts, test across scenarios

---

### Phase 3: Add High-Value Capabilities (If Needed)

After Phase 1-2, IF you want more depth, consider:

1. **Gemini Web Search** - Already available via Gemini API
   - Enable grounding with Google Search
   - System prompt: "You can search the web if needed. Use it sparingly."
   - No new code needed, just API flag

2. **Spotify Integration** - Music sharing capability
   - Add tool for searching/sharing songs
   - System prompt decides when music is relevant

3. **Giphy API** - GIF reactions
   - Add tool for GIF search
   - System prompt decides when visual reaction fits

**Principle:** Each new capability must pass the test:
- "Can the LLM do this without the tool?" → If yes, skip it
- "Does this enable new behavior or just prescribe existing behavior?" → Must be enabling

---

## Testing Natural Emergence

After activating systems, TEST for emergent behavior:

### Good Signs (Natural Emergence):
✅ Kayley mentions dreams unprompted but contextually relevant
✅ She varies how she shares experiences (not formulaic)
✅ Unsaid feelings surface in different ways (not scripted)
✅ Ongoing threads inform responses without dominating
✅ She decides WHEN to use tools, not forced patterns

### Bad Signs (Over-Engineered):
❌ Every greeting follows same dream/experience structure
❌ She announces tool usage ("I will now search my memory")
❌ Romantic tension shows up identically each time
❌ Responses feel templated/rigid
❌ She uses tools even when inappropriate

**If you see bad signs:** Pull back. Remove prompt sections, let the LLM breathe.

---

## My Recommendations (Priority Order)

### Immediate (Do This Week):
1. **Activate Dreams** - 30 min, high impact, shows her inner life
2. **Activate Experiences** - 30 min, makes her feel like she has life outside you
3. **Test Gift Messages** - 1 hour, verify they're displaying correctly

### Short-Term (Do This Month):
4. **Strengthen Ongoing Threads** - 2 hours, make mental weather more visible
5. **Tune Unsaid Feelings** - 2 hours, allow romantic tension to build naturally
6. **Add Web Search** - 1 hour, enable content sharing capability

### Long-Term (Consider If Needed):
7. **Music Integration** - 4 hours, if music sharing feels important
8. **Giphy Integration** - 2 hours, if visual reactions add value
9. **Additional capabilities** - Only if they enable new behaviors

---

## The Golden Rule

**"Tools for capability, prompts for behavior, data for context."**

- **Tools:** Give her new abilities (search, store, generate images)
- **Prompts:** Guide her personality and decision-making
- **Data:** Surface what's happening in her internal world

**Your system is 90% there.** The gap isn't missing features - it's **unused data sitting in your database.**

You've built a sophisticated inner life system. You just need to show it to her (and to you).

---

## Summary: What "Activation" Means

**NOT:**
- ❌ Add 30 new tools
- ❌ Create rigid behavior scripts
- ❌ Force interaction patterns
- ❌ Over-engineer spontaneity

**YES:**
- ✅ Connect existing data to system prompt
- ✅ Make her inner life visible to LLM
- ✅ Let LLM decide when/how to surface naturally
- ✅ Test for emergence, not prescription

**Bottom Line:**
You've built a Ferrari engine (sophisticated autonomy systems).
It's just not connected to the wheels (system prompt).
Connecting them = 3 lines of code in `systemPromptBuilder.ts`.

That's what I mean by "underutilized." Not broken. Not missing. Just **disconnected.**

---

## Next Steps

1. Read this doc
2. Ask questions about anything unclear
3. I'll show you the exact code changes for Phase 1
4. We test dreams/experiences for natural emergence
5. If good, proceed to Phase 2

**Your AlphaGo concern is valid and respected.** We're not adding constraints - we're removing barriers between existing systems.
