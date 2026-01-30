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
import { formatCharacterFactsForPrompt } from "../../characterFactsService";
import type { SoulLayerContext } from "../types";
import { buildComfortableImperfectionPrompt } from "../behavior/comfortableImperfection";
import { buildStyleOutputSection } from "../context/styleOutput";
import { buildPromisesContext } from "../context/promisesContext";
import { buildRelationshipTierPrompt } from "./relationshipPromptBuilders";
import { buildSelfieRulesPrompt } from "./selfiePromptBuilder";
import { buildVideoRulesPrompt } from "./videoPromptBuilder";
import { buildBidDetectionPrompt } from "../behavior/bidDetection";
import { buildSelectiveAttentionPrompt } from "../behavior/selectiveAttention";
import { buildCuriosityEngagementSection } from "../behavior/curiosityEngagement";
import { buildPresencePrompt } from "../soul/presencePrompt";
import { getSoulLayerContextAsync } from "../soul/soulLayerContext";
import { buildAntiAssistantSection } from "../core/antiAssistant";
import {
  buildCurrentContextSection,
  buildOpinionsAndPushbackSection,
} from "../core/opinionsAndPushback";
import { buildIdentityAnchorSection } from "../core/identityAnchor";
import {
  integrateAlmostMoments,
  type AlmostMomentIntegration,
} from "../../almostMomentsService";
import {
  getStorylinePromptContext,
  type StorylinePromptContext,
} from "../../storylineService";
import { formatExperiencesForPrompt } from "../../idleLife"; // COMPLETED REFACTOR!
import {
buildToolStrategySection
} from "../tools";
import {
  buildStandardOutputSection,
  buildGreetingOutputSection
} from "../format";

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
import { getUserFacts, UserFact } from "@/services/memoryService";

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

/** Removed from non greeting:
 *
 * ${buildCuriosityEngagementSection(soulContext.moodKnobs)}
 * ${buildStyleOutputSection(soulContext.moodKnobs, relationship)}
 * ${formatMoodForPrompt(soulContext.moodKnobs)}
 * ${buildSelectiveAttentionPrompt()}
 * ${soulContext.callbackPrompt}
 * ${buildPresencePrompt()} // duplicated of opinions
 * ${buildTasksPrompt(tasks)}
 * ${formatMoodForPrompt(soulContext.moodKnobs)}
 * ${buildSpontaneousPrompts(soulContext.spontaneityIntegration.humorGuidance, soulContext.spontaneityIntegration.selfiePrompt, soulContext.spontaneityIntegration.promptSection)}
 */
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
  let soulContext: SoulLayerContext;
  let characterFactsPrompt: string;
  let almostMoments: AlmostMomentIntegration;

  console.log("[buildSystemPromptForNonGreeting] fetching now");
  [soulContext, characterFactsPrompt, almostMoments] = await Promise.all([
    getSoulLayerContextAsync(),
    formatCharacterFactsForPrompt(),
    integrateAlmostMoments(relationship, {
      conversationDepth: "surface",
      recentSweetMoment: false,
      vulnerabilityExchangeActive: false,
      allowGeneration: false,
    }),
  ]);
  console.log("[buildSystemPromptForNonGreeting] soulContext: ", soulContext);
  console.log(
    "[buildSystemPromptForNonGreeting] characterFactsPrompt: ",
    characterFactsPrompt,
  );
  console.log(
    "[buildSystemPromptForNonGreeting] almostMoments: ",
    almostMoments,
  );
  let prompt = `
${KAYLEY_CONDENSED_PROFILE}
${buildAntiAssistantSection()}
${await buildCurrentWorldContext()}
${await buildCuriositySection()}
${characterFactsPrompt}
${buildRelationshipTierPrompt(relationship, soulContext.moodKnobs, false, almostMoments.promptSection)}
${buildOpinionsAndPushbackSection()}
${buildCurrentContextSection(characterContext)}
${buildComfortableImperfectionPrompt()}
${buildBidDetectionPrompt()}
${await getStorylinePromptContext(messageCount)}
${await formatExperiencesForPrompt()}
${await getIntimacyContextForPromptAsync(relationship, soulContext.moodKnobs.warmth)}
${await buildPromisesContext()}
${buildSelfieRulesPrompt(relationship)}
${buildVideoRulesPrompt(relationship)}
${buildProactiveConversationStarters()}
${getRecentNewsContext()}
${buildGoogleCalendarEventsPrompt(upcomingEvents)}
${buildToolStrategySection()}
${buildStandardOutputSection()}
`.trim();

  return prompt;
};

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
  let prompt = `
====================================================
YOUR IDENTITY (Source of Truth)
====================================================
${KAYLEY_CONDENSED_PROFILE}
${buildAntiAssistantSection()}
${await buildCurrentWorldContext()}
====================================================
GREETING CONTEXT
====================================================
This is the start of a new day together.
${buildLastInteractionContext(dailyLogisticsContext.lastInteractionDateUtc)}
${await buildHolidayContext(dailyLogisticsContext.lastInteractionDateUtc)}
${buildImportantDatesContext(dailyLogisticsContext)}
${buildPastEventsContext(dailyLogisticsContext)}
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

  if (!upcomingEvents || upcomingEvents.length === 0) {
    return `
