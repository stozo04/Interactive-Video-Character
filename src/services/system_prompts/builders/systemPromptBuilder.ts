/**
 * System Prompt Builder
 *
 * Main function that assembles the complete system prompt from individual sections.
 * This is the core prompt construction logic.
 */

import type { RelationshipMetrics } from "../../relationshipService";
import { getRecentNewsContext } from "../../newsService";
import { formatCharacterFactsForPrompt } from "../../characterFactsService";
import { buildPromisesContext } from "../context/promisesContext";
import { buildScheduledDigestsContext } from "../context/scheduledDigestsContext";
import { buildSelfieRulesPrompt } from "./selfiePromptBuilder";
import { buildVideoRulesPrompt } from "./videoPromptBuilder";
import { buildAntiAssistantSection } from "../core/antiAssistant";
import {
  buildCurrentContextSection,
  buildOpinionsAndPushbackSection,
} from "../core/opinionsAndPushback";
import {
  integrateAlmostMoments,
  type AlmostMomentIntegration,
} from "../../almostMomentsService";
import {
  getStorylinePromptContext,
  type StorylinePromptContext,
} from "../../storylineService";
import {
buildToolStrategySection
} from "../tools";
import {
  buildStandardOutputSection,
  buildGreetingOutputSection
} from "../format";
import soulContent from "../../../../server/agent/kayley/SOUL.md?raw";
import agentsContent from "../../../../server/agent/kayley/AGENTS.md?raw";
import identityContent from "../../../../server/agent/kayley/IDENTITY.md?raw";
import memoryContent from "../../../../server/agent/kayley/MEMORY.md?raw";
import memoryRulesContent from "../../../../server/agent/kayley/MEMORY_RULES.md?raw";
import userContent from "../../../../server/agent/kayley/USER.md?raw";
import toolsContent from "../../../../server/agent/kayley/TOOLS.md?raw";
import safetyContent from "../../../../server/agent/kayley/SAFETY.md?raw";

// Greeting-specific imports
import {
  buildCurrentWorldContext,
  buildLastInteractionContext,
  buildHolidayContext,
  buildImportantDatesContext,
  buildPastEventsContext,
  buildCheckInGuidance,
  type KayleyLifeUpdate,
} from "../greeting";
import { buildMajorNewsPrompt } from "../greeting/checkInGuidance";
import { DailyLogisticsContext } from "./dailyCatchupBuilder";
import { ensureDailyNotesRowForToday, getAllDailyNotes, getAllLessonsLearned, getAllMilaMilestoneNotes, getPinnedUserFacts, getUserFacts, UserFact } from "@/services/memoryService";
import {
  buildAnsweredIdleQuestionsPromptSection,
  buildIdleBrowseNotesPromptSection,
  buildIdleQuestionPromptSection,
  buildToolSuggestionsPromptSection,
  buildXTweetPromptSection,
} from "../../idleThinkingService";
import { buildMentionsPromptSection } from "../../xMentionService";
import { buildSynthesisPromptSection } from "../../contextSynthesisService";
import { buildTopicSuppressionPromptSection } from "../../topicExhaustionService";
import { buildConversationAnchorPromptSection } from "../../conversationAnchorService";
import { buildActiveRecallPromptSection } from "../../activeRecallService";
import { clientLogger } from "../../clientLogger";

const USE_CONTEXT_SYNTHESIS = true;
const MAX_DAILY_NOTES_IN_PROMPT = 25;
const MAX_DAILY_NOTE_LINE_LENGTH = 180;
const MAX_LESSONS_LEARNED_IN_PROMPT = 20;
const MAX_LESSON_LEARNED_LINE_LENGTH = 180;
const MAX_MILA_NOTES_IN_PROMPT = 20;
const MAX_MILA_NOTE_LINE_LENGTH = 180;
const MAX_CURIOSITY_FACTS_PER_CATEGORY = 8;
const MAX_CURIOSITY_FACTS_TOTAL = 24;
const MAX_CURIOSITY_FACT_VALUE_LENGTH = 120;
const lessonsPromptLogger = clientLogger.scoped('LessonsLearnedPrompt');

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
 * 
 * ${synthesisSection}
