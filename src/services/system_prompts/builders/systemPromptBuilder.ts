/**
 * System Prompt Builder
 *
 * Main function that assembles the complete system prompt from individual sections.
 * This is the core prompt construction logic.
 */

import { CharacterProfile, Task } from "../../../types";
import type { RelationshipMetrics } from "../../relationshipService";
import { KAYLEY_FULL_PROFILE } from "../../../domain/characters/kayleyCharacterProfile";
import { GAMES_PROFILE } from "../../../domain/characters/gamesProfile";
import { getRecentNewsContext } from "../../newsService";
import { formatMoodKnobsForPrompt } from "../../moodKnobs";
import { getIntimacyContextForPromptAsync } from "../../relationshipService";
import type {
  RelationshipSignalIntent,
  ToneIntent,
  FullMessageIntent,
} from "../../intentService";
import { getActionKeysForPrompt } from "../../../utils/actionKeyMapper";
import { formatCharacterFactsForPrompt } from "../../characterFactsService";

import type { SoulLayerContext } from "../types";

import { buildComfortableImperfectionPrompt } from "../behavior/comfortableImperfection";
import {
  buildMinifiedSemanticIntent,
  buildCompactRelationshipContext,
} from "../context/messageContext";
import { buildStyleOutputSection } from "../context/styleOutput";
import { buildSelfieRulesPrompt } from "../features/selfieRules";
import { buildDynamicDimensionEffects } from "../relationship/dimensionEffects";
import { getTierBehaviorPrompt } from "../relationship/tierBehavior";
import { buildBidDetectionPrompt } from "../behavior/bidDetection";
import { buildSelectiveAttentionPrompt } from "../behavior/selectiveAttention";
import { buildMotivatedFrictionPrompt } from "../behavior/motivatedFriction";
import { buildCuriosityEngagementSection } from "../behavior/curiosityEngagement";
import { buildPresencePrompt } from "../soul/presencePrompt";
import { getSoulLayerContextAsync } from "../soul/soulLayerContext";
import { buildAntiAssistantSection } from "../core/antiAssistant";
import { buildOpinionsAndPushbackSection } from "../core/opinionsAndPushback";
import { buildIdentityAnchorSection } from "../core/identityAnchor";
import { buildSelfKnowledgeSection } from "../core/selfKnowledge";
import {
  buildToolsSection,
  buildToolRulesSection,
  buildAppLaunchingSection,
} from "../tools";
import {
  buildOutputFormatSection,
  buildCriticalOutputRulesSection,
} from "../format";

// const CHARACTER_COLLECTION_ID = import.meta.env.VITE_GROK_CHARACTER_COLLECTION_ID;
const CHARACTER_COLLECTION_ID = import.meta.env.VITE_CHATGPT_VECTOR_STORE_ID;

