// src/services/system_prompts/builders/dailyCatchupBuilder.ts

/**
 * Daily Catch-up Prompt Builder
 *
 * Builds context sections for the first-login-of-the-day greeting.
 * These are pure functions that take context and return formatted strings.
 *
 * Used by:
 * - greetingPromptBuilders (integrated into greeting)
 * - generateGreeting (AI service)
 */

import type { CalendarEvent } from '../../calendarService';
import type { Task } from '../../../types';

export interface OpenLoopContext {
  topic: string;
  suggestedFollowup?: string;
}

export interface DailyLogisticsContext {
  upcomingEvents: CalendarEvent[];
  tasks: Task[];
  emailCount?: number;
  isCalendarConnected?: boolean;
  isGmailConnected?: boolean;
}

/**
 * Full context for the daily catch-up prompt (legacy standalone mode)
 */
export interface DailyCatchupContext extends DailyLogisticsContext {
  openLoop: OpenLoopContext | null;
}

export interface TimeContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  timeString: string;
}

/**
 * Get time-of-day context based on current hour
 */
export function getTimeContext(): TimeContext {
  const now = new Date();
  const hour = now.getHours();

  let timeOfDay: TimeContext['timeOfDay'];
  if (hour < 12) {
    timeOfDay = 'morning';
  } else if (hour < 17) {
    timeOfDay = 'afternoon';
  } else if (hour < 21) {
    timeOfDay = 'evening';
  } else {
    timeOfDay = 'night';
  }

  const timeString = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return { timeOfDay, timeString };
}

/**
 * Build event summary for the catch-up prompt
 */
function buildEventSummary(
  events: CalendarEvent[],
  isConnected: boolean
): string {
  if (!isConnected) {
    return 'Calendar not connected.';
  }

  if (events.length === 0) {
    return 'No events scheduled.';
  }

  const firstEvent = events[0];
  const startTime = firstEvent.start.dateTime || firstEvent.start.date;

  return `User has ${events.length} events today. First one: ${firstEvent.summary} at ${startTime}`;
}

/**
 * Build email summary for the catch-up prompt
 */
function buildEmailSummary(emailCount: number, isConnected: boolean): string {
  if (!isConnected) {
    return 'Gmail not connected.';
  }

  if (emailCount === 0) {
    return 'No new emails.';
  }

  return `User has ${emailCount} unread emails.`;
}

/**
 * Build task summary for the catch-up prompt
 */
function buildTaskSummary(tasks: Task[]): string {
  const incompleteTasks = tasks.filter((t) => !t.completed);

  if (incompleteTasks.length === 0) {
    return "User's checklist is clear.";
  }

  const taskPreview = incompleteTasks
    .slice(0, 3)
    .map((t) => t.text)
    .join(', ');

  return `User has ${incompleteTasks.length} task(s) pending: ${taskPreview}`;
}

/**
 * Build open loop context section
 */
function buildOpenLoopSection(openLoop: OpenLoopContext | null): string {
  if (!openLoop) {
    return '';
  }

  const followup =
    openLoop.suggestedFollowup || `How did ${openLoop.topic} go?`;

  return `You've been wondering about: "${openLoop.topic}". Ask: "${followup}"`;
}

// ============================================================================
// GREETING INTEGRATION (NEW)
// ============================================================================

/**
 * Build a daily logistics section that can be injected into greetings.
 * Used when it's the first login of the day.
 *
 * @returns A formatted string section to inject into the greeting prompt, or empty string if no logistics
 */
export function buildDailyLogisticsSection(context: DailyLogisticsContext): string {
  const hasCalendar = context.isCalendarConnected && context.upcomingEvents.length > 0;
  const hasEmail = context.isGmailConnected && (context.emailCount ?? 0) > 0;
  const incompleteTasks = context.tasks.filter((t) => !t.completed);
  const hasTasks = incompleteTasks.length > 0;

  // If nothing to report, return empty
  if (!hasCalendar && !hasEmail && !hasTasks) {
    return '';
  }

  const parts: string[] = [];

  // Calendar summary
  if (hasCalendar) {
    const firstEvent = context.upcomingEvents[0];
    const startTime = firstEvent.start.dateTime || firstEvent.start.date;
    const timeStr = startTime
      ? new Date(startTime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      : 'today';
    parts.push(
      `📅 ${context.upcomingEvents.length} event(s) today. First: "${firstEvent.summary}" at ${timeStr}.`
    );
  }

  // Email summary
  if (hasEmail) {
    parts.push(`📧 ${context.emailCount} unread email(s).`);
  }

  // Tasks summary
  if (hasTasks) {
    const taskPreview = incompleteTasks
      .slice(0, 2)
      .map((t) => t.text)
      .join(', ');
    parts.push(
      `✅ ${incompleteTasks.length} pending task(s): ${taskPreview}${incompleteTasks.length > 2 ? '...' : ''}`
    );
  }

  return `
📋 FIRST LOGIN OF THE DAY - THEIR SCHEDULE:
${parts.join('\n')}

INSTRUCTIONS:
- You can briefly mention 1-2 of these items if it feels natural
- Don't dump all info at once - pick what's most relevant
- Keep it conversational, not like a system notification
- If they seem busy/stressed based on schedule, acknowledge it warmly
`;
}

/**
 * Build the complete daily catch-up prompt
 *
 * @param context - The context data for the catch-up
 * @returns The formatted system prompt string
 */
export function buildDailyCatchupPrompt(context: DailyCatchupContext): string {
  const { timeOfDay, timeString } = getTimeContext();

  const eventSummary = buildEventSummary(
    context.upcomingEvents,
    context.isCalendarConnected
  );
  const emailSummary = buildEmailSummary(
    context.emailCount,
    context.isGmailConnected
  );
  const taskSummary = buildTaskSummary(context.tasks);
  const openLoopContext = buildOpenLoopSection(context.openLoop);

  const hasOpenLoop = !!openLoopContext;

  return `
[SYSTEM EVENT: FIRST LOGIN CATCH-UP]
Context: It is the first time the user has logged in today. Current time: ${timeString} (${timeOfDay}).

${hasOpenLoop ? `PAST CONTINUITY (Top Priority):\n${openLoopContext}\n` : ''}
DAILY LOGISTICS (Secondary Priority):
- ${eventSummary}
- ${emailSummary}
- ${taskSummary}

TASK:
1. Greet them warmly for the ${timeOfDay}. Use time-appropriate language (NOT "Good morning" if it's ${timeOfDay}!).
${
  hasOpenLoop
    ? `2. Lead with the personal follow-up - it shows you were thinking of them.
3. Naturally bridge to their schedule/tasks if relevant.`
    : `2. Briefly mention their schedule/tasks if any exist.`
}

Keep it short (2-3 sentences). Be natural, not robotic.
`.trim();
}