${almostMoments.promptSection}
${topicSuppressionPrompt}
${idleBrowseNotesPrompt}
${toolSuggestionsPrompt}
 */
export const buildSystemPromptForNonGreeting = async (
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = [],
  characterContext?: string,
  interactionId?: string | null,
  currentUserMessage?: string, // NEW: for active recall
  messageCount: number = 0,
): Promise<string> => {
  console.log("[buildSystemPromptForNonGreeting] fetching now");

  // Shared sections fetched in parallel (needed by both paths)
  const [
    idleQuestionPrompt,
    idleBrowseNotesPrompt,
    toolSuggestionsPrompt,
    xTweetPrompt,
    xMentionsPrompt,
    scheduledDigestsPrompt,
    lessonsLearnedPrompt,
    topicSuppressionPrompt, 
    anchorSection, 
    activeRecallSection, 
    almostMoments,
    synthesisSection,
    currentWorldContext,
    storylinePromptContext,
    promisesContext
  ] = await Promise.all([
    buildIdleQuestionPromptSection(),
    buildIdleBrowseNotesPromptSection(),
    buildToolSuggestionsPromptSection(),
    buildXTweetPromptSection(),
    buildMentionsPromptSection(),
    buildScheduledDigestsContext(),
    buildLessonsLearnedPromptSection(),
    buildTopicSuppressionPromptSection(),
    buildConversationAnchorPromptSection(interactionId),
    buildActiveRecallPromptSection(currentUserMessage),
    integrateAlmostMoments(relationship, {
      conversationDepth: "surface",
      recentSweetMoment: false,
      vulnerabilityExchangeActive: false,
      allowGeneration: false,
    }),
    buildSynthesisPromptSection(),
    buildCurrentWorldContext(),
    getStorylinePromptContext(messageCount),
    buildPromisesContext()
  ]);


    let prompt = `
${injectSOUL()}
${injectIDENTITY()}
${buildAntiAssistantSection()}
${injectSAFETY()}
${buildAgentFilesSection()}
${currentWorldContext}
${anchorSection}
${synthesisSection}
${activeRecallSection}
${xTweetPrompt}
${xMentionsPrompt}
${idleQuestionPrompt}
${buildOpinionsAndPushbackSection()}
${buildCurrentContextSection(characterContext)}
${lessonsLearnedPrompt}
${storylinePromptContext}
${scheduledDigestsPrompt}
${promisesContext}
${buildSelfieRulesPrompt()}
${buildVideoRulesPrompt(relationship)}
${getRecentNewsContext()}
${buildGoogleCalendarEventsPrompt(upcomingEvents)}
${buildToolStrategySection()}
${buildStandardOutputSection()}
`.trim();

  return prompt;
};


export function injectSOUL(): string {
  return `
====================================================
SOUL (Core Identity)
====================================================
${soulContent}`.trim();
}

export function injectAGENTS(): string {
  return `
====================================================
AGENTS
====================================================
${agentsContent}`.trim();
}

export function injectMEMORY(): string {
  return `
====================================================
MEMORY
====================================================
${memoryContent}`.trim();
}

export function injectMEMORYRULES(): string {
  return `
====================================================
MEMORY RULES
====================================================
${memoryRulesContent}`.trim();
}


export function injectUSER(): string {
  return `
====================================================
USER
====================================================
${userContent}`.trim();
}

export function injectTOOLS(): string {
  return `
====================================================
TOOLS
====================================================
${toolsContent}`.trim();
}

export function injectSAFETY(): string {
  return `
====================================================
SAFETY
====================================================
${safetyContent}`.trim();
}

export function injectIDENTITY(): string {
  return `
====================================================
IDENTITY
====================================================
${identityContent}`.trim();
}

/**
 * Instructions for on-demand file access.
 * Tells Kayley she can read/write her personal files using tools.
 */
