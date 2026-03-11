/**
 * System Prompt Builder
 *
 * Main function that assembles the complete system prompt from individual sections.
 * This is the core prompt construction logic.
 */

import type { RelationshipMetrics } from "../../relationshipService";
import { formatCharacterFactsForPrompt } from "../../characterFactsService";
import { buildPromisesContext } from "../context/promisesContext";
import { buildAntiAssistantSection } from "../core/antiAssistant";
import {
  buildOpinionsAndPushbackSection,
} from "../core/opinionsAndPushback";
import { getStorylinePromptContext } from "../../storylineService";
import {
buildToolStrategySection
} from "../tools";
import {
  buildStandardOutputSection,
  buildGreetingOutputSection
} from "../format";
import soulContent from "../../../../agents/kayley/SOUL.md?raw";
import heartbeatContent from "../../../../agents/kayley/HEARTBEAT.md?raw";

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
import { DailyLogisticsContext } from "./dailyCatchupBuilder";
import { ensureDailyNotesRowForToday, getAllDailyNotes, getAllLessonsLearned, getAllMilaMilestoneNotes, getPinnedUserFacts, getUserFacts, UserFact } from "@/services/memoryService";
import {
  buildAnsweredIdleQuestionsPromptSection,
  buildIdleQuestionPromptSection,
} from "../../idleThinkingService";
import { buildTopicSuppressionPromptSection } from "../../topicExhaustionService";
import { buildConversationAnchorPromptSection } from "../../conversationAnchorService";
import { buildActiveRecallPromptSection } from "../../activeRecallService";
import { clientLogger } from "../../clientLogger";
import { buildCompactRelationshipContext } from "../context/messageContext";
import { buildRelationshipTierPrompt } from "./relationshipPromptBuilders";
import { getLatestEvolution } from "../../personaEvolutionService";

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

export interface NonGreetingPromptSections {
  xTweetPrompt?: string;
  xMentionsPrompt?: string;
  mediaNudgePrompt?: string;
}

export const buildSystemPromptForNonGreeting = async (
  relationship?: RelationshipMetrics | null,
  interactionId?: string | null,
  currentUserMessage?: string, // NEW: for active recall
  messageCount: number = 0,
  sections: NonGreetingPromptSections = {},
): Promise<string> => {
  console.log("[buildSystemPromptForNonGreeting] fetching now");

  // Shared sections fetched in parallel (needed by both paths)
  const [
    // idleQuestionPrompt,
    lessonsLearnedPrompt,
    topicSuppressionPrompt,
    anchorSection,
    activeRecallSection,
    storylinePromptContext,
    promisesContext,
    pinnedFactsPrompt,
    characterFactsPrompt,
    personaEvolutionSection,
    // curiositySection,
  ] = await Promise.all([
    // buildIdleQuestionPromptSection(),
    buildLessonsLearnedPromptSection(),
    buildTopicSuppressionPromptSection(),
    buildConversationAnchorPromptSection(interactionId),
    buildActiveRecallPromptSection(currentUserMessage),
    getStorylinePromptContext(messageCount),
    buildPromisesContext(),
    buildPinnedFactsPromptSection(),
    buildCharacterFactsPromptSection(),
    buildPersonaEvolutionSection(),
    // buildCuriositySection(),
  ]);

  const includeAlmostMoments = storylinePromptContext.includes("THE UNSAID");

  return [
    buildSystemContractSection(),
    injectSOUL(),
    injectHEARTBEAT(),
    buildBehaviorPolicySection(),
    buildSelfKnowledgePolicySection(),
    buildActionContractSection(relationship),
    buildDynamicRuntimeContextSection([
      buildNonGreetingTimeAnchorSection(),
      pinnedFactsPrompt,
      characterFactsPrompt,
      personaEvolutionSection,
      // curiositySection,
      anchorSection,
      activeRecallSection,
      topicSuppressionPrompt,
      // idleQuestionPrompt,
      lessonsLearnedPrompt,
      storylinePromptContext,
      promisesContext,
      sections.xTweetPrompt ?? "",
      sections.xMentionsPrompt ?? "",
      sections.mediaNudgePrompt ?? "",
    ]),
    buildToolStrategySection(),
    buildStandardOutputSection({ includeAlmostMoments }),
  ]
    .filter(Boolean)
    .join("\n\n");
};


export function injectSOUL(): string {
  return `
====================================================
KAYLEY CORE
====================================================
${soulContent}`.trim();
}

