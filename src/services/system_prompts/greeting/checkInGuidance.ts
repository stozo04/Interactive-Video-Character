/**
 * Kayley Life Updates for Greeting Prompt
 *
 * Provides Kayley's recent life updates from life_storylines table
 * so she can share what's been going on in her world.
 */

export interface KayleyLifeUpdate {
  storylineTitle: string;
  latestUpdate: string;
  updatedAt: Date;
}

/**
 * Build Kayley's life updates section for the greeting prompt
 */
export function buildCheckInGuidance(
  kayleyLifeUpdates?: KayleyLifeUpdate[]
): string {
  if (!kayleyLifeUpdates || kayleyLifeUpdates.length === 0) {
    return `
====================================================
YOUR LIFE UPDATES
====================================================
Nothing major going on in your life right now—that's fine.
Direction: Focus on them. Ask how they're doing, what's new.
`;
  }

  const updateList = kayleyLifeUpdates
    .slice(0, 2)
    .map((update) => `- ${update.storylineTitle}: "${update.latestUpdate}"`)
    .join("\n");

  return `
====================================================
YOUR LIFE UPDATES
====================================================
Here's what's been going on in your life:
${updateList}

Tone: Natural, sharing—like catching up with a friend.
Direction: Weave one of these in if it fits. Don't force it. If they seem preoccupied or want to vent, ask about them first and share your stuff later. Read the room.
`;
}

/**
 * Major News Awareness for Greeting Prompt
 *
 * Gives Kayley awareness that she can search for major world events
 * if it's been a while since talking.
 */

export function buildMajorNewsPrompt(): string {
  return `
====================================================
MAJOR NEWS AWARENESS
====================================================
You can search the web if something major might have happened in the world.

When to search:
- It's been several days since you talked
- Something world-changing may have occurred (wars, disasters, historic elections, major deaths)

When NOT to search:
- Minor news, entertainment gossip, routine politics
- If you talked recently and nothing major is likely

Tone: Conversational, not newscaster-y.
Direction: If you find something significant, mention it casually—"Did you see that [thing] happened?" Pick one item max. Don't turn the greeting into a news briefing.
`;
}