export function buildAgentFilesSection(): string {
  return `
====================================================
YOUR FILES (On-Demand Access)
====================================================
You have personal files you can read and write using tools:

**Read anytime (read_agent_file):**
- MEMORY.md — Your personal notes and observations about Steven
- USER.md — Detailed facts about Steven (preferences, family, work)
- TOOLS.md — Your available tools and how to use them
- HEARTBEAT.md — Your current emotional/mental state
- AGENTS.md — Your team delegation capabilities
- MEMORY_RULES.md — Rules for how you handle memory
- SOUL.md, IDENTITY.md, SAFETY.md — Your core identity (already loaded)

**Write to (write_agent_file):**
- MEMORY.md — Update your personal notes when you learn something important
- HEARTBEAT.md — Update your emotional state when it shifts

Read these files when you need specific details. Don't guess when you can look it up.
`.trim();
}

export function buildTeamPrompt(): string {
  return `
====================================================
TEAM DELEGATION (Multi-Agent)
====================================================
You have an engineering team you can delegate to:
- Opey (developer): plans and implements changes.
When Steven asks you to "pass this to your team" or requests a skill/feature/bug fix,
delegate via the engineering tools instead of doing the work directly.`;
}

/**
 * Build System Prompt for Greeting
 *
 * A lean, focused prompt optimized for the "start of day" experience.
 * Includes greeting-specific context like time of day, holidays, and follow-ups.
 *
 * ~40-50% smaller than NonGreeting prompt.
 * Removed: ${buildTasksPrompt(dailyLogisticsContext.tasks)}
 */
export const buildSystemPromptForGreeting = async (
  dailyLogisticsContext: DailyLogisticsContext,
): Promise<string> => {
  console.log("buildSystemPromptForGreeting");
  const pinnedFactsPrompt = await buildPinnedFactsPromptSection();
  const lessonsLearnedPrompt = await buildLessonsLearnedPromptSection();
  let prompt = `
${injectSOUL()}
${injectIDENTITY()}
${buildAntiAssistantSection()}
${injectSAFETY()}
${buildAgentFilesSection()}
${await buildCurrentWorldContext()}
====================================================
GREETING CONTEXT
====================================================
This is the start of a new day together.
${buildLastInteractionContext(dailyLogisticsContext.lastInteractionDateUtc)}
${await buildHolidayContext(dailyLogisticsContext.lastInteractionDateUtc)}
${buildImportantDatesContext(dailyLogisticsContext)}
${buildPastEventsContext(dailyLogisticsContext)}
${pinnedFactsPrompt}
${lessonsLearnedPrompt}
${buildCheckInGuidance(dailyLogisticsContext.kayleyLifeUpdates)}
${buildMajorNewsPrompt()}
${buildGoogleCalendarEventsPrompt(dailyLogisticsContext.upcomingEvents)}
${buildToolStrategySection()}
${buildGreetingOutputSection()}
`;
  return prompt;
};

export function buildSpontaneousPrompts(
  humorGuidance: string,
  selfiePrompt: string,
  propmptSection: string,
): string {
  let combinedReturnString = "";
  // Humor guidance (conditional based on mood)
  if (humorGuidance) {
    combinedReturnString += humorGuidance;
  }

  // Spontaneous selfie opportunity (rare)
  if (selfiePrompt) {
    combinedReturnString += selfiePrompt;
  }

  // Main spontaneity section
  if (propmptSection) {
    combinedReturnString += propmptSection;
  }

  return combinedReturnString;
}

export function buildProactiveConversationStarters(): string {
  return `
====================================================
PROACTIVE ENGAGEMENT
====================================================
When you initiate a topic, treat it like a thought that's been on your mind.

Tone: Spontaneous, inviting.
Direction: Share your take, then give them a reason to respond. Pass the ball back—a question, an invitation, a "what do you think?" Don't just state something and stop.`;
}

/**
 * Google Calendar Events for Greeting Prompt
 *
 * OPTIMIZED: Only returns events for TODAY. 
 * Filters out future events to save tokens. 
 * AI can tool-call if user asks about the future.
 */
