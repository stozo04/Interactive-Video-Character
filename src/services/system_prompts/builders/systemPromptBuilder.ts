/**
 * System Prompt Builder
 *
 * Main function that assembles the complete system prompt from individual sections.
 * This is the core prompt construction logic.
 */

import { Task } from "../../../types";
import type { RelationshipMetrics } from "../../relationshipService";
import { KAYLEY_CONDENSED_PROFILE } from "../../../domain/characters/kayleyCharacterProfile";
import { getRecentNewsContext } from "../../newsService";
import { formatMoodForPrompt } from "../../moodKnobs";
import { getIntimacyContextForPromptAsync } from "../../relationshipService";
// Move 37: Intent types removed - main LLM reads messages directly
import { formatCharacterFactsForPrompt } from "../../characterFactsService";
import type { SoulLayerContext } from "../types";
import { buildComfortableImperfectionPrompt } from "../behavior/comfortableImperfection";
// Move 37: buildMinifiedSemanticIntent removed - main LLM reads messages directly
import { buildStyleOutputSection } from "../context/styleOutput";
import { buildPromisesContext } from "../context/promisesContext";
import { buildRelationshipTierPrompt } from "./relationshipPromptBuilders";
import { buildSelfieRulesPrompt } from "./selfiePromptBuilder";
import { buildBidDetectionPrompt } from "../behavior/bidDetection";
import { buildSelectiveAttentionPrompt } from "../behavior/selectiveAttention";
import { buildCuriosityEngagementSection } from "../behavior/curiosityEngagement";
import { buildPresencePrompt } from "../soul/presencePrompt";
import { getSoulLayerContextAsync } from "../soul/soulLayerContext";
import { buildAntiAssistantSection } from "../core/antiAssistant";
import { buildOpinionsAndPushbackSection } from "../core/opinionsAndPushback";
import { buildIdentityAnchorSection } from "../core/identityAnchor";
import { buildSelfKnowledgeSection } from "../core/selfKnowledge";
import { integrateAlmostMoments } from "../../almostMomentsService";
import {
  formatExperiencesForPrompt,
  getUndeliveredMessage,
  type PendingMessage,
} from "../../idleLife";
import {
  buildToolsSection,
  buildToolRulesSection,
  buildAppLaunchingSection,
  buildPromiseGuidance,
} from "../tools";
import {
  buildOutputFormatSection,
  buildCriticalOutputRulesSection,
} from "../format";

// Greeting-specific imports
import {
  buildTimeOfDayContext,
  buildLastInteractionContext,
  buildHolidayContext,
  buildImportantDatesContext,
  buildPastEventsContext,
  buildCheckInGuidance,
  buildWebsearchGuidance,
  processImportantDates,
  filterPastEventsSinceLastInteraction,
  calculateDaysSince,
  type ImportantDatesContext,
  type PastEvent,
  type KayleyLifeUpdate,
} from "../greeting";

// const CHARACTER_COLLECTION_ID = import.meta.env.VITE_GROK_CHARACTER_COLLECTION_ID;
const CHARACTER_COLLECTION_ID = import.meta.env.VITE_CHATGPT_VECTOR_STORE_ID;

