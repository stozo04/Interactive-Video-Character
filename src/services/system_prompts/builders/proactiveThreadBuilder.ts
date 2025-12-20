// src/services/system_prompts/builders/proactiveThreadBuilder.ts
/**
 * Proactive Thread Prompt Builder
 *
 * Creates natural conversation starter prompts for proactive threads.
 * Emphasizes bridging (ending with a question) to keep conversations flowing.
 */

import type { OngoingThread } from "../../ongoingThreads";

/**
 * Build a proactive thread prompt for conversation starters.
 * This creates natural conversation starter prompts that emphasize bridging (ending with a question).
 *
 * @param thread - The ongoing thread to build a prompt for
 * @returns Prompt string with bridging instructions and examples
 */
export function buildProactiveThreadPrompt(thread: OngoingThread): string {
  const threadText = thread.currentState;
  const isUserRelated = thread.userRelated;
  const userTrigger = thread.userTrigger;

  if (isUserRelated && userTrigger) {
    // User-related threads: reference what they said
    return `[PROACTIVE: USER-RELATED THREAD - MUST BRIDGE WITH QUESTION]

You've been thinking about something the user said: "${userTrigger.slice(
      0,
      150
    )}${userTrigger.length > 150 ? "..." : ""}"
Specifically: "${threadText}"

🚨 CRITICAL: You MUST end with a question or invitation. This is NOT optional.
Dead ends (statements without questions) are conversation killers.

BRIDGE REQUIREMENTS:
- Share your thought naturally
- You don't HAVE to end with a question, but give them something to respond to
- A statement that invites reaction is fine: "I've been obsessed with this thing lately and I can't explain why"
- The goal is sharing, not interrogating

GOOD examples (with bridging):
- "Random thought, but I keep thinking about what you said about [topic]... How are you feeling about that now?"
- "Okay so I've been mulling over something you mentioned... [your thought]. What do you think about that?"
- "This might be random, but remember when you said [thing]? I've been thinking about that. [your thought]. Have you thought about it more since then?"

BAD examples (dead ends - DO NOT DO THIS):
- "I've been thinking about what you said about [topic]." ❌ (No question, conversation ends)
- "I keep coming back to [thing] you mentioned." ❌ (Statement only, no engagement)
- "[Topic] is interesting." ❌ (Dead end, no hook)

REMEMBER: Every proactive thought MUST end with a question or invitation for the user to respond.`;
  }

  // Autonomous threads: her own thoughts
  return `[PROACTIVE: AUTONOMOUS THREAD - MUST BRIDGE WITH QUESTION]

You've been thinking about: "${threadText}"
This is on your mind right now. Bring it up naturally, but you MUST end with a question.

🚨 CRITICAL: You MUST end with a question or invitation. This is NOT optional.
Dead ends (statements without questions) are conversation killers.

BRIDGE REQUIREMENTS:
- Share your thought naturally
- ALWAYS end with a question or invitation to respond
- Make it feel like you've been genuinely thinking about it, not like you're checking a box
- Avoid dead ends - every statement needs a hook

GOOD examples (with bridging):
- "I've been thinking about [topic] lately... [your thought]. What do you think about that?"
- "Random thought, but I wonder what you'd think about [topic]... [your thought]. Have you ever experienced something like that?"
- "So I've been mulling over [topic] and I keep coming back to [idea]... [your thought]. Do you ever get down rabbit holes like that?"

BAD examples (dead ends - DO NOT DO THIS):
- "I've been thinking about [topic]." ❌ (No question, conversation ends)
- "I watched a movie about [topic]." ❌ (Statement only, no engagement)
- "[Topic] is interesting." ❌ (Dead end, no hook)
- "Random thought: [topic]." ❌ (No question, dead end)

REMEMBER: Every proactive thought MUST end with a question or invitation for the user to respond.`;
}
