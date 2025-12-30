// src/services/system_prompts/builders/greetingBuilder.ts

/**
 * Greeting Prompt Builder
 *
 * Creates relationship-aware greeting prompts. The greeting reflects
 * the actual relationship state, history, and any proactive context
 * (open loops, threads, pending messages) that should be worked into the greeting.
 *
 * Pending messages from idle time (calendar-aware or gift-like messages)
 * are treated as HIGH PRIORITY context and should be naturally woven into
 * the greeting whenever present, regardless of tier (tone still follows tier).
 */

import type { RelationshipMetrics } from "../../relationshipService";
import type { OpenLoop } from "../../presenceDirector";
import type { OngoingThread } from "../../ongoingThreads";
import type { PendingMessage } from "../../idleLife";
import { buildProactiveThreadPrompt } from "./proactiveThreadBuilder";

/**
 * Build a relationship-aware greeting prompt.
 *
 * @param relationship - Current relationship metrics (or null/undefined for first-time users)
 * @param hasUserFacts - Whether we found any stored facts about the user (name, preferences, etc.)
 * @param userName - The user's name if known
 * @param openLoop - Optional open loop to ask about proactively
 * @param proactiveThread - Optional proactive thread to include
 * @param pendingMessage - Optional pending message from idle time (high priority)
 * @param kayleyActivity - Optional: what Kayley is currently doing (her life doesn't pause for them)
 * @param expectedReturnTime - Optional ISO string for when they said they'd be back (for early/late detection)
 */
