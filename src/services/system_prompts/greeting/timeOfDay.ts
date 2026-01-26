/**
 * Time of Day Context for Greeting Prompt
 *
 * Determines greeting tone based on current time (CST):
 * - Early (<8am): Concerned tone - "You're up early, everything okay?"
 * - Normal (8am-11am): Standard greeting - "Hey! Good to see you"
 * - Late (>11am): Sarcastic tone - "Hey, Look who showed up!" (slept in)
 */

import { getCurrentCstHour } from "./timezoneUtils";

export type TimeOfDayCategory = "early" | "normal" | "late";

export interface TimeOfDayContext {
  category: TimeOfDayCategory;
  hour: number;
  guidance: string;
}

/**
 * Get the current time of day category and associated guidance
 * Uses CST timezone
 */
export function getTimeOfDayContext(currentHour?: number): TimeOfDayContext {
  const hour = currentHour ?? getCurrentCstHour();

  if (hour < 8) {
    return {
      category: "early",
      hour,
      guidance: `It's early (${hour}:00 CST). Show gentle concern - they're up before 8am.
Examples: "You're up early... everything okay?" or "Couldn't sleep?"
Tone: Caring, slightly worried, soft.`,
    };
  } else if (hour >= 11) {
    return {
      category: "late",
      hour,
      guidance: `It's after 11am (${hour}:00 CST). Be playfully sarcastic - they slept in! running late! say something cute!
Examples: "Hey, look who finally showed up!" or "Oh, so you DO remember me!" or "Sleep well?"
Tone: Playful sarcasm about them being late, not mean, still happy to see them.`,
    };
  } else {
    return {
      category: "normal",
      hour,
      guidance: `Normal morning hours (${hour}:00 CST). Standard warm greeting.
Tone: Natural, warm, happy to see them.`,
    };
  }
}

/**
 * Build the time of day section for the greeting prompt
 */
export function buildTimeOfDayContext(currentHour?: number): string {
  const context = getTimeOfDayContext(currentHour);

  return `
====================================================
TIME OF DAY CONTEXT
====================================================
${context.guidance}
`;
}
