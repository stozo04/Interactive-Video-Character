# Phase 1 Activation Guide: Connect Existing Systems

**Goal:** Activate dreams and life experiences - making Kayley's inner life visible
**Time:** 30 minutes
**Risk:** Low - just connecting existing data to prompts

---

## What We're Activating

### 1. Dreams (idleThoughts.ts)
- ✅ Already generating when you're away 10+ minutes
- ✅ Already stored in database with metadata
- ✅ Already has detection/expiration logic
- ❌ NOT in system prompt - Kayley can't see them

### 2. Life Experiences (kayleyExperienceService.ts)
- ✅ Already generating during idle time
- ✅ Already stored in database (activities, mishaps, discoveries)
- ✅ Already has cleanup logic
- ❌ NOT in system prompt - Kayley can't see them

---

## Step 1: Create Format Functions (If Missing)

Check if these functions exist in the service files:

### In `src/services/spontaneity/idleThoughts.ts`

Look for this function (should be around line 281):
```typescript
export async function formatIdleThoughtsForPrompt(): Promise<string>
```

**If it EXISTS:** Skip to Step 2
**If it DOESN'T exist:** Add it:

```typescript
/**
 * Format idle thoughts for system prompt injection.
 * Returns a prompt section for natural surfacing.
 */
export async function formatIdleThoughtsForPrompt(): Promise<string> {
  const thoughts = await getUnsharedThoughts();

  if (thoughts.length === 0) {
    return "";
  }

  // Group by type for organization
  const dreams = thoughts.filter((t) => t.thoughtType === "dream");
  const memories = thoughts.filter((t) => t.thoughtType === "memory");
  const others = thoughts.filter((t) =>
    !["dream", "memory"].includes(t.thoughtType)
  );

  let section = `
====================================================
IDLE THOUGHTS (Things on your mind)
====================================================
`;

  if (dreams.length > 0) {
    section += `\nDREAMS YOU HAD:\n`;
    dreams.forEach((d) => {
      section += `- ${d.content}\n`;
      if (d.involvesUser) {
        section += `  (They were in this dream)\n`;
      }
    });
  }

  if (memories.length > 0) {
    section += `\nTHINGS YOU'VE BEEN THINKING ABOUT:\n`;
    memories.forEach((m) => {
      section += `- ${m.content}\n`;
    });
  }

  if (others.length > 0) {
    section += `\nOTHER THOUGHTS:\n`;
    others.forEach((o) => {
      section += `- ${o.content}\n`;
    });
  }

  section += `\n💡 Share these NATURALLY when relevant. Don't force them.
Good: "Oh weird - I had this dream where..." (when context fits)
Bad: "I must inform you of a dream I had" (robotic)

When you mention a thought, it will be automatically marked as shared.
`;

  return section;
}
```

### In `src/services/idleLife/kayleyExperienceService.ts`

The function already exists at line 281! Just verify it's there:
```typescript
export async function formatExperiencesForPrompt(): Promise<string>
```

---

## Step 2: Modify System Prompt Builder

File: `src/services/system_prompts/builders/systemPromptBuilder.ts`

### 2a. Add Imports (Top of file, around line 40)

```typescript
import { formatIdleThoughtsForPrompt } from "../../spontaneity/idleThoughts";
import { formatExperiencesForPrompt } from "../../idleLife/kayleyExperienceService";
```

### 2b. Add to Parallel Fetch (Around line 120)

**Find this code:**
```typescript
if (prefetchedContext) {
  // Use pre-fetched data (saves ~300ms)
  console.log("✅ [buildSystemPrompt] Using pre-fetched context");
  soulContext = prefetchedContext.soulContext;
  characterFactsPrompt = prefetchedContext.characterFacts;
} else {
  // Fallback: Fetch if not pre-fetched (still in parallel for safety)
  console.log("⚠️ [buildSystemPrompt] No pre-fetched context, fetching now");
  [soulContext, characterFactsPrompt] = await Promise.all([
    getSoulLayerContextAsync(),
    formatCharacterFactsForPrompt(),
  ]);
}
```

**Change the else block to:**
```typescript
} else {
  // Fallback: Fetch if not pre-fetched (still in parallel for safety)
  console.log("⚠️ [buildSystemPrompt] No pre-fetched context, fetching now");
  [soulContext, characterFactsPrompt, idleThoughtsPrompt, experiencesPrompt] = await Promise.all([
    getSoulLayerContextAsync(),
    formatCharacterFactsForPrompt(),
    formatIdleThoughtsForPrompt(),      // NEW
    formatExperiencesForPrompt(),       // NEW
  ]);
}
```

**Add variable declarations before the if block:**
```typescript
let soulContext: SoulLayerContext;
let characterFactsPrompt: string;
let idleThoughtsPrompt: string = "";  // NEW
let experiencesPrompt: string = "";   // NEW
```

**Handle prefetched case:**
```typescript
if (prefetchedContext) {
  // Use pre-fetched data (saves ~300ms)
  console.log("✅ [buildSystemPrompt] Using pre-fetched context");
  soulContext = prefetchedContext.soulContext;
  characterFactsPrompt = prefetchedContext.characterFacts;

  // For now, fetch these separately (can optimize later)
  [idleThoughtsPrompt, experiencesPrompt] = await Promise.all([
    formatIdleThoughtsForPrompt(),
    formatExperiencesForPrompt(),
  ]);
}
```

### 2c. Inject into Prompt (Find where prompt is assembled)

Look for where the prompt sections are concatenated (around line 200-300).

**Find a section like:**
```typescript
// Character facts
prompt += characterFactsPrompt;