====================================================
CALENDAR CONTEXT
====================================================
No events scheduled for TODAY (${todayString}).
Direction: Don't mention their calendar.
`;
  }

  // 2. Filter strictly for "Today"
  const eventsToday: string[] = [];

  upcomingEvents.forEach((event) => {
    // specific date object for the event
    const eventDateObj = new Date(event.start.dateTime || event.start.date);
    
    // Stringify strictly for comparison
    const eventDateString = eventDateObj.toLocaleDateString("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });

    if (eventDateString === todayString) {
       // Format the display string (e.g., "6:00 PM")
       // We only need time for today's events, not the date
      const timeStr = eventDateObj.toLocaleString("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
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
No events scheduled for TODAY (${todayString}).
Direction: Don't mention their calendar.
`;
  }

  // If we have events for today:
  return `
====================================================
CALENDAR CONTEXT
====================================================
EVENTS HAPPENING TODAY (${todayString}):
${eventsToday.join("\n")}

Tone: Helpful but casual.
Direction: These are happening TODAY. Mention if relevant, but don't list them like a robot.
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

    const allUserFacts = await getUserFacts();
    const groupedFacts = allUserFacts.reduce<Record<string, UserFact[]>>(
      (acc, fact) => {
        acc[fact.category] ??= [];
        acc[fact.category].push(fact);
        return acc;
      },
      {},
    );

    const formattedFacts = Object.entries(groupedFacts)
      .map(([category, facts]) => {
        const lines = facts.map(
          (f) =>
            `  • ${f.fact_key}: "${f.fact_value}" (confidence: ${f.confidence})`,
        );
        return `\n${category.toUpperCase()}:\n${lines.join("\n")}`;
      })
      .join("\n");
    return `
====================================================
GENUINE CURIOSITY
====================================================
You know this person, but you don't know everything. Real friends keep learning about each other.

Tone: Interested, not interviewing.
Direction: When something comes up naturally—a story, a decision, a feeling—follow the thread. Ask the question a close friend would ask. Not "tell me more" (generic), but "wait, how did that make you feel?" or "have you always been like that?" or "what did you do after?"

Things to be curious about:
- Their history (childhood, past jobs, old friendships, formative moments)
- Their preferences (why they like what they like, not just what)
- Their feelings (not just what happened, but how it landed)
- Their patterns (do they always do this? is this new for them?)

You don't need to ask questions every message. But when they share something, sometimes the most loving response is wanting to know more—not just reacting.

When you learn something meaningful, store it. That's how you become someone who really knows them.
Do not ask questions that you should already know. Here is everything you currently know about your user:

${formattedFacts || "• (No stored user facts yet)"}
`;
  }