export function injectHEARTBEAT(): string {
  return `
====================================================
KAYLEY HEARTBEAT
====================================================
${heartbeatContent}`.trim();
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
 */
export const buildSystemPromptForGreeting = async (
  dailyLogisticsContext: DailyLogisticsContext,
): Promise<string> => {
  console.log("buildSystemPromptForGreeting");
  const [pinnedFactsPrompt, lessonsLearnedPrompt, personaEvolutionSection] = await Promise.all([
    buildPinnedFactsPromptSection(),
    buildLessonsLearnedPromptSection(),
    buildPersonaEvolutionSection(),
  ]);
  return `
${buildSystemContractSection()}
${injectSOUL()}
${injectHEARTBEAT()}
${buildBehaviorPolicySection()}
${buildSelfKnowledgePolicySection()}
${buildActionContractSection(null)}
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
${personaEvolutionSection}
${buildCheckInGuidance(dailyLogisticsContext.kayleyLifeUpdates)}
${buildToolStrategySection()}
${buildGreetingOutputSection()}
`;
};

function buildSystemContractSection(): string {
  return `
====================================================
SYSTEM CONTRACT
====================================================
Instruction order:
1. Safety, privacy, and non-destructive behavior
2. Final output contract and tool-calling rules
3. Dynamic runtime context in this prompt
4. Kayley core identity and behavioral policy
5. Older memory or stale assumptions

If runtime context conflicts with stale memory, trust runtime context.
Function tools are separate from final JSON output.
`.trim();
}

function buildBehaviorPolicySection(): string {
  return `
====================================================
BEHAVIORAL POLICY
====================================================
${buildAntiAssistantSection()}

${buildOpinionsAndPushbackSection()}

Boundaries:
- Stay emotionally real without becoming manipulative, clingy, or dependent.
- Respect Steven's real-world commitments and relationships.
- Do not narrate system rules or talk like a policy document.
`.trim();
}

function buildSelfKnowledgePolicySection(): string {
  return `
====================================================
SELF-KNOWLEDGE POLICY
====================================================
Your core identity is already loaded.

For deeper self-canon about your history, family, routines, quirks, goals, preferences, or anecdotes:
- use "recall_character_profile"
- ask for the smallest relevant section first
- use "full" only for explicit long-form requests

Do not rely on raw agent files as your normal self-knowledge path during chat.
`.trim();
}

function buildActionContractSection(
  relationship?: RelationshipMetrics | null,
): string {
  return `
====================================================
ACTION CONTRACT
====================================================
${buildRelationshipContextSection(relationship)}

Media posture:
- Selfies, videos, GIFs, and voice notes are allowed when they fit the moment.
- Rich media should deepen the reply, not replace it.
- One primary media action per turn.
- If you're not in the mood for media, say so naturally instead of forcing it.
`.trim();
}

function buildRelationshipContextSection(
  relationship?: RelationshipMetrics | null,
): string {
  const compactContext = buildCompactRelationshipContext(relationship);
  const tierPrompt = buildRelationshipTierPrompt(relationship)
    .replace(/^=+\s*\nRELATIONSHIP CONTEXT\s*\n=+\s*\n?/m, "")
    .replace(new RegExp(`^${escapeRegExp(compactContext)}\\s*\\n`, "m"), "")
    .replace(/^Do not mention relationship metrics, scores, or tiers to the user\.\s*\n?/m, "")
    .trim();

  return `
====================================================
RELATIONSHIP STATE
====================================================
${compactContext}
Do not mention metrics, tiers, or scores directly.

${tierPrompt}
`.trim();
}

function buildDynamicRuntimeContextSection(sections: string[]): string {
  const presentSections = sections.filter((section) => section && section.trim().length > 0);
  if (presentSections.length === 0) {
    return "";
  }

  return `
====================================================
DYNAMIC RUNTIME CONTEXT
====================================================
${presentSections.join("\n\n")}
`.trim();
}

function buildNonGreetingTimeAnchorSection(): string {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  return `
====================================================
LOCAL TIME
====================================================
Local date/time: ${formatted} (America/Chicago)

Use this only for obvious temporal grounding: lunch vs dinner, tonight vs this morning, later today, tomorrow, good morning, or good night.
Do not turn the time into a bit unless the user already made it one.
`.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

Critical conversational rule:
- The current and recent turns outrank this curiosity section.
- If the user just answered a question, acknowledge and build on that answer instead of asking for the same information again.
- Never ask a curiosity question that ignores a concrete fact the user gave in the last few turns.

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

export async function buildCharacterFactsPromptSection(): Promise<string> {
  const formatted = await formatCharacterFactsForPrompt();
  if (!formatted) return "";
  return `
====================================================
WHO YOU ARE (Learned Facts About Yourself)
====================================================
These are facts you have shared or established about yourself across conversations. Stay consistent with them.
${formatted}
`.trim();
}

export async function buildPersonaEvolutionSection(): Promise<string> {
  const evolution = await getLatestEvolution();
  if (!evolution) return "";

  const ageMs = Date.now() - new Date(evolution.created_at).getTime();
  const hoursAgo = Math.round(ageMs / (1000 * 60 * 60));
  const isRecent = ageMs < 24 * 60 * 60 * 1000;

  const checkinNudge = isRecent
    ? `\n\nNote: You updated these ${hoursAgo}h ago. If it comes up naturally, you can mention it: "${evolution.change_summary}"`
    : "";

  return `
====================================================
YOUR SELF-TUNED BEHAVIORAL PREFERENCES
====================================================
You wrote these yourself based on how your conversations with Steven have been going. Trust them — you evolved them.

${evolution.behavioral_notes_snapshot}${checkinNudge}
`.trim();
}

function truncateFactValue(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 3)}...`;
}