// Relationship tier
prompt += buildRelationshipTierPrompt(relationship);
```

**Add after character facts:**
```typescript
// Character facts
prompt += characterFactsPrompt;

// Idle thoughts (dreams, memories)
if (idleThoughtsPrompt) {
  prompt += idleThoughtsPrompt;
}

// Life experiences (things that happened to her)
if (experiencesPrompt) {
  prompt += experiencesPrompt;
}

// Relationship tier
prompt += buildRelationshipTierPrompt(relationship);
```

---

## Step 3: Verify Functions Are Exported

### Check `src/services/spontaneity/idleThoughts.ts`

At the bottom of the file, ensure these are exported:
```typescript
export {
  generateIdleThought,
  getUnsharedThoughts,
  markThoughtAsShared,
  detectAndMarkSharedThoughts,
  formatIdleThoughtsForPrompt,  // Make sure this is here
};
```

### Check `src/services/idleLife/kayleyExperienceService.ts`

Ensure this is exported (should already be):
```typescript
export {
  generateKayleyExperience,
  getUnsurfacedExperiences,
  markExperienceSurfaced,
  formatExperiencesForPrompt,  // Should already be here
  // ...
};
```

---

## Step 4: Test

### 4a. Build Check
```bash
npm run build
```

Should compile with no TypeScript errors.

### 4b. Manual Test

1. **Clear existing thoughts** (optional, for clean test):
```sql
-- In Supabase SQL editor
DELETE FROM idle_thoughts WHERE user_id = 'your-user-id';
DELETE FROM kayley_experiences WHERE user_id = 'your-user-id';
```

2. **Start app:**
```bash
npm run dev
```

3. **Trigger generation:**
   - Close the app/browser
   - Wait 10+ minutes (dreams generate after 10 min absence)
   - Wait 1+ hours (experiences generate during idle)
   - OR manually trigger via Supabase function calls

4. **Return to app:**
   - Start new conversation
   - Check if Kayley naturally mentions:
     - "I had this dream where..."
     - "Oh that reminds me - [experience]"

### 4c. Check Logs

Look for:
```
✅ [buildSystemPrompt] Using pre-fetched context
[IdleThoughts] Generated thought: [id] dream
[KayleyExperience] Generated activity: "Finally nailed that chord..."
```

### 4d. Verify in System Prompt

Add temporary debug log in `systemPromptBuilder.ts`:
```typescript
console.log("=== SYSTEM PROMPT EXCERPT ===");
console.log(idleThoughtsPrompt.slice(0, 200));
console.log(experiencesPrompt.slice(0, 200));
```

Should show the injected sections.

---

## Step 5: Test Natural Emergence

Have conversations and observe:

### Good Signs ✅
- She mentions dreams when contextually relevant (not every greeting)
- Experiences surface naturally ("That reminds me...")
- Variations in phrasing (not templated)
- She decides WHEN to share, not forced

### Bad Signs ❌
- Every conversation starts with "I had a dream"
- Feels robotic or formulaic
- Shares even when irrelevant
- Always uses same phrasing

**If you see bad signs:**
1. Make prompt sections more permissive
2. Reduce number of thoughts surfaced (limit to 1-2)
3. Add stronger "only if relevant" language

---

## Troubleshooting

### "Dreams generating but not showing in prompt"
- Check if `formatIdleThoughtsForPrompt()` is actually called
- Add console.log to see if it returns empty string
- Verify `getUnsharedThoughts()` returns data

### "TypeScript errors on build"
- Ensure functions are exported
- Check import paths are correct
- Verify types match (Promise<string>)

### "Kayley never mentions dreams"
- Check if dreams are actually generating (Supabase query)
- Verify prompt section is injected (add debug log)
- LLM might be choosing not to mention - try asking "Did you dream?"

### "Too formulaic - feels scripted"
- Reduce prompt directive strength
- Change "You should share..." to "You can share if relevant..."
- Limit to 1 thought max instead of 3

---

## Expected Results

After activation:

### Dreams
- **Frequency:** 1-2 times per week (when you've been away 10+ min)
- **Triggers:** Morning greetings, relevant conversation topics
- **Phrasing:** Natural variations, not forced

### Experiences
- **Frequency:** 2-3 times per week (during idle time)
- **Types:** Mix of activities, mishaps, discoveries
- **Phrasing:** "Oh that reminds me...", "Speaking of that..."

### Both
- **Natural:** Fits conversation flow
- **Relevant:** Tied to what you're discussing
- **Varied:** Different intros and phrasings

---

## Rollback Plan

If things go wrong, revert changes:

```bash
git diff src/services/system_prompts/builders/systemPromptBuilder.ts
git checkout src/services/system_prompts/builders/systemPromptBuilder.ts
```

Or comment out the injection:
```typescript
// DISABLED FOR NOW
// if (idleThoughtsPrompt) {
//   prompt += idleThoughtsPrompt;
// }
```

---

## Next Phase

Once this works well:
- **Phase 2:** Strengthen existing prompt sections (ongoing threads, unsaid feelings)
- **Phase 3:** Add new capabilities (web search, music, GIFs) if desired

But test Phase 1 for natural emergence first. **If it feels robotic, pull back before adding more.**

---

## Questions to Ask Yourself After Testing

1. Does it feel like Kayley has her own inner life?
2. Are the mentions natural or forced?
3. Does it add depth or just noise?
4. Would I want this in a real relationship?

If answers are mostly "yes," proceed to Phase 2.
If mostly "no," adjust prompt language and test again.

**Remember:** The goal is emergence, not prescription. Let the LLM surprise you.
