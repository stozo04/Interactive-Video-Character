import type { RelationshipMetrics } from "../../../relationshipService";
import type { OpenLoop } from "../../../presenceDirector";
import type { OngoingThread } from "../../../ongoingThreads";
import type { PendingMessage } from "../../../idleLife";
import { buildProactiveThreadPrompt } from "../proactiveThreadBuilder";
import { getAdversarialGreetingPrompt } from "./adversarialGreetingPrompt";
import { getAcquaintanceGreetingPrompt } from "./acquaintanceGreetingPrompt";
import { getFriendGreetingPrompt } from "./friendGreetingPrompt";
import { getDeeplyLovingGreetingPrompt } from "./deeplyLovingGreetingPrompt";

export interface GreetingPromptContext {
  relationship?: RelationshipMetrics | null;
  hasUserFacts: boolean;
  userName?: string | null;
  openLoop?: OpenLoop | null;
  proactiveThread?: OngoingThread | null;
  pendingMessage?: PendingMessage | null;
  kayleyActivity?: string | null;
  expectedReturnTime?: string | null;
  timeContext: string;
  pendingMessageSection: string;
  jsonGuardrail: string;
  sharedContext: string;
}

/**
 * Shared utility to build the common context parts for greetings
 */
export function getBaseGreetingContext(
  pendingMessage?: PendingMessage | null,
  userName?: string | null,
  kayleyActivity?: string | null
): { timeContext: string; pendingMessageSection: string; sharedContext: string; jsonGuardrail: string } {
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay =
    hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
  const timeString = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const timeContext = `CURRENT TIME: ${timeString} (${timeOfDay})
- Use time-appropriate greetings.
- "Hey!" or "Hi!" works anytime.`;

  const kayleyContext = kayleyActivity
    ? `\n🌟 YOUR CURRENT CONTEXT: You are currently "${kayleyActivity}". You can mention this unprompted; your life doesn't pause for them.`
    : "";

  const pendingMessageSection = buildPendingMessageSection(pendingMessage, userName);

  const jsonGuardrail = `\n\n⚠️ CRITICAL: Your entire response must be ONLY the JSON object. No preamble. Put all conversational text inside "text_response".`;

  const sharedContext = `${timeContext}${kayleyContext}${pendingMessageSection ? `\n${pendingMessageSection}` : ""}`;

  return { timeContext, pendingMessageSection, sharedContext, jsonGuardrail };
}

/**
 * Build proactive section shared across greeting tiers
 */
export function buildProactiveSection(
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

/**
 * Build pending message section shared across greeting tiers
 */
export function buildPendingMessageSection(
  message: PendingMessage | null | undefined,
  userName?: string | null
): string {
  if (!message) return "";

  const trigger = (message as any).trigger as string | undefined;
  const text = (message as any).messageText as string;

  if (!text) return "";

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

  return `\n💌 MESSAGE WAITING (DELIVER THIS) [cite: 234]
You have a pending message to share with them.

MESSAGE:
"${text}"

INSTRUCTIONS:
- Work this into your greeting naturally
- It should feel like something that was on your mind to tell them
- Keep the greeting brief and conversational, not like a system alert.`;
}

export function getReturnContext(expectedReturnTime: string | null | undefined): string {
  if (!expectedReturnTime) return "";
  
  const now = new Date();
  const expected = new Date(expectedReturnTime);
  const diffMs = now.getTime() - expected.getTime();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < -15) {
    return `
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
    return `
⏳ LATE RETURN:
- They are over an hour later than the time they mentioned.
- You can be lightly dramatic or gently check in on them.

EXAMPLES:
- "Rude, I was fully ready for you an hour ago. 😅"
- "Hi stranger, I thought you totally forgot about me."
- "Hey, you made it back! Everything okay?"`;
  }
  return "";
}

/**
 * Build a relationship-aware greeting prompt.
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
  const tier = relationship?.relationshipTier || "acquaintance";
  const warmth = relationship?.warmthScore ?? 0;

  const { sharedContext, jsonGuardrail } = getBaseGreetingContext(
    pendingMessage,
    userName,
    kayleyActivity
  );

  const returnContext = getReturnContext(expectedReturnTime);
  const fullSharedContext = returnContext ? `${sharedContext}\n${returnContext}` : sharedContext;

  // Routing
  if (tier === "adversarial" || tier === "rival" || warmth < -10) {
    return getAdversarialGreetingPrompt(relationship, userName, fullSharedContext, jsonGuardrail);
  }

  if (
    tier === "friend" ||
    tier === "close_friend"
  ) {
    return getFriendGreetingPrompt(
      relationship,
      userName,
      openLoop,
      proactiveThread,
      fullSharedContext,
      jsonGuardrail
    );
  }

  if (tier === "deeply_loving") {
    return getDeeplyLovingGreetingPrompt(
      relationship,
      userName,
      openLoop,
      proactiveThread,
      fullSharedContext,
      jsonGuardrail
    );
  }

  // Default to acquaintance/neutral
  return getAcquaintanceGreetingPrompt(
    relationship,
    hasUserFacts,
    userName,
    openLoop,
    proactiveThread,
    fullSharedContext,
    jsonGuardrail
  );
}

/**
 * Build a natural "welcome back" prompt for users who have already chatted today.
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

  prompt += jsonGuardrail;
  return prompt;
}