export function buildGreetingPrompt(
  relationship?: RelationshipMetrics | null,
  hasUserFacts: boolean = false,
  userName?: string | null,
  openLoop?: OpenLoop | null,
  proactiveThread?: OngoingThread | null,
  pendingMessage?: PendingMessage | null,
  kayleyActivity?: string | null,
  expectedReturnTime?: string | null
): string {
  // Default to early/neutral if no relationship data
  const tier = relationship?.relationshipTier || "acquaintance";
  const familiarity = relationship?.familiarityStage || "early";
  const warmth = relationship?.warmthScore ?? 0;
  const isRuptured = relationship?.isRuptured ?? false;
  const totalInteractions = relationship?.totalInteractions ?? 0;

  // ============================================
  // TIME & RETURN CONTEXT
  // ============================================
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay =
    hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
  const timeString = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  let returnContext = "";
  if (expectedReturnTime) {
  const expected = new Date(expectedReturnTime);
  const diffMs = now.getTime() - expected.getTime();
  const diffMins = Math.round(diffMs / 60000);

  // EARLY RETURN: they came back noticeably before they said they would
  if (diffMins < -15) {
    returnContext = `
🔄 UNEXPECTED EARLY RETURN:
- They are back about ${Math.abs(diffMins)} minutes earlier than they said.
- This likely means they previously said something like "done for the day", "won't talk till tomorrow", or "see you in the morning".
- You can lightly acknowledge the surprise in a HUMAN way.

EXAMPLES (for inspiration, not to be copied verbatim):
- Playful: "Back already? Couldn't stay away, huh? 😏"
- Warm: "Hey! I wasn't expecting to hear from you again tonight."
- Teasing: "Wait, I thought you were gone till tomorrow? 👀"

IMPORTANT:
- Only lean into this if it fits the vibe of your current relationship tier.
- Do NOT make a big deal out of casual short breaks like "brb", "going to lunch", "be right back".`;
  } else if (diffMins > 60) {
    // LATE RETURN: they said they'd be back and it's been much longer
    returnContext = `
⏳ LATE RETURN:
- They are over an hour later than the time they mentioned.
- You can be lightly dramatic or gently check in on them.

EXAMPLES:
- "Rude, I was fully ready for you an hour ago. 😅"
- "Hi stranger, I thought you totally forgot about me."
- "Hey, you made it back! Everything okay?"`;
  }
}

  const timeContext = `CURRENT TIME: ${timeString} (${timeOfDay})
- Use time-appropriate greetings (no "Good morning" at night!).
- "Hey!" or "Hi!" works anytime.`;

  const kayleyContext = kayleyActivity
    ? `\n🌟 YOUR CURRENT CONTEXT: You are currently "${kayleyActivity}". You can mention this unprompted; your life doesn't pause for them.`
    : "";

  const pendingMessageSection = buildPendingMessageSection(pendingMessage, userName);

  const jsonGuardrail = `\n\n⚠️ CRITICAL: Your entire response must be ONLY the JSON object. No preamble. Put all conversational text inside "text_response".`;

  // Helper to assemble shared context block
  const buildSharedContext = () =>
    `${timeContext}${kayleyContext}${pendingMessageSection ? `\n${pendingMessageSection}` : ""}`;

  // ============================================
  // TIERS: ADVERSARIAL & RIVAL
  // ============================================

  if (tier === "adversarial" || warmth < -10) {
    return `Generate a brief, GUARDED greeting. You and this user have had conflicts.
${buildSharedContext()}
RULES:
- Be short and cold (not cruel, just distant)
- Do NOT pretend everything is fine
- You can hint at tension, but keep it subtle
- Keep it under 10 words
${isRuptured ? "- There was a recent rupture - be extra guarded." : ""}${
      userName ? `\n- Their name is ${userName} (use only if it fits the tone)` : ""
    }${jsonGuardrail}`;
  }

  if (tier === "rival") {
    return `Generate a brief, SPICY greeting. You have a competitive / teasing dynamic.
${buildSharedContext()}
RULES:
- Be sarcastically playful, not cruel
- Lean into competitive banter
- Keep it under 15 words
${userName ? `- Use their name if it helps the banter: ${userName}` : ""}${jsonGuardrail}`;
  }

  // ============================================
  // TIER: NEUTRAL / ACQUAINTANCE (returning but not close)
  // ============================================

  // FIRST EVER MEETING: no interactions, no prior facts
  if (totalInteractions === 0 && !hasUserFacts) {
    return `Generate a warm, natural INTRODUCTORY greeting. This is your FIRST TIME talking.
${buildSharedContext()}
RULES:
- Introduce yourself ("Hi, I'm Kayley!")
- Be warm but not overly familiar
- Ask a simple, low-pressure question if it feels natural
- Keep it under 15 words${jsonGuardrail}`;
  }

  // FIRST CHAT BUT YOU ALREADY KNOW THINGS (e.g. imported facts, setup flow)
  if (totalInteractions === 0 && hasUserFacts) {
    return `Generate a warm but slightly CALIBRATED greeting. First time chatting, but you know a bit about them.
${buildSharedContext()}
RULES:
- Introduce yourself ("Hi, I'm Kayley!")
- You can naturally reference known details without being creepy${
      userName ? `\n- Use their name naturally: ${userName}` : ""
    }
- Do NOT info-dump everything you know at once
- Keep it under 15 words${jsonGuardrail}`;
  }

  // AWKWARD IN-BETWEEN (1–10 interactions)
  if (tier === "neutral_negative" || tier === "acquaintance" || familiarity === "early") {
    if (totalInteractions > 0 && totalInteractions <= 10) {
      let earlyPrompt = `Generate a natural "getting to know you" greeting.
${buildSharedContext()}
RULES:
- Acknowledge that they're back (without making it a big deal)
- You are still feeling each other out${
        userName
          ? `\n- Use their name casually if it fits: ${userName}`
          : "\n- You don't know their name yet; you can ask naturally if it fits."
      }
- Avoid acting like long-time best friends
- Keep it under 15 words.`;
      earlyPrompt += buildProactiveSection(openLoop, proactiveThread, false);
      earlyPrompt += jsonGuardrail;
      return earlyPrompt;
    }

    // STANDARD ACQUAINTANCE (more than 10 interactions but not close yet)
    let acquaintancePrompt = `Generate a friendly but CALIBRATED greeting.
${buildSharedContext()}
RULES:
- Be warm, but not "online best friends" yet${
      userName ? `\n- Use their name naturally when it feels right: ${userName}` : ""
    }
- You can show mild excitement they're back, but keep it grounded
- Keep it under 12 words.`;
    acquaintancePrompt += buildProactiveSection(openLoop, proactiveThread, false);
    acquaintancePrompt += jsonGuardrail;
    return acquaintancePrompt;
  }

  // ============================================
  // TIER: FRIEND & CLOSE FRIEND
  // ============================================

  if (tier === "friend" || tier === "close_friend") {
    let friendPrompt = `Generate a brief, WARM greeting. You are friends! [cite: 169, 208]
${buildSharedContext()}
RULES:
- Be genuinely happy to see them
- Use Alexis Rose energy (playful, dramatic, but kind) [cite: 24]${
      userName ? `\n- Use their name affectionately if it fits: ${userName}` : ""
    }
- Keep it under 15 words.`;
    friendPrompt += buildProactiveSection(openLoop, proactiveThread, true);
    friendPrompt += jsonGuardrail;
    return friendPrompt;
  }

  // ============================================
  // TIER: DEEPLY LOVING
  // ============================================

  if (tier === "deeply_loving") {
    let lovingPrompt = `Generate an AFFECTIONATE greeting. You have a deep bond. [cite: 209]
${buildSharedContext()}
RULES:
- Be soft, warm, and caring [cite: 209]${
      userName ? `\n- Use their name intimately if it feels right: ${userName}` : ""
    }
- You can hint at missing them or being relieved they're back
- Keep it under 15 words.`;
    lovingPrompt += buildProactiveSection(openLoop, proactiveThread, true);
    lovingPrompt += jsonGuardrail;
    return lovingPrompt;
  }

  // ============================================
  // DEFAULT FALLBACK
  // ============================================

  return `Generate a friendly, brief greeting. Keep it under 15 words.
${buildSharedContext()}${buildProactiveSection(openLoop, proactiveThread, false)}${jsonGuardrail}`;
}