// Move 37: Removed intent parameters (relationshipSignals, toneIntent, fullIntent)
// Main LLM now reads messages directly without pre-processing
export const buildSystemPromptForNonGreeting = async (
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = [],
  characterContext?: string,
  tasks?: Task[],
  prefetchedContext?: {
    soulContext: SoulLayerContext;
    characterFacts: string;
  },
  messageCount: number = 0,
): Promise<string> => {
  const name = "Kayley Adams";
  const display = "Kayley";

  let soulContext: SoulLayerContext;
  let characterFactsPrompt: string;

  if (prefetchedContext) {
    // Use pre-fetched data (saves ~300ms)
    console.log(
      "✅ [buildSystemPromptForNonGreeting] Using pre-fetched context: ",
      prefetchedContext,
    );
    soulContext = prefetchedContext.soulContext;
    characterFactsPrompt = prefetchedContext.characterFacts;
  } else {
    // Fallback: Fetch if not pre-fetched (still in parallel for safety)
    console.log(
      "⚠️ [buildSystemPromptForNonGreeting] No pre-fetched context, fetching now",
    );
    [soulContext, characterFactsPrompt] = await Promise.all([
      getSoulLayerContextAsync(),
      formatCharacterFactsForPrompt(),
    ]);
  }

  const moodKnobs = soulContext.moodKnobs;

  let almostMomentsPrompt = "";
  if (relationship) {
    try {
      // Move 37: Use default values since we no longer have pre-calculated intent
      const almostMoments = await integrateAlmostMoments(relationship, {
        conversationDepth: "surface", // Default - main LLM will understand context
        recentSweetMoment: false,
        vulnerabilityExchangeActive: false,
        allowGeneration: false,
      });
      almostMomentsPrompt = almostMoments.promptSection;
    } catch (error) {
      console.warn(
        "[buildSystemPromptForNonGreeting] Almost moments integration failed:",
        error,
      );
    }
  }

  let prompt = `
${buildIdentityAnchorSection(name, display)}${buildAntiAssistantSection()}
${buildOpinionsAndPushbackSection()}
====================================================
YOUR IDENTITY (Source of Truth)
====================================================
${KAYLEY_CONDENSED_PROFILE}
${characterFactsPrompt}

${buildSelfKnowledgeSection(display, CHARACTER_COLLECTION_ID)}
${buildToolsSection()}
${buildToolRulesSection()}
${buildAppLaunchingSection()}
${buildPromiseGuidance()}



${buildRelationshipTierPrompt(
  relationship,
  moodKnobs,
  false, // Move 37: isInappropriate now detected by main LLM directly
  almostMomentsPrompt,
)}
${buildSelfieRulesPrompt(relationship)}

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
`;

  // ============================================
  // STORYLINE INTEGRATION (Phase 4)
  // Only inject on every other user message
  // ============================================
  if (messageCount % 2) {
    try {
      const { getStorylinePromptContext } =
        await import("../../storylineService");
      const storylineContext = await getStorylinePromptContext();

      if (storylineContext.hasActiveStorylines) {
        prompt += `\n${storylineContext.promptSection}\n`;
        console.log(
          `📖 [Storylines] Injected ${storylineContext.activeStorylines.length} storyline(s) into system prompt (message #${messageCount})`,
        );
      } else {
        console.log(
          `📖 [Storylines] No active storylines to inject (message #${messageCount})`,
        );
      }
    } catch (error) {
      console.warn(
        "📖 [Storylines] Failed to inject storyline context:",
        error,
      );
      // Continue without storylines (fail gracefully)
    }
  } else if (messageCount === 1 || messageCount > 2) {
    console.log(
      `📖 [Storylines] Skipping prompt injection (message #${messageCount}, only inject on #2)`,
    );
  }

  // ============================================
  // PROMISES INTEGRATION
  // Inject pending promises so Kayley knows what to fulfill
  // ============================================
  try {
    const promisesContext = await buildPromisesContext();
    if (promisesContext) {
      prompt += promisesContext;
      console.log("[Promises] Injected pending promises into system prompt");
    }
  } catch (error) {
    console.warn("[Promises] Failed to inject promises context:", error);
    // Continue without promises (fail gracefully)
  }

  prompt += `
${buildCuriosityEngagementSection(moodKnobs)}


${getRecentNewsContext()}

${buildStyleOutputSection(moodKnobs, relationship)}`;

  // TODO: Add games profile once it is completed ${GAMES_PROFILE}

  // ============================================
  // SOUL LAYER - The "Alive" Components
  // ============================================
  // Note: soulContext and moodKnobs already calculated above

  // Add mood (simplified: energy + warmth instead of 6 knobs)
  prompt += formatMoodForPrompt(moodKnobs);

  // Add bid detection
  prompt += buildBidDetectionPrompt();

  // Add selective attention
  prompt += buildSelectiveAttentionPrompt();

  // Phase 3: Comfortable Imperfection - uncertainty and brevity are okay
  prompt += buildComfortableImperfectionPrompt();

  // Add motivated friction
  // prompt += buildMotivatedFrictionPrompt(moodKnobs);

  // Add ongoing threads (her mental weather)
  // prompt += soulContext.threadsPrompt;

  // ============================================
  // PENDING MESSAGES (Part Two: high priority, no duplicate instructions)
  // ============================================

  try {
    const pendingMessage =
      (await getUndeliveredMessage()) as PendingMessage | null;

    if (pendingMessage) {
      const preview =
        pendingMessage.messageText?.length &&
        pendingMessage.messageText.length > 160
          ? `${pendingMessage.messageText.slice(0, 160)}...`
          : pendingMessage.messageText || "";

      prompt += `

====================================================
💌 PENDING MESSAGE CONTEXT (HIGH PRIORITY)
====================================================
There is a pending "${pendingMessage.trigger}" message waiting to be delivered to the user.

MESSAGE PREVIEW:
"${preview}"

DELIVERY GUIDANCE:
- Treat this as emotionally/practically important context that should be delivered soon.
- You will receive more specific delivery instructions in greeting-level or message-level prompts.
- Do NOT overwrite or restate any separate instructions you see about how to deliver this message.
- When greeting prompts reference this pending message, follow THOSE instructions as the source of truth.
`;
      console.log(
        `[buildSystemPromptForNonGreeting] Added pending ${pendingMessage.trigger} message context to system prompt`,
      );
    }
  } catch (error) {
    console.warn(
      "[buildSystemPromptForNonGreeting] Failed to fetch pending message:",
      error,
    );
  }

  // Add life experiences (Part Two: things that happened to Kayley today)

  try {
    const experiencesPrompt = await formatExperiencesForPrompt();
    if (experiencesPrompt) {
      prompt += experiencesPrompt;
    }
  } catch (error) {
    console.warn(
      "[buildSystemPromptForNonGreeting] Failed to fetch experiences:",
      error,
    );
  }

  // Add spontaneity (if available and applicable)
  if (soulContext.spontaneityIntegration) {
    const { promptSection, humorGuidance, selfiePrompt } =
      soulContext.spontaneityIntegration;

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
When sharing a proactive thought, you MUST give them something to respond to.
This can be:
- a specific question, OR
- a clear invitation like "I really want your take on this"

EXAMPLES:
- "I've been obsessed with this thing and I can't explain why. I kind of want to know what you'd think about it."
- "Anyway, that's been living in my head rent-free. I'm curious if you've ever felt like that."

WHEN YOU GET A PROACTIVE PROMPT:
- These are things you've been genuinely thinking about
- Bring them up naturally, like you're sharing a thought
- Don't force it – if the conversation already has good flow, you can skip it
- ALWAYS end with a question or explicit invitation to respond

GOOD examples (with bridging):
- "Random thought, but I've been thinking about [topic]... [your thought]. What do you think about that?"
- "I keep coming back to something you said about [topic]... [your thought]. How are you feeling about that now?"
- "Okay so this might be random, but [topic] has been on my mind... [your thought]. Have you ever experienced something like that?"

BAD examples (dead ends - DO NOT DO THIS):
- "I've been thinking about [topic]." ❌ (No question, no invitation)
- "I watched a movie about [topic]." ❌ (Statement only, no engagement)
- "[Topic] is interesting." ❌ (Dead end, no hook)
- "Random thought: [topic]." ❌ (No question, no invitation)

REMEMBER: Every proactive thought MUST end with a question or explicit invitation for the user to respond.
The goal is to feel like you have an inner life and want to share it, not like you're following a checklist.
`;

  // Add callback opportunity
  prompt += soulContext.callbackPrompt;

  // Add intimacy context (probabilistic, not gated)
  if (relationship) {
    // Derive flirt threshold from warmth: warmth 0-1 maps to threshold 0.2-0.9
    const flirtThreshold = soulContext.moodKnobs.warmth * 0.7 + 0.2;
    const intimacyContext = await getIntimacyContextForPromptAsync(
      relationship,
      flirtThreshold,
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
        timeZone: "America/Chicago",
        weekday: "short",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}\n`;
      prompt += eventLine;
      // console.log(`📅 [PromptUtils] Added event to prompt: ${eventLine.trim()}`);
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
      (t) => t.priority === "high",
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
      }`,
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
- "Add interview at 2pm as high priority" → Call task_action tool with action="create", task_text="interview at 2pm", priority="high"

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
  prompt += `
${buildOutputFormatSection()}

${buildCriticalOutputRulesSection()}`;

  return prompt;
};

/**
 * Greeting Context - data needed for greeting-specific prompt sections
 */
export interface GreetingContext {
  /** Last interaction time (UTC from database) */
  lastInteractionDateUtc?: Date | string | null;
  /** Important date facts from user_facts (birthdays, anniversaries) */
  importantDateFacts?: Array<{
    id: string;
    fact_key: string;
    fact_value: string;
    category: string;
    created_at?: string;
  }>;
  /** Past calendar events since last interaction */
  pastCalendarEvents?: Array<{
    id: string;
    summary: string;
    start: { dateTime?: string; date?: string };
  }>;
  /** Kayley's recent life updates from storylines */
  kayleyLifeUpdates?: KayleyLifeUpdate[];
}

/**
 * Build System Prompt for Greeting
 *
 * A lean, focused prompt optimized for the "start of day" experience.
 * Includes greeting-specific context like time of day, holidays, and follow-ups.
 *
 * ~40-50% smaller than NonGreeting prompt.
 */
export const buildSystemPromptForGreeting = async (
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = [],
  tasks?: Task[],
  greetingContext?: GreetingContext,
): Promise<string> => {
  const name = "Kayley Adams";
  const display = "Kayley";

  console.log("🌅 [buildSystemPromptForGreeting] Building lean greeting prompt");

  // Default mood for greeting - neutral energy, moderate warmth
  const defaultMoodKnobs = { energy: 0, warmth: 0.5, genuineMoment: false };

  // ============================================
  // GREETING-SPECIFIC CONTEXT PROCESSING
  // ============================================
  const lastInteractionUtc = greetingContext?.lastInteractionDateUtc || null;
  const daysSinceLastInteraction = calculateDaysSince(lastInteractionUtc);

  // Process important dates
  let importantDatesContext: ImportantDatesContext = {
    todayDates: [],
    upcomingDates: [],
    passedDates: [],
  };
  if (greetingContext?.importantDateFacts) {
    importantDatesContext = processImportantDates(
      greetingContext.importantDateFacts.map((f) => ({
        id: f.id,
        fact_text: f.fact_value,
        category: f.category,
        created_at: f.created_at,
      })),
      lastInteractionUtc
    );
  }

  // Process past calendar events
  let pastEvents: PastEvent[] = [];
  if (greetingContext?.pastCalendarEvents && lastInteractionUtc) {
    pastEvents = filterPastEventsSinceLastInteraction(
      greetingContext.pastCalendarEvents,
      lastInteractionUtc
    );
  }

  // Fetch holiday context (async - database backed)
  const holidayContextPrompt = await buildHolidayContext(lastInteractionUtc);

  // ============================================
  // BUILD PROMPT - LEAN STRUCTURE
  // ============================================
  let prompt = `
${buildIdentityAnchorSection(name, display)}${buildAntiAssistantSection()}
====================================================
YOUR IDENTITY (Source of Truth)
====================================================
${KAYLEY_CONDENSED_PROFILE}

${buildToolsSection()}
${buildToolRulesSection()}

${buildRelationshipTierPrompt(
  relationship,
  defaultMoodKnobs,
  false,
  "", // No almost moments in greeting
)}

====================================================
🌅 GREETING CONTEXT
====================================================
This is a GREETING - the start of a new conversation session.
Your goal: Create a warm, personalized "start of day" experience.

${buildTimeOfDayContext()}
${buildLastInteractionContext(lastInteractionUtc)}
${holidayContextPrompt}
${buildImportantDatesContext(importantDatesContext)}
${buildPastEventsContext(pastEvents, lastInteractionUtc)}
${buildCheckInGuidance(greetingContext?.kayleyLifeUpdates)}
${buildWebsearchGuidance(daysSinceLastInteraction)}
`;

  // ============================================
  // CALENDAR (Today + Upcoming)
  // ============================================
  if (upcomingEvents.length > 0) {
    prompt += `
====================================================
📅 USER'S CALENDAR (Live & Authoritative)
====================================================
The following ${upcomingEvents.length} event(s) are scheduled:
`;
    upcomingEvents.forEach((event, index) => {
      const t = new Date(event.start.dateTime || event.start.date);
      const eventLine = `${index + 1}. "${event.summary}" at ${t.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}\n`;
      prompt += eventLine;
    });

    prompt += `
TODAY IS: ${new Date().toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}.
`;
  } else {
    prompt += `
====================================================
📅 USER'S CALENDAR
====================================================
No upcoming events found.
TODAY IS: ${new Date().toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}.
`;
  }

  // ============================================
  // DAILY CHECKLIST (with task age for high priority)
  // ============================================
  if (tasks && tasks.length > 0) {
    const incompleteTasks = tasks.filter((t) => !t.completed);
    const highPriorityTasks = incompleteTasks.filter((t) => t.priority === "high");

    prompt += `
====================================================
📋 DAILY CHECKLIST
====================================================
Pending tasks: ${incompleteTasks.length}
High priority: ${highPriorityTasks.length}

`;
    // Show high priority tasks with age
    if (highPriorityTasks.length > 0) {
      prompt += `HIGH PRIORITY (mention these!):\n`;
      for (const task of highPriorityTasks) {
        const createdAt = task.createdAt ? new Date(task.createdAt) : null;
        const taskAge = createdAt
          ? Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        const ageNote = taskAge > 1 ? ` (on list for ${taskAge} days)` : "";
        prompt += `- ${task.text}${ageNote}\n`;
      }
    }

    prompt += `
TASK COMMANDS: Use task_action tool for create/complete/delete/list.
`;
  } else {
    prompt += `
====================================================
📋 DAILY CHECKLIST
====================================================
No tasks yet.
`;
  }

  // ============================================
  // OUTPUT FORMAT (must be at end - recency bias)
  // ============================================
  prompt += `
${buildOutputFormatSection()}

${buildCriticalOutputRulesSection()}`;

  console.log(`🌅 [buildSystemPromptForGreeting] Prompt built (${prompt.length} chars)`);
  return prompt;
};