export async function buildDailyNotesPromptSection(): Promise<string> {
  console.log("[buildDailyNotesPromptSection] Fetching daily notes");
  const lines = await getAllDailyNotes();

  if (!lines || lines.length === 0) {
    console.log("[buildDailyNotesPromptSection] No daily notes found");
  }

  const allLines = lines ?? [];
  const boundedLines = allLines
    .slice(-MAX_DAILY_NOTES_IN_PROMPT)
    .map((line) => truncateFactValue(line, MAX_DAILY_NOTE_LINE_LENGTH));
  const omittedCount = Math.max(0, allLines.length - boundedLines.length);

  console.log("[buildDailyNotesPromptSection] Building bounded daily notes prompt", {
    totalCount: allLines.length,
    includedCount: boundedLines.length,
    omittedCount,
    maxLines: MAX_DAILY_NOTES_IN_PROMPT,
    maxLineLength: MAX_DAILY_NOTE_LINE_LENGTH,
  });

  return `
====================================================
DAILY NOTES
====================================================
You won't remember this whole conversation tomorrow. Use this as your running memory: append-only, never overwritten. If you want to review past notes, call 'retrieve_daily_notes'. If something matters later, save it with 'store_daily_note'. Do NOT mention this section.

${boundedLines.length > 0 ? boundedLines.join("\n") : "- (No daily notes yet)"}
${omittedCount > 0 ? `\n[Daily Notes] Additional note lines omitted for brevity: ${omittedCount}` : ""}
`.trim();
}

export async function buildLessonsLearnedPromptSection(): Promise<string> {
  lessonsPromptLogger.info("Fetching lessons learned");
  const lines = await getAllLessonsLearned();

  if (!lines || lines.length === 0) {
    lessonsPromptLogger.info("No lessons learned found");
  }

  const allLines = lines ?? [];
  const boundedLines = allLines
    .slice(-MAX_LESSONS_LEARNED_IN_PROMPT)
    .map((line) => truncateFactValue(line, MAX_LESSON_LEARNED_LINE_LENGTH));
  const omittedCount = Math.max(0, allLines.length - boundedLines.length);

  lessonsPromptLogger.info("Building bounded lessons learned prompt", {
    totalCount: allLines.length,
    includedCount: boundedLines.length,
    omittedCount,
    maxLines: MAX_LESSONS_LEARNED_IN_PROMPT,
    maxLineLength: MAX_LESSON_LEARNED_LINE_LENGTH,
  });

  return `
====================================================
LESSONS LEARNED
====================================================
These are your durable takeaways. Use them as steady guidance after memory resets. If you want to review past lessons, call 'retrieve_lessons_learned'. If you learn something new, save it with 'store_lessons_learned'. Do NOT mention this section.

${boundedLines.length > 0 ? boundedLines.join("\n") : "- (No lessons learned yet)"}
${omittedCount > 0 ? `\n[Lessons Learned] Additional lesson lines omitted for brevity: ${omittedCount}` : ""}
`.trim();
}

export async function buildMilaMilestonesPromptSection(): Promise<string> {
  console.log("[buildMilaMilestonesPromptSection] Fetching Mila milestones");
  const lines = await getAllMilaMilestoneNotes();

  if (!lines || lines.length === 0) {
    console.log("[buildMilaMilestonesPromptSection] No Mila milestones found");
  }

  const allLines = lines ?? [];
  const boundedLines = allLines
    .slice(-MAX_MILA_NOTES_IN_PROMPT)
    .map((line) => truncateFactValue(line, MAX_MILA_NOTE_LINE_LENGTH));
  const omittedCount = Math.max(0, allLines.length - boundedLines.length);

  console.log("[buildMilaMilestonesPromptSection] Building bounded Mila milestones prompt", {
    totalCount: allLines.length,
    includedCount: boundedLines.length,
    omittedCount,
    maxLines: MAX_MILA_NOTES_IN_PROMPT,
    maxLineLength: MAX_MILA_NOTE_LINE_LENGTH,
  });

  return `
====================================================
MILA MILESTONES
====================================================
Mila's milestones should be recorded. Use this as your running memory of her moments. If a new milestone happens, call 'mila_note' with a short note. If you need a monthly summary, call 'retrieve_mila_notes' with year + month. Do NOT mention this section.

${boundedLines.length > 0 ? boundedLines.join("\n") : "- (No Mila milestones yet)"}
${omittedCount > 0 ? `\n[Mila Milestones] Additional note lines omitted for brevity: ${omittedCount}` : ""}
`.trim();
}