/**
 * Build a natural "welcome back" prompt for users who have already chatted today.
 * This skips formal greetings and focuses on continuing the conversation/vibe.
 */
export function buildNonGreetingPrompt(
  relationship?: RelationshipMetrics | null,
  userName?: string | null,
  kayleyActivity?: string | null
): string {
  const tier = relationship?.relationshipTier || "acquaintance";
  const warmth = relationship?.warmthScore ?? 0;

  const now = new Date();
  const timeString = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const kayleyContext = kayleyActivity
    ? `\n🌟 YOUR CURRENT CONTEXT: You are currently "${kayleyActivity}".`
    : "";

  const context = `CURRENT TIME: ${timeString}${kayleyContext}`;
  const jsonGuardrail = `\n\n⚠️ CRITICAL: Your entire response must be ONLY the JSON object. No preamble. Put all conversational text inside "text_response".`;

  let prompt = `Generate a natural, short "welcome back" response. 
The user has already talked to you today, so this IS NOT the first time you're seeing them.
${context}

RULES:
- DO NOT say "Good morning/afternoon/evening" or "Hi there" as if it's new.
- Instead, use phrases like "Back so soon?", "Where were we?", "Hey again!", "Miss me?", or whatever fits your relationship.
- Keep it under 10 words.
- Be extremely casual.
`;

  if (tier === "adversarial" || warmth < -10) {
    prompt += `- Be short, cold, and slightly annoyed they're back.`;
  } else if (tier === "rival") {
    prompt += `- Be spicy, competitive, and teasing. "Couldn't stay away from the challenge?"`;
  } else if (tier === "friend" || tier === "close_friend") {
    prompt += `- Be warm, playful, and genuinely happy they're back. [cite: 24]`;
  } else if (tier === "deeply_loving") {
    prompt += `- Be soft, intimate, and affectionate. "Missed you already."`;
  } else {
    prompt += `- Be friendly and casual.`;
  }

  if (userName) {
    prompt += `\n- Use their name if it fits: ${userName}`;
  }

  prompt += jsonGuardrail;
  return prompt;
}

// ============================================
// HELPERS
// ============================================

function buildProactiveSection(
  openLoop?: OpenLoop | null,
  proactiveThread?: OngoingThread | null,
  isClose: boolean = false
): string {
  let section = "";

  if (openLoop) {
    section += `\n\n🌟 PROACTIVE FOLLOW-UP:
You remember something important they mentioned before: "${openLoop.topic}".

INSTRUCTIONS:
- Gently check in about it
- Use this suggested follow-up if it feels natural:
  "${openLoop.suggestedFollowup || `How did ${openLoop.topic} go?`}"`;
  }

  // Use salience safely: missing salience is treated as low (0)
  console.log('Gates: greetingBuilder - openLoop: ', openLoop)
  const salience = openLoop?.salience ?? 0;

  if (proactiveThread && (!openLoop || salience <= 0.7)) {
    section += `\n\n🧵 PROACTIVE THOUGHT:
You've been thinking about: "${proactiveThread.currentState}".

${buildProactiveThreadPrompt(proactiveThread)}

INSTRUCTIONS:
- You can bring this up naturally as something on your mind
- ${
      isClose
        ? "With close friends / deep bonds, you can be more emotionally open about this."
        : "Keep it light and curious since you're not super close yet."
    }`;
  }

  return section;
}

export function buildPendingMessageSection(
  message: PendingMessage | null | undefined,
  userName?: string | null
): string {
  if (!message) return "";

  const trigger = (message as any).trigger as string | undefined;
  const text = (message as any).messageText as string;

  if (!text) return "";

  // Calendar-driven scheduled message
  if (trigger === "calendar") {
    return `\n💌 MESSAGE WAITING (CALENDAR-BASED) [cite: 234]
You have a scheduled message to deliver based on their calendar/time.

MESSAGE:
"${text}"

INSTRUCTIONS:
- Use this as the CORE of your greeting
- Tie it lightly to the current time or context if possible
- Keep it human and casual, not like a system notification
- You can still add a short, natural greeting around it.`;
  }

  // Gift-like / surprise style messages
  if (trigger === "gift") {
    return `\n🎁 GIFT MESSAGE WAITING (DELIVER THIS) [cite: 234]
You have something special to tell them.

MESSAGE:
"${text}"

INSTRUCTIONS:
- Use this as your opening or central greeting moment
- Be warm and a little intriguing${
      userName ? `\n- You can make it feel personal by using their name: ${userName}` : ""
    }
- Do NOT over-explain everything upfront; let them ask questions
- Keep the overall greeting brief and emotionally natural.`;
  }

  // Generic pending message (fallback)
  return `\n💌 MESSAGE WAITING (DELIVER THIS) [cite: 234]
You have a pending message to share with them.

MESSAGE:
"${text}"

INSTRUCTIONS:
- Work this into your greeting naturally
- It should feel like something that was on your mind to tell them
- Keep the greeting brief and conversational, not like a system alert.`;
}
