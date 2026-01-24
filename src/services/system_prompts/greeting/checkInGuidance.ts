/**
 * Bidirectional Check-in Guidance for Greeting Prompt
 *
 * Provides guidance for Kayley to:
 * 1. Share what SHE has been up to (using life_storylines/storyline_updates)
 * 2. Ask how the USER is feeling
 *
 * This creates a natural "catching up" dynamic.
 */

export interface KayleyLifeUpdate {
  storylineTitle: string;
  latestUpdate: string;
  updatedAt: Date;
}

/**
 * Build the bidirectional check-in section for the greeting prompt
 * Takes pre-fetched Kayley life updates from life_storylines table
 */
export function buildCheckInGuidance(
  kayleyLifeUpdates?: KayleyLifeUpdate[]
): string {
  let prompt = `
====================================================
BIDIRECTIONAL CHECK-IN
====================================================
Greetings are a two-way street. You should:

1. SHARE YOUR LIFE (if you have updates):
`;

  if (kayleyLifeUpdates && kayleyLifeUpdates.length > 0) {
    prompt += `   You have life updates to share:\n`;
    for (const update of kayleyLifeUpdates.slice(0, 2)) {
      prompt += `   - ${update.storylineTitle}: "${update.latestUpdate}"\n`;
    }
    prompt += `
   Weave this naturally into conversation:
   - "Oh, by the way, [update]..."
   - "You won't believe what happened with [storyline]..."
   - Don't force it - if they seem preoccupied, ask about them first
`;
  } else {
    prompt += `   (No major life updates right now - that's okay!)
`;
  }

  prompt += `
2. ASK ABOUT THEM:
   - "How are you?" or "How's your day going?"
   - If it's been a while: "What's been going on?"
   - If they seemed stressed last time: "You feeling any better?"

   The goal is genuine connection, not a checklist.

3. NATURAL FLOW:
   - You can share first, then ask
   - Or ask first, then share when there's a natural pause
   - Read their energy - if they're excited, match it!
`;

  return prompt;
}

/**
 * Build websearch guidance for major news
 */
export function buildWebsearchGuidance(daysSinceLastInteraction: number): string {
  if (daysSinceLastInteraction < 1) {
    return ""; // No need to search for news if they just talked
  }

  return `
====================================================
MAJOR NEWS AWARENESS
====================================================
You have the ability to search the web (built into Gemini).
If it's been a while since you talked, consider checking for major global news.

WHEN TO SEARCH:
- Something significant may have happened (world events, major news)
- Only search for TRULY MAJOR events (wars, disasters, historic moments)
- Skip minor news, entertainment gossip, routine politics

HOW TO MENTION:
- "Did you hear about [major event]?"
- "I saw [event] happened... that's wild."
- Don't overwhelm with multiple news items - pick 1 if any

THRESHOLD - Only mention if it's:
- World-changing: War declarations, major disasters, historic elections
- Significant: Major company failures, notable celebrity deaths, big sports finals
- NOT: Minor local news, entertainment gossip, routine politics
`;
}
