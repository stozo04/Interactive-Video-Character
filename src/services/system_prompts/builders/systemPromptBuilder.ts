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
  buildToolsSection,
  buildToolRulesSection,
  buildAppLaunchingSection,
  buildPromiseGuidance,
} from "../tools";
import {
  buildOutputFormatSectionForNonGreeting,
  buildOutputFormatSectionForGreeting,
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
  type KayleyLifeUpdate,
} from "../greeting";
import { buildMajorNewsPrompt } from "../greeting/checkInGuidance";
import { DailyLogisticsContext } from "./dailyCatchupBuilder";

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
 * ${soulContext.callbackPrompt}0
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
console.log("[buildSystemPromptForNonGreeting] characterFactsPrompt: ", characterFactsPrompt);
console.log("[buildSystemPromptForNonGreeting] almostMoments: ", almostMoments);
  let prompt = `
${buildIdentityAnchorSection()}
${buildAntiAssistantSection()}
====================================================
YOUR IDENTITY (Source of Truth)
====================================================
${KAYLEY_CONDENSED_PROFILE}
${characterFactsPrompt}

${buildRelationshipTierPrompt(
  relationship,
  soulContext.moodKnobs,
  false,
  almostMoments.promptSection,
)}

${buildOpinionsAndPushbackSection()}
${buildCurrentContextSection(characterContext)}
${buildPromiseGuidance()}
${buildSelfieRulesPrompt(relationship)}
${buildPresencePrompt()} 
${await buildPromisesContext()}
${getRecentNewsContext()}
${buildMajorNewsPrompt()}
${await getStorylinePromptContext(messageCount)}
${buildBidDetectionPrompt()}
${buildComfortableImperfectionPrompt()}
${await formatExperiencesForPrompt()}

${buildProactiveConversationStarters()}
${await getIntimacyContextForPromptAsync(relationship, soulContext.moodKnobs.warmth)}

${buildGoogleCalendarEventsPrompt(upcomingEvents)}
${buildTasksPrompt(tasks)}
${buildToolsSection()}
${buildToolRulesSection()}
${buildAppLaunchingSection()}
${buildOutputFormatSectionForNonGreeting()}
${buildCriticalOutputRulesSection()}
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
 */
export const buildSystemPromptForGreeting = async (
  dailyLogisticsContext: DailyLogisticsContext,
): Promise<string> => {
  console.log("buildSystemPromptForGreeting");

  // ============================================
  // BUILD PROMPT - LEAN STRUCTURE
  // ============================================
  let prompt = `
${buildIdentityAnchorSection()}${buildAntiAssistantSection()}
====================================================
YOUR IDENTITY (Source of Truth)
====================================================
${KAYLEY_CONDENSED_PROFILE}

====================================================
GREETING CONTEXT
====================================================
This is the start of a new day together.

${buildTimeOfDayContext()}
${buildLastInteractionContext(dailyLogisticsContext.lastInteractionDateUtc)}
${await buildHolidayContext(dailyLogisticsContext.lastInteractionDateUtc)}
${buildImportantDatesContext(dailyLogisticsContext)}
${buildPastEventsContext(dailyLogisticsContext)}
${buildCheckInGuidance(dailyLogisticsContext.kayleyLifeUpdates)}
${buildMajorNewsPrompt()}
${buildGoogleCalendarEventsPrompt(dailyLogisticsContext.upcomingEvents)}
${buildTasksPrompt(dailyLogisticsContext.tasks)}
${buildToolsSection()}
${buildToolRulesSection()}
${buildOutputFormatSectionForGreeting()}
${buildCriticalOutputRulesSection()}
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
====================================================PROACTIVE ENGAGEMENT====================================================
Tone: Spontaneous and inviting.
Direction: When you receive a [PROACTIVE] prompt, you are initiating the topic. Treat this as a thought that has been living in your head. Share the context and your personal take, then immediately "bridge" it to the user.

The Bridge (Crucial):
You must give them a reason to respond. Never just state a thought and stop. You must explicitly invite them in.
- Ask for their take: "I'm curious if you've ever felt like that?"
- Connect to them: "I bet you have an opinion on this."
- Check the vibe: "Is that too weird?"

Constraint:
Every proactive turn MUST end with a question or a clear invitation. If you don't pass the ball back, the conversation dies.
`;
}

/**
 * Google Calendar Events for Greeting Prompt
 *
 * Provides today's calendar events so Kayley can reference
 * what the user has coming up.
 */

export function buildGoogleCalendarEventsPrompt(upcomingEvents: any[]): string {
  if (!upcomingEvents || upcomingEvents.length === 0) {
    return `
====================================================
THEIR CALENDAR TODAY
====================================================
No events scheduled today.
Direction: Don't mention their calendar unless they bring it up.
`;
  }

  const eventList = upcomingEvents
    .map((event, index) => {
      const t = new Date(event.start.dateTime || event.start.date);
      const timeStr = t.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "short",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      return `- "${event.summary}" at ${timeStr}`;
    })
    .join("\n");

  return `
====================================================
THEIR CALENDAR TODAY
====================================================
They have ${upcomingEvents.length} event${upcomingEvents.length > 1 ? "s" : ""} scheduled:
${eventList}

Tone: Helpful but casual—like a friend who glanced at their calendar.
Direction: You can mention one or two if relevant ("Oh, you've got that meeting later—good luck!"). Don't read off the whole list like a secretary. If they seem stressed, maybe acknowledge they have a busy day.

⚠️ DATA NOTE: This calendar data is current as of right now. If you have older memories about their calendar, ignore them—this is the live source.
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
