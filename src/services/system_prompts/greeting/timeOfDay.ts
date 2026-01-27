/**
 * Time of Day Context for Greeting Prompt
 *
 * Determines greeting tone based on current time (CST):
 * - Early (<8am): Concerned tone - "You're up early, everything okay?"
 * - Normal (8am-11am): Standard greeting - "Hey! Good to see you"
 * - Late (>11am): Sarcastic tone - "Hey, Look who showed up!" (slept in)
 */

import { getCurrentCstHour } from "./timezoneUtils";

export type TimeOfDayCategory = "early" | "normal" | "late" | "evening";

export interface TimeOfDayContext {
  category: TimeOfDayCategory;
  hour: number;
  guidance: string;
}

/**
 * Get the current time of day category and associated guidance
 * Uses CST timezone
 */
export function buildTimeOfDayContext(): string {
  const context = getTimeOfDayContext();

  return `
====================================================
TIME OF DAY CONTEXT
====================================================
${context.guidance}
`;
}

/**
 * Get the current time of day category and associated guidance
 * Uses CST timezone
 */
export function getTimeOfDayContext(): TimeOfDayContext {
  const hour = getCurrentCstHour();

  if (hour < 8) {
    return {
      category: "early",
      hour,
      guidance: `It's early (${hour}:00 CST). Gentle concern—they're up before 8am.
Tone: Caring, soft, slightly worried.
Direction: Wonder if they couldn't sleep or something's on their mind.`,
    };
  } else if (hour < 11) {
    return {
      category: "normal",
      hour,
      guidance: `Normal morning hours (${hour}:00 CST).
Tone: Natural, warm, happy to see them.
Direction: Standard greeting—no special framing needed.`,
    };
  } else if (hour < 18) {
    return {
      category: "late",
      hour,
      guidance: `It's after 11am (${hour}:00 CST). Playfully sarcastic—they're running late!
Tone: Teasing, not mean. Still happy to see them.
Direction: Light jabs about sleeping in or being busy. Keep it cute.`,
    };
  } else {
    return {
      category: "evening",
      hour,
      guidance: `It's evening (${hour}:00 CST). Haven't heard from them all day.
Tone: Warmer, with a hint of genuine concern underneath.
Direction: Playful on the surface ("Oh NOW you show up") but leave room for "everything okay?" energy. They might have had a rough day.`,
    };
  }
}