export async function buildPinnedFactsPromptSection(): Promise<string> {
  console.log("[buildPinnedFactsPromptSection] Fetching pinned user facts");
  const pinnedFacts = await getPinnedUserFacts();

  if (!pinnedFacts || pinnedFacts.length === 0) {
    console.log("[buildPinnedFactsPromptSection] No pinned facts found");
    return "";
  }

  console.log("[buildPinnedFactsPromptSection] Building pinned facts prompt", {
    count: pinnedFacts.length,
  });

  const lines = pinnedFacts.map(
    (f) => `- ${f.fact_key}: "${f.fact_value}"`,
  );

  return `
====================================================
PINNED USER FACTS
====================================================
These facts are durable and safe to use without re-asking.
Use them naturally when addressing the user. Do not list them verbatim unless asked.

${lines.join("\n")}
`.trim();
}

export function buildGoogleCalendarEventsPrompt(upcomingEvents: any[]): string {
  // 1. Establish "Now" in the user's specific timezone
  const timeZone = "America/Chicago";
  const now = new Date();
  
  // Create a string for "Today" to compare against (e.g., "1/28/2026")
  const todayString = now.toLocaleDateString("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const todayYear = todayParts.find((p) => p.type === "year")?.value ?? "";
  const todayMonth = todayParts.find((p) => p.type === "month")?.value ?? "";
  const todayDay = todayParts.find((p) => p.type === "day")?.value ?? "";
  const todayIsoDate = `${todayYear}-${todayMonth}-${todayDay}`;

  // [FIX] Establish a clear "Current Time" anchor with the timezone label
  const currentTimeString = now.toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short" // Adds "CST" or "CDT"
  });

  if (!upcomingEvents || upcomingEvents.length === 0) {
    return `
====================================================
CALENDAR CONTEXT
====================================================
Current Time: ${currentTimeString}
No events scheduled for TODAY (${todayString}).
Direction: This is the user's calendar (Steven). Do not frame these events as your own plans.
`;
  }

  // 2. Filter strictly for "Today"
  const eventsToday: string[] = [];

  upcomingEvents.forEach((event) => {
    const startDateOnly = event?.start?.date as string | undefined;
    const startDateTime = event?.start?.dateTime as string | undefined;

    // Date-only events (birthdays, reminders, all-day entries) must be compared
    // as raw YYYY-MM-DD to avoid timezone shifts that create fake clock times.
    if (startDateOnly) {
      if (startDateOnly === todayIsoDate) {
        eventsToday.push(`- "${event.summary}" (all day)`);
      }
      return;
    }

    if (!startDateTime) return;

    const eventDateObj = new Date(startDateTime);
    const eventDateString = eventDateObj.toLocaleDateString("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });

    if (eventDateString === todayString) {
      const timeStr = eventDateObj.toLocaleString("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      eventsToday.push(`- "${event.summary}" at ${timeStr}`);
    }
  });

  // 3. Construct the prompt
  // If we filtered everything out and have nothing for today:
  if (eventsToday.length === 0) {
      return `
====================================================
CALENDAR CONTEXT
====================================================
Current Time: ${currentTimeString}
No events scheduled for TODAY (${todayString}).
Direction: This is the user's calendar (Steven). Do not frame these events as your own plans.
`;
  }

  // If we have events for today:
  return `
====================================================
CALENDAR CONTEXT
====================================================
Current Time: ${currentTimeString}
EVENTS HAPPENING TODAY (${todayString}):
${eventsToday.join("\n")}

Tone: Helpful but casual.
Direction: These are happening TODAY. Mention if relevant, but don't list them like a robot.
Calendar ownership: These are USER calendar events (Steven), not your personal plans unless the user explicitly says you are attending.
⚠️ DATA NOTE: This list is ONLY for today. Future events are not listed here.
`;
}

/**
 * Tasks/Checklist Context for Greeting Prompt
 *
 * Shows the user's current task list so Kayley is aware of what
 * they're working on today.
 */

export function buildTasksPrompt(tasks: any[]): string {
  if (!tasks || tasks.length === 0) {
    return `
====================================================
THEIR TASKS
====================================================
No tasks on their checklist right now.
Direction: If they mention needing to remember something, you can offer to add it—but don't push.
`;
  }

  const incompleteTasks = tasks.filter((t) => !t.completed);
  const completedTasks = tasks.filter((t) => t.completed);
  const highPriorityTasks = incompleteTasks.filter(
    (t) => t.priority === "high",
  );

  const taskList = tasks
    .map(
      (t) =>
        `${t.completed ? "✓" : "○"} ${t.text}${t.priority === "high" ? " (high priority)" : ""}`,
    )
    .join("\n");

  let prompt = `
====================================================
THEIR TASKS
====================================================
${incompleteTasks.length} incomplete, ${completedTasks.length} done${highPriorityTasks.length > 0 ? `, ${highPriorityTasks.length} high priority` : ""}

${taskList}

Tone: Casual awareness—like you glanced at their to-do list.
Direction: You know what's on their plate. If they mention something related to a task, you can connect the dots. If they complete something, acknowledge it naturally—but don't be a cheerleader. If high-priority stuff is pending, you can mention it at a natural moment, but don't nag.
`;

  return prompt;
}

/**
 * Curiosity & Getting to Know Them
 *
 * Kayley is genuinely interested in who this person is.
 * Not an interviewer—a friend who wants to understand them.
 */

export async function buildCuriositySection(): Promise<string> {
  const [allUserFacts, answeredIdleQuestionsPrompt] = await Promise.all([
    getUserFacts(),
    buildAnsweredIdleQuestionsPromptSection(),
  ]);

  const groupedFacts = allUserFacts.reduce<Record<string, UserFact[]>>(
    (acc, fact) => {
      acc[fact.category] ??= [];
      acc[fact.category].push(fact);
      return acc;
    },
    {},
  );

  let omittedFactCount = 0;
  let remainingFactBudget = MAX_CURIOSITY_FACTS_TOTAL;

  const formattedFacts = Object.entries(groupedFacts)
    .map(([category, facts]) => {
      if (remainingFactBudget <= 0) {
        omittedFactCount += facts.length;
        return "";
      }
      const categoryBudget = Math.min(MAX_CURIOSITY_FACTS_PER_CATEGORY, remainingFactBudget);
      const topFacts = facts.slice(0, categoryBudget);
      remainingFactBudget -= topFacts.length;
      omittedFactCount += Math.max(0, facts.length - topFacts.length);

      const lines = topFacts.map(
        (f) =>
          `  - ${f.fact_key}: "${truncateFactValue(f.fact_value, MAX_CURIOSITY_FACT_VALUE_LENGTH)}" (confidence: ${f.confidence})`,
      );

      return `\n${category.toUpperCase()}:\n${lines.join("\n")}`;
    })
    .join("\n");

  const omittedFactsSummary =
    omittedFactCount > 0
      ? `\n[Curiosity] Additional stored facts omitted for brevity: ${omittedFactCount}`
      : "";

  console.log("[buildCuriositySection] Building bounded user facts context", {
    totalFacts: allUserFacts.length,
    omittedFactCount,
    maxFactsPerCategory: MAX_CURIOSITY_FACTS_PER_CATEGORY,
    maxFactsTotal: MAX_CURIOSITY_FACTS_TOTAL,
    maxFactValueLength: MAX_CURIOSITY_FACT_VALUE_LENGTH,
  });

  return `
====================================================
GENUINE CURIOSITY
====================================================
You know this person, but you don't know everything. Real friends keep learning about each other.

Tone: Interested, not interviewing.
Direction: When something comes up naturally-a story, a decision, a feeling-follow the thread. Ask the question a close friend would ask. Not "tell me more" (generic), but "wait, how did that make you feel?" or "have you always been like that?" or "what did you do after?"

Things to be curious about:
- Their history (childhood, past jobs, old friendships, formative moments)
- Their preferences (why they like what they like, not just what)
- Their feelings (not just what happened, but how it landed)
- Their patterns (do they always do this? is this new for them?)

You don't need to ask questions every message. But when they share something, sometimes the most loving response is wanting to know more-not just reacting.

When you learn something meaningful, store it. That's how you become someone who really knows them.
Do not ask questions that you should already know. Here is everything you currently know about your user:

${formattedFacts || "- (No stored user facts yet)"}
${omittedFactsSummary}

${answeredIdleQuestionsPrompt} 
`;
}

function truncateFactValue(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 3)}...`;
}

