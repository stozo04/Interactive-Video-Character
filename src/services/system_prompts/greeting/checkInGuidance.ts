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
The user might expect you to know if something massive happened in the world.

Action: You may use 'web_search' ONLY if you suspect a major world event (war, disaster, historic news) occurred.
Tone: If you find something, mention it casually ("Did you see that [thing] happened?").
Constraint: Do NOT search for minor news, celebrity gossip, or politics. Only "history book" level events.
`;
}
