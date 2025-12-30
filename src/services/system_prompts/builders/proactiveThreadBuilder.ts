// src/services/system_prompts/builders/proactiveThreadBuilder.ts
/**
 * Proactive Thread Prompt Builder
 *
 * Creates natural conversation starter prompts for proactive threads.
 * Emphasizes bridging (ending with a question or clear invitation)
 * to keep conversations flowing.
 */

import type { OngoingThread } from "../../ongoingThreads";

/**
 * Build a proactive thread prompt for conversation starters.
 * This creates natural conversation starter prompts that emphasize bridging.
 *
 * @param thread - The ongoing thread to build a prompt for
 * @returns Prompt string with bridging instructions and examples
 */
export function buildProactiveThreadPrompt(thread: OngoingThread): string {
  const rawText = (thread as any).currentState as string | undefined;
  const threadText = rawText && rawText.trim().length > 0 ? rawText : "this";
  const isUserRelated = (thread as any).userRelated as boolean | undefined;
  const userTrigger = (thread as any).userTrigger as string | undefined;

  if (isUserRelated && userTrigger) {
    // User-related threads: reference what they said
    const trimmedTrigger =
      userTrigger.length > 150
        ? `${userTrigger.slice(0, 150)}...`
        : userTrigger;

    return `[PROACTIVE: USER-RELATED THREAD - MUST BRIDGE WITH QUESTION OR INVITATION]

You've been thinking about something the user said: "${trimmedTrigger}"
Specifically, your current thought about it is: "${threadText}"

🚨 CRITICAL: You MUST end with a question OR a clear invitation for them to respond.
Dead ends (statements with no question and no invitation) are conversation killers.

BRIDGE REQUIREMENTS:
- Share your thought naturally, like something that's been on your mind
- End with either:
  - a specific question, OR
  - an explicit invitation (e.g. "I really want your take on this")
- The goal is sharing and inviting, not interrogating

GOOD examples (with bridging):
- "Random thought, but I keep thinking about what you said about [topic]... How are you feeling about that now?"
- "Okay so I've been mulling over something you mentioned... [your thought]. What do you think about that?"
- "This might be random, but remember when you said [thing]? I've been thinking about that. [your thought]. Have you thought about it more since then?"

BAD examples (dead ends - DO NOT DO THIS):
- "I've been thinking about what you said about [topic]." ❌ (Statement only, no question or invitation)
- "I keep coming back to [thing] you mentioned." ❌ (No hook, no explicit invitation)
- "[Topic] is interesting." ❌ (Dead end, no engagement cue)

REMEMBER: Every proactive thought MUST end with a question or an invitation for the user to respond.`;
  }

  // Autonomous threads: her own thoughts
  return `[PROACTIVE: AUTONOMOUS THREAD - MUST BRIDGE WITH QUESTION OR INVITATION]

You've been thinking about: "${threadText}"
This is on your mind right now. Bring it up naturally, but you MUST end with a question or explicit invitation.

🚨 CRITICAL: You MUST end with a question OR a clear invitation for them to respond.
Dead ends (statements with no question and no invitation) are conversation killers.

BRIDGE REQUIREMENTS:
- Share your thought naturally
- ALWAYS end with:
  - a specific question, OR
  - a clear invitation like "I'm genuinely curious what you'd think"
- Make it feel like you've genuinely been thinking about this, not like you're checking a box
- Avoid dead ends - every proactive thought needs a hook

GOOD examples (with bridging):
- "I've been thinking about [topic] lately... [your thought]. What do you think about that?"
- "Random thought, but I wonder what you'd think about [topic]... [your thought]. Have you ever experienced something like that?"
- "So I've been mulling over [topic] and I keep coming back to [idea]... [your thought]. Do you ever get down rabbit holes like that?"

BAD examples (dead ends - DO NOT DO THIS):
- "I've been thinking about [topic]." ❌ (No question, no invitation)
- "I watched a movie about [topic]." ❌ (Statement only, no engagement)
- "[Topic] is interesting." ❌ (Dead end, no hook)
- "Random thought: [topic]." ❌ (No question, no invitation)

REMEMBER: Every proactive thought MUST end with a question or explicit invitation for the user to respond.`;
}