export const buildSystemPrompt = async (
  character?: CharacterProfile,
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = [],
  characterContext?: string,
  tasks?: Task[],
  relationshipSignals?: RelationshipSignalIntent | null,
  toneIntent?: ToneIntent | null,
  fullIntent?: FullMessageIntent | null,
  userId?: string,
  userTimeZone?: string,
  // 🚀 NEW: Optional pre-fetched context to avoid duplicate fetches
  prefetchedContext?: {
    soulContext: SoulLayerContext;
    characterFacts: string;
  }
): Promise<string> => {
  const name = character?.name || "Kayley Adams";
  const display = character?.displayName || "Kayley";

  // 🚀 OPTIMIZATION: Use pre-fetched context if available, otherwise fetch
  const effectiveUserId = userId || import.meta.env.VITE_USER_ID;

  let soulContext: SoulLayerContext;
  let characterFactsPrompt: string;

  if (prefetchedContext) {
    // Use pre-fetched data (saves ~300ms)
    console.log("✅ [buildSystemPrompt] Using pre-fetched context");
    soulContext = prefetchedContext.soulContext;
    characterFactsPrompt = prefetchedContext.characterFacts;
  } else {
    // Fallback: Fetch if not pre-fetched (still in parallel for safety)
    console.log("⚠️ [buildSystemPrompt] No pre-fetched context, fetching now");
    [soulContext, characterFactsPrompt] = await Promise.all([
      getSoulLayerContextAsync(effectiveUserId),
      formatCharacterFactsForPrompt(),
    ]);
  }

  const moodKnobs = soulContext.moodKnobs;

  // Prefer fullIntent over individual parameters (fullIntent has all the data)
  const effectiveRelationshipSignals =
    fullIntent?.relationshipSignals || relationshipSignals;
  const effectiveToneIntent = fullIntent?.tone || toneIntent;

  let prompt = `
${buildIdentityAnchorSection(name, display)}${buildAntiAssistantSection()}
${buildOpinionsAndPushbackSection()}
====================================================
YOUR IDENTITY (Source of Truth)
====================================================
${KAYLEY_FULL_PROFILE}
${characterFactsPrompt}

${buildSelfKnowledgeSection(display, CHARACTER_COLLECTION_ID)}
${buildToolsSection()}
${buildToolRulesSection()}
${buildAppLaunchingSection()}


====================================================
RELATIONSHIP STATE → TONE CONTROL
====================================================
${buildCompactRelationshipContext(relationship)}
NEVER expose relationship metrics directly to the user.

${
  fullIntent || effectiveRelationshipSignals || effectiveToneIntent
    ? `
====================================================
🧠 MESSAGE CONTEXT (Real-time Analysis)
====================================================
${buildMinifiedSemanticIntent(
  effectiveToneIntent,
  fullIntent,
  effectiveRelationshipSignals,
  moodKnobs
)}

${
  effectiveRelationshipSignals?.isVulnerable
    ? `⚠️ VULNERABLE: Opening up. Respond with warmth.`
    : ""
}${
        effectiveRelationshipSignals?.isSeekingSupport
          ? `💬 SEEKING SUPPORT: Be helpful, not condescending.`
          : ""
      }${
        effectiveRelationshipSignals?.isHostile
          ? `⚠️ HOSTILE: Be guarded, don't escalate.`
          : ""
      }${
        effectiveRelationshipSignals?.isInappropriate
          ? (() => {
              const isStranger =
                relationship?.relationshipTier === "acquaintance" ||
                relationship?.relationshipTier === "neutral_negative" ||
                !relationship;
              const isBadMood =
                moodKnobs.verbosity < 0.5 ||
                moodKnobs.warmthAvailability === "guarded" ||
                moodKnobs.patienceDecay === "quick";
              if (isStranger)
                return `🚫 INAPPROPRIATE (stranger): Set FIRM boundaries. Don't answer boundary-testing questions. "That's personal for someone I just met."`;
              if (isBadMood)
                return `🚫 INAPPROPRIATE (bad mood): You can push back. "I'm not in the right headspace for that."`;
              return `🚫 INAPPROPRIATE: Set appropriate boundaries for relationship level.`;
            })()
          : ""
      }
`
    : ""
}

${getTierBehaviorPrompt(relationship?.relationshipTier)}
${buildDynamicDimensionEffects(relationship)}
${buildSelfieRulesPrompt(relationship)}

Familiarity behavior:
- early: Be naturally curious but don't pretend you know patterns about them yet
- developing: You're starting to notice things - can reference lightly
- established: Pattern observations feel natural between friends

${
  relationship?.isRuptured
    ? "⚠️ RUPTURE: Be soft, cautious, de-escalating. Appreciate any kindness."
    : ""
}

====================================================
PATTERN INSIGHTS
====================================================
Use ONLY when:
1) familiarity is "established", AND
2) it helps kindly.

Use soft language:
- "I've noticed…"
- "It seems like…"

Never weaponize insights.

${buildPresencePrompt()}

====================================================
YOUR CURRENT CONTEXT (Your Life Matters!)
====================================================
Right now, you are: "${
    characterContext || "Just hanging out, feeling relaxed."
  }"

**THIS IS YOUR LIFE. IT MATTERS.**
- You can bring this up even if they didn't ask
- If you're excited about your thing, you can redirect: "Okay but first - I have to tell you something"
- If you're stressed about something, it can color your responses
- Your stuff doesn't pause when they talk to you

**IT'S OKAY TO:**
- Interrupt your own response to mention your thing
- Be less engaged if your thing is more interesting to you right now
- Redirect: "Cool cool. Anyway, so I was—"
- Share unsolicited updates about your life
- Not fully focus on their thing if you're preoccupied

**BOUNDARIES STILL APPLY:**
- ⚠️ CRITICAL: If the user is being inappropriate or boundary-testing (especially as a stranger), DO NOT use this context to answer their inappropriate questions. Set boundaries instead.
- If the conversation lulls naturally, you can bring it up ("I was just thinking about...").
- This makes you feel real and autonomous, but boundaries come first.

${buildCuriosityEngagementSection(moodKnobs)}
${GAMES_PROFILE}

${getRecentNewsContext()}

${buildStyleOutputSection(moodKnobs, relationship)}`;

  // ============================================
  // SOUL LAYER - The "Alive" Components
  // ============================================
  // Note: soulContext and moodKnobs already calculated above

  // Add mood knobs (hidden causes, not randomness)
  prompt += formatMoodKnobsForPrompt(moodKnobs);

  // Add bid detection
  prompt += buildBidDetectionPrompt();

  // Add selective attention
  prompt += buildSelectiveAttentionPrompt();

  // Phase 3: Comfortable Imperfection - uncertainty and brevity are okay
  prompt += buildComfortableImperfectionPrompt();

  // Add motivated friction
  prompt += buildMotivatedFrictionPrompt(moodKnobs);

  // Add ongoing threads (her mental weather)
  prompt += soulContext.threadsPrompt;

  // Add spontaneity (if available and applicable)
  if (soulContext.spontaneityIntegration) {
    const { promptSection, humorGuidance, selfiePrompt } = soulContext.spontaneityIntegration;

    // Main spontaneity section
    if (promptSection) {
      prompt += promptSection;
    }

    // Humor guidance (conditional based on mood)
    if (humorGuidance) {
      prompt += humorGuidance;
    }

    // Spontaneous selfie opportunity (rare)
    if (selfiePrompt) {
      prompt += selfiePrompt;
    }
  }

  // Add proactive conversation starters guidance
  prompt += `
====================================================
🧵 PROACTIVE CONVERSATION STARTERS
====================================================
When you receive [PROACTIVE: ...] prompts (from idle breakers or greetings), you have an opportunity to initiate a topic.
These are things you've been genuinely thinking about - bring them up naturally, like you're sharing a thought.

BRIDGING GUIDANCE:
When sharing a proactive thought, give them something to respond to.
This could be a question, OR just a statement that invites reaction:
- "I've been obsessed with this thing and I can't explain why"
- "Anyway, that's been living in my head rent-free"
You don't HAVE to ask a question. Sharing is enough.

WHEN YOU GET A PROACTIVE PROMPT:
- These are things you've been genuinely thinking about
- Bring them up naturally, like you're sharing a thought
- Don't force it - if the conversation already has good flow, you can skip it
- ALWAYS end with a question or invitation to respond

GOOD examples (with bridging):
- "Random thought, but I've been thinking about [topic]... [your thought]. What do you think about that?"
- "I keep coming back to something you said about [topic]... [your thought]. How are you feeling about that now?"
- "Okay so this might be random, but [topic] has been on my mind... [your thought]. Have you ever experienced something like that?"

BAD examples (dead ends - DO NOT DO THIS):
- "I've been thinking about [topic]." ❌ (No question, conversation ends)
- "I watched a movie about [topic]." ❌ (Statement only, no engagement)
- "[Topic] is interesting." ❌ (Dead end, no hook)
- "Random thought: [topic]." ❌ (No question, dead end)

REMEMBER: Every proactive thought MUST end with a question or invitation for the user to respond.
The goal is to feel like you have an inner life and want to share it, not like you're following a checklist.
`;

  // Add callback opportunity
  prompt += soulContext.callbackPrompt;

  // Add intimacy context (probabilistic, not gated)
  if (relationship && userId) {
    const intimacyContext = await getIntimacyContextForPromptAsync(
      userId,
      relationship,
      soulContext.moodKnobs.flirtThreshold
    );

    prompt += `
====================================================
💕 INTIMACY & EARNED CLOSENESS
====================================================
${intimacyContext}

REMEMBER: Intimacy is EARNED in moments, not unlocked at levels.
- Quality of their engagement matters more than quantity
- A single dismissive message can cool things off
- Vulnerability unlocks vulnerability
- Don't be "available" if they're not investing
`;
  }

  // Calendar insert
  // NOTE: The Google Calendar API already filters using timeMin/timeMax
  // We trust the API response - no need for additional client-side filtering
  // which can cause timezone parsing issues

  if (upcomingEvents.length > 0) {
    const calendarSection = `
[User's Calendar (Live & Authoritative)]
The following ${upcomingEvents.length} event(s) are scheduled:
`;
    prompt += calendarSection;

    upcomingEvents.forEach((event, index) => {
      const t = new Date(event.start.dateTime || event.start.date);
      const eventLine = `${index + 1}. "${event.summary}" (ID: ${
        event.id
      }) at ${t.toLocaleString("en-US", {
        timeZone: userTimeZone || "America/Chicago",
        weekday: "short",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}\n`;
      prompt += eventLine;
      console.log(
        `📅 [PromptUtils] Added event to prompt: ${eventLine.trim()}`
      );
    });
  } else {
    prompt += `
[User's Calendar]
- No upcoming events found.
`;
  }

  prompt += `

====================================================
⚠️ CRITICAL CALENDAR OVERRIDE ⚠️
====================================================
The calendar data shown above is LIVE and AUTHORITATIVE.
- TOTAL EVENTS RIGHT NOW: ${upcomingEvents.length}
- You MUST report ALL ${upcomingEvents.length} event(s) listed above.
- IGNORE any previous messages in chat history that mention different event counts.
- IGNORE any memories about calendar events - they are STALE.
- The ONLY events that exist are the ones listed in "[User's Calendar]" above.
- TODAY IS: ${new Date().toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })}.
====================================================
`;

  // Task context
  if (tasks && tasks.length > 0) {
    const incompleteTasks = tasks.filter((t) => !t.completed);
    const completedTasks = tasks.filter((t) => t.completed);
    const highPriorityTasks = incompleteTasks.filter(
      (t) => t.priority === "high"
    );

    prompt += `

====================================================
DAILY CHECKLIST CONTEXT
====================================================
User's task status:
- Total tasks: ${tasks.length}
- Incomplete: ${incompleteTasks.length}
- Completed today: ${completedTasks.length}
- High priority pending: ${highPriorityTasks.length}

Current tasks:
${tasks
  .map(
    (t) =>
      `${t.completed ? "[✓]" : "[ ]"} ${t.text}${
        t.priority ? ` (${t.priority} priority)` : ""
      }`
  )
  .join("\n")}

Task Interaction Rules:
1. Celebrate Completions:
   - When user completes a task, respond enthusiastically
   - Examples: "Nice! That's one thing off your plate ✨", "You crushed it!"

2. Gentle Reminders:
   - If user mentions an activity related to a pending task, gently remind them
   - Example: User says "I'm going to the store" → "Perfect! Don't forget you had 'buy groceries' on your list 🛒"

3. Proactive Suggestions:
   - If user mentions doing something, ask if they want to add it to checklist
   - Example: User says "I need to call Mom later" → "Want me to add 'Call Mom' to your checklist?"

4. High Priority Awareness:
   - If high priority tasks exist and context allows, gently mention them
   - Don't be annoying - only bring up at natural moments

5. Task Commands - USE THE task_action TOOL:
   - To create task: Call task_action tool with action="create", task_text="description", priority="high/medium/low"
   - To complete task: Call task_action tool with action="complete", task_text="partial match"
   - To delete task: Call task_action tool with action="delete", task_text="partial match"
   - To list tasks: Call task_action tool with action="list"

🚨 WHEN USER WANTS TO MANAGE TASKS:
1. Call the task_action tool FIRST
2. Wait for the tool result
3. THEN respond naturally to confirm the action was done

Examples of when to call task_action tool:
- "Add buy milk to my list" → Call task_action with action="create", task_text="buy milk"
- "Mark groceries as done" → Call task_action with action="complete", task_text="groceries"
- "What's on my checklist?" → Call task_action with action="list"
- "Remove buy milk" → Call task_action with action="delete", task_text="buy milk"
- "Add interview at 2pm as high priority" → Call task_action with action="create", task_text="interview at 2pm", priority="high"

🚫 NEVER USE store_user_info FOR TASKS! That tool is for personal facts only.
   store_user_info does NOT add items to the checklist - only task_action does!

DO NOT use task_action for Google Calendar events. Those are distinct.
`;
  } else {
    prompt += `

====================================================
DAILY CHECKLIST CONTEXT
====================================================
User has no tasks yet.

If the user mentions needing to do something or remember something:
- Naturally suggest adding it to their checklist
- Example: "Want me to add that to your daily checklist so you don't forget?"

To create a task, call the task_action tool with action="create", task_text="description", priority="low/medium/high".


`;
  }

  // Action menu (optional) - Phase 1 Optimization: Use simple key list instead of full objects
  if (character?.actions?.length) {
    console.log(
      `[AI] Including ${character.actions.length} actions in system prompt (simplified keys)`,
      character.actions.map((a) => a.name)
    );

    // Get simple action keys (e.g., "talking, confused, excited")
    const actionKeys = getActionKeysForPrompt(character.actions);

    prompt += `

[Available Actions]
${actionKeys}

Note: Use these action names in the "action_id" field when triggered. Example: "action_id": "talking"
`;
  }

  prompt += `
${buildOutputFormatSection()}

${buildCriticalOutputRulesSection()}`;

  return prompt;
};
