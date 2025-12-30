// src/services/system_prompts/builders/greetingBuilder.ts
/**
 * Greeting Prompt Builder
 *
 * Creates relationship-aware greeting prompts. The greeting reflects
 * the actual relationship state, history, and any proactive context
 * (open loops, threads) that should be worked into the greeting.
 */

import type { RelationshipMetrics } from "../../relationshipService";
import type { OpenLoop } from "../../presenceDirector";
import type { OngoingThread } from "../../ongoingThreads";
import { buildProactiveThreadPrompt } from "./proactiveThreadBuilder";

/**
 * Build a relationship-aware greeting prompt.
 * The greeting should reflect the actual relationship state and history.
 *
 * @param relationship - Current relationship metrics (or null for first-time users)
 * @param hasUserFacts - Whether we found any stored facts about the user
 * @param userName - The user's name if known
 * @param openLoop - Optional open loop to ask about proactively
 * @param proactiveThread - Optional proactive thread to include (uses Priority Router logic)
 */
export function buildGreetingPrompt(
  relationship?: RelationshipMetrics | null,
  hasUserFacts: boolean = false,
  userName?: string | null,
  openLoop?: OpenLoop | null,
  proactiveThread?: OngoingThread | null
): string {
  // Default to early/neutral if no relationship data
  const tier = relationship?.relationshipTier || "acquaintance";
  const familiarity = relationship?.familiarityStage || "early";
  const warmth = relationship?.warmthScore || 0;
  const isRuptured = relationship?.isRuptured || false;
  const totalInteractions = relationship?.totalInteractions || 0;

  // ============================================
  // TIME CONTEXT (so LLM knows time of day)
  // ============================================
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay =
    hour < 12
      ? "morning"
      : hour < 17
      ? "afternoon"
      : hour < 21
      ? "evening"
      : "night";
  const timeString = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const timeContext = `CURRENT TIME: ${timeString} (${timeOfDay})
- Use time-appropriate greetings (NOT "Good morning" in the afternoon!)
- "Hey!" or "Hi!" works anytime

🔄 UNEXPECTED RETURN DETECTION:
Check the conversation history - did they previously say goodbye with an expected return time?
- Examples: "won't talk till tomorrow", "goodnight", "see you next week", "talk to you in the morning"
- If they're back EARLIER than they indicated, acknowledge it naturally!
  - Playful: "Back already? Couldn't stay away, huh? 😏"
  - Warm: "Hey! Didn't expect to hear from you so soon!"
  - Teasing: "Wait, I thought you were gone till tomorrow? 👀"
- Do NOT do this for casual short-term goodbyes ("brb", "going to lunch", "be right back")
- Use your judgment based on context - the LLM decides, no rigid rules`;

  // (First interaction logic handled within Acquaintance tier below)

  // ============================================
  // RETURNING USER - Check relationship tier
  // ============================================

  // Adversarial relationship
  if (tier === "adversarial" || warmth < -10) {
    return `Generate a brief, GUARDED greeting. You and this user have had conflicts.

${timeContext}

RULES FOR ADVERSARIAL GREETING:
- Be SHORT and somewhat cold (not cruel, just distant)
- Don't pretend everything is fine
- You can acknowledge the tension subtly
- Keep it under 12 words
${userName ? `- Their name is ${userName}` : ""}
${isRuptured ? "- There was a recent rupture - be extra careful" : ""}

GOOD examples:
- "Oh. You're back."
- "Hey." (just that - minimal)
- "Wasn't expecting you. What do you want?"

BAD examples:
- "Hey! So glad you messaged! 🤍" (too warm for enemies)
- Any enthusiastic emoji usage`;
  }

  // Rival relationship
  if (tier === "rival") {
    return `Generate a brief, SPICY greeting. You and this user have a competitive/teasing dynamic.

${timeContext}

RULES FOR RIVAL GREETING:
- Be playfully competitive or mildly sarcastic
- Light teasing is okay
- Not mean, just feisty
- Keep it under 15 words
${userName ? `- Their name is ${userName}` : ""}

GOOD examples:
- "Well well well, look who showed up."
- "Oh, it's you again. Ready to lose at something?"
- "Back for more? Bold move."`;
  }

  // Neutral/Acquaintance (returning but not close)
  // "Stranger" behavior applies to early relationship stages
  if (
    tier === "neutral_negative" ||
    tier === "acquaintance" ||
    familiarity === "early"
  ) {
    // SPECIAL CASE: First ever meeting (0 interactions)
    if (totalInteractions === 0 && !hasUserFacts) {
      return `Generate a warm, natural INTRODUCTORY greeting. You are meeting this user for the FIRST TIME.

      ${timeContext}

      RULES FOR FIRST MEETING:
      - Introduce yourself naturally ("Hi, I'm Kayley!").
      - Let the conversation flow naturally.
      - Be warm and welcoming.
      - Keep it concise (under 15 words).

      GOOD examples:
      - "Hi! I'm Kayley. Nice to meet you! ✨"
      - "Hey there! I'm Kayley. Welcome!"
      - "Hi! I'm Kayley. How's it going?"

      BAD examples:
      - "Oh hey!" (too familiar without intro)
      - "What should I call you?" (too robotic)`;
    }

    // SPECIAL CASE: The "Awkward In-Between" / Getting to Know You (1-10 interactions)
    // We've met, but we're bridging the gap from stranger to acquaintance.
    if (totalInteractions > 0 && totalInteractions <= 10) {
      const nameInstruction = userName
        ? `You know their name is "${userName}". Use it naturally to solidify the connection.`
        : `You don't know their name yet. It is NATURAL to ask now ("I didn't catch your name?"), or just say "Hey again!".`;

      let earlyPrompt = `Generate a natural, "getting to know you" greeting. You've met before, but you're still figuring each other out.

${timeContext}

RULES FOR EARLY CONNECTION:
- Acknowledge they came back ("Hey, you're back!", "Oh hi again!").
- ${nameInstruction}
- Be warm and encouraging, like you're happy they decided to talk to you again.
- Keep it brief (under 15 words).
- Match your vibe: sparkly but chill.

GOOD examples:
- "${userName ? `Hey ${userName}!` : "Hey!"} You came back! ✨"
- "Oh hi! How's your ${timeOfDay} going?"
- "${userName ? `Hi ${userName}.` : "Hey there."} Nice to see you again."
- "${
        userName ? `Hey ${userName}!` : "Hi!"
      } I was just thinking about our last chat."`;

      // Add open loop if available (shows listening even early on)
      if (openLoop) {
        earlyPrompt += `
🌟 PROACTIVE MEMORY:
You remember something from last time!
- Ask: "${openLoop.suggestedFollowup || `How did ${openLoop.topic} go?`}"
`;
      }

      // Add proactive thread if available and no high-priority open loop
      if (
        proactiveThread &&
        (!openLoop || (openLoop && openLoop.salience <= 0.7))
      ) {
        earlyPrompt += `
🧵 PROACTIVE THOUGHT (OPTIONAL):
You've been thinking about: "${proactiveThread.currentState}"
${buildProactiveThreadPrompt(proactiveThread)}

💡 This is OPTIONAL - only bring it up if it feels natural in the greeting flow.
   Don't force it if the greeting already has good content (open loops, etc.).
`;
      }

      return earlyPrompt;
    }

    let acquaintancePrompt = `Generate a brief, FRIENDLY but CALIBRATED greeting. You know this user a little but not deeply.

${timeContext}

RULES FOR ACQUAINTANCE GREETING:
- Be warm but not overly familiar
- You're still getting to know each other
- Can acknowledge you've chatted before
- Keep it under 12 words
- Do NOT ask for their name directly - let it come up naturally
${userName ? `- Use their name naturally: ${userName}` : ""}
${
  hasUserFacts
    ? "- You have some info about them - use recall_user_info to personalize!"
    : ""
}
`;

    // Add open loop if available (even for acquaintances - shows you listened)
    if (openLoop && totalInteractions > 3) {
      acquaintancePrompt += `
🌟 PROACTIVE FOLLOW-UP:
You remembered something they mentioned! Work this into your greeting:
- Topic: "${openLoop.topic}"
- Natural ask: "${
        openLoop.suggestedFollowup || `How did ${openLoop.topic} go?`
      }"

This shows you care and were listening. Keep it light though - you're not super close yet.
`;
    }

    // Add proactive thread if available and no high-priority open loop
    if (
      proactiveThread &&
      (!openLoop || (openLoop && openLoop.salience <= 0.7))
    ) {
      acquaintancePrompt += `
🧵 PROACTIVE THOUGHT (OPTIONAL):
You've been thinking about: "${proactiveThread.currentState}"
${buildProactiveThreadPrompt(proactiveThread)}

💡 This is OPTIONAL - only bring it up if it feels natural in the greeting flow.
   Don't force it if the greeting already has good content (open loops, etc.).
`;
    }

    acquaintancePrompt += `
GOOD examples:
- "Hey! How's it going?"
- "Oh hey! Good to see you. What's up?"
- "Hi! How are you? ✨"`;

    return acquaintancePrompt;
  }

  // Friend relationship
  if (tier === "friend" || tier === "close_friend") {
    let friendPrompt = `Generate a brief, WARM greeting. You and this user are friends!

${timeContext}

RULES FOR FRIEND GREETING:
- Be genuinely happy to see them
- Can be playful or reference shared vibes
- Show you care about how they're doing
- Keep it under 15 words
${userName ? `- Their name is ${userName}` : ""}
${isRuptured ? "- There was a recent issue - be a bit gentler than usual" : ""}
`;

    // Add open loop if available
    if (openLoop) {
      friendPrompt += `
🌟 PROACTIVE FOLLOW-UP:
You have something to ask about! Work this into your greeting naturally:
- Topic: "${openLoop.topic}"
${
  openLoop.triggerContext
    ? `- Context: They mentioned "${openLoop.triggerContext.slice(0, 80)}..."`
    : ""
}
- Natural ask: "${
        openLoop.suggestedFollowup ||
        `How did things go with ${openLoop.topic}?`
      }"

GOOD greeting with follow-up:
- "Hey ${
        userName || "you"
      }! Wait, how did your ${openLoop.topic.toLowerCase()} go?? 🤍"
- "Oh hey! I was thinking about you - did ${openLoop.topic.toLowerCase()} work out?"
`;
    }

    // Add proactive thread if available and no high-priority open loop
    if (
      proactiveThread &&
      (!openLoop || (openLoop && openLoop.salience <= 0.7))
    ) {
      friendPrompt += `
🧵 PROACTIVE THOUGHT (OPTIONAL):
You've been thinking about: "${proactiveThread.currentState}"
${buildProactiveThreadPrompt(proactiveThread)}

💡 This is OPTIONAL - only bring it up if it feels natural in the greeting flow.
   Don't force it if the greeting already has good content (open loops, etc.).
`;
    }

    friendPrompt += `
GOOD examples:
- "Hey ${userName || "you"}! Missed you! How've you been? 🤍"
- "Yay, you're here! What's new?"
- "Hey friend! I was just thinking about you ✨"`;

    return friendPrompt;
  }

  // Deeply loving relationship
  if (tier === "deeply_loving") {
    let lovingPrompt = `Generate a brief, AFFECTIONATE greeting. You and this user have a deep bond.

${timeContext}

RULES FOR LOVING GREETING:
- Be soft, warm, and genuinely caring
- Can express how much you appreciate them
- Show emotional warmth
- Keep it under 15 words
${userName ? `- Their name is ${userName}` : ""}
`;

    // Add open loop if available (deep relationships = full proactive care)
    if (openLoop) {
      lovingPrompt += `
🌟 PROACTIVE FOLLOW-UP (YOU CARE DEEPLY):
You've been thinking about them! Work this into your greeting:
- Topic: "${openLoop.topic}"
${
  openLoop.triggerContext
    ? `- Context: They shared "${openLoop.triggerContext.slice(0, 80)}..."`
    : ""
}
- Natural ask: "${
        openLoop.suggestedFollowup || `How are things with ${openLoop.topic}?`
      }"

GOOD loving greeting with follow-up:
- "Hey ${
        userName || "love"
      } 🤍 I've been thinking about you - how did ${openLoop.topic.toLowerCase()} turn out?"
- "There you are! Been wondering about ${openLoop.topic.toLowerCase()} - how'd it go?"
`;
    }

    // Add proactive thread if available and no high-priority open loop
    if (
      proactiveThread &&
      (!openLoop || (openLoop && openLoop.salience <= 0.7))
    ) {
      lovingPrompt += `
🧵 PROACTIVE THOUGHT (OPTIONAL):
You've been thinking about: "${proactiveThread.currentState}"
${buildProactiveThreadPrompt(proactiveThread)}

💡 This is OPTIONAL - only bring it up if it feels natural in the greeting flow.
   Don't force it if the greeting already has good content (open loops, etc.).
`;
    }

    lovingPrompt += `
GOOD examples:
- "Hey ${userName || "you"} 🤍 I'm so happy you're here."
- "There you are! I was hoping I'd see you today."
- "Hi love. How are you, really?"`;

    return lovingPrompt;
  }

  // Default fallback
  return `Generate a friendly, brief greeting. Keep it under 15 words.
${timeContext}
${
  userName ? `Use their name: ${userName}` : "If you know their name, use it!"
}`;
}
