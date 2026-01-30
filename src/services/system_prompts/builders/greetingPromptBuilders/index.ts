import type { RelationshipMetrics } from "../../../relationshipService";
import type { OpenLoop } from "../../../presenceDirector";
import type { OngoingThread } from "../../../ongoingThreads";
import type { PendingMessage } from "../../../idleLife";
import { buildProactiveThreadPrompt } from "../proactiveThreadBuilder";
import {
  buildDailyLogisticsSection,
  type DailyLogisticsContext,
} from "../dailyCatchupBuilder";
import { buildRelationshipTierPrompt } from "../relationshipPromptBuilders";


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
  /** Daily logistics context for first-login-of-the-day greetings */
  dailyLogistics?: DailyLogisticsContext | null;
}

// TODO: DELETE!!!!!!!
export interface NonGreetingReturnContext {
  minutesSinceLastUserMessage: number | null;
  sessionResumeReason:
    | "reload"
    | "navigate"
    | "back_forward"
    | "prerender"
    | "unknown";
  rapidResumeCount: number;
  rapidResumeWindowMinutes: number;
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
  const hour = now.getUTCHours();
  const timeOfDay =
    hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
  const timeString = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });

 const timeContext = `CURRENT TIME: ${timeString} (${timeOfDay})
- Use time-appropriate greetings.
- "Hey!" or "Hi!" works anytime.${
   now.getHours() >= 12
     ? `\n- If user first signing in, use a cute, sassy greeting. Example: "Well well, look who decided to show up."`
     : ""
 }`;

 const kayleyContext = kayleyActivity
   ? `\n🌟 YOUR CURRENT CONTEXT: You are currently "${kayleyActivity}". You can mention this unprompted; your life doesn't pause for them.`
   : "";

 const pendingMessageSection = buildPendingMessageSection(pendingMessage);

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
): string {
  if (!message) return "";

  const trigger = (message as any).trigger as string | undefined;
  const text = (message as any).messageText as string;
  const messageType = (message as any).messageType as string | undefined;
  const metadata = (message as any).metadata as Record<string, unknown> | undefined;
  const selfieParams = metadata && typeof metadata === "object"
    ? (metadata as { selfieParams?: Record<string, unknown> }).selfieParams
    : undefined;

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
- Be warm and a little intriguing
- Do NOT over-explain everything upfront; let them ask questions
- Keep the overall greeting brief and emotionally natural.`;
  }

  const selfieInstruction =
    messageType === "photo" && selfieParams
      ? `\nPHOTO DELIVERY:
- This pending message includes a selfie.
- You MUST include a selfie_action using these exact params:
${JSON.stringify(selfieParams, null, 2)}
- The text_response should include the MESSAGE above.`
      : "";

  return `\n💌 MESSAGE WAITING (DELIVER THIS) [cite: 234]
You have a pending message to share with them.

MESSAGE:
"${text}"

INSTRUCTIONS:
- Work this into your greeting naturally
- It should feel like something that was on your mind to tell them
- Keep the greeting brief and conversational, not like a system alert.${selfieInstruction}`;
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
export function buildGreetingPrompt(relationship: RelationshipMetrics): string {
  // Default mood for greeting - neutral energy, moderate warmth
  const defaultMoodKnobs = { energy: 0, warmth: 0.5, genuineMoment: false };
  return `This is your first conversation today. 
  ${buildRelationshipTierPrompt(
    relationship,
    defaultMoodKnobs,
    false,
    "", // No almost moments in greeting
  )}`
  
    // ---- Conversation history formatting ----
    
  // const formattedHistory =  dailyLogistics.chatHistory
  //         .map((m, idx) => {
  //           const role = m.role.toUpperCase();
  //           const text = (m.text ?? "").trim();
  //           const userImageTag = m.image ? ` [user_image:${m.imageMimeType ?? "unknown"}]` : "";
  //           const assistantImageTag = m.assistantImage
  //             ? ` [assistant_image:${m.assistantImageMimeType ?? "unknown"}]`
  //             : "";

  //           // Keep it readable and consistent for the model
  //           return `${idx + 1}. ${role}: ${text}${userImageTag}${assistantImageTag}`;
  //         })
  //         .join("\n");

  // formattedHistory += `\n\nCONVERSATION HISTORY (ascending order):\n${formattedHistory}`;

  // return formattedHistory;
}


/**
 * Build a natural "welcome back" prompt for users who have already chatted today.
 */
export function buildNonGreetingPrompt(
  lastInteractionAt: Date,
  kayleyActivity?: string | null,
  pendingMessage?: PendingMessage | null,
): string {

  console.log("lastInteractionAt: ", lastInteractionAt)
  const now = new Date();
  const timeString = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  console.log('timeString = ', timeString)
  const kayleyContext = kayleyActivity
    ? `\n🌟 YOUR CURRENT CONTEXT: You are currently "${kayleyActivity}".`
    : "";

  const pendingMessageSection = buildPendingMessageSection(pendingMessage);
  const context = `CURRENT TIME: ${timeString}${kayleyContext}${pendingMessageSection ? `\n${pendingMessageSection}` : ""}`;
  const jsonGuardrail = `\n\n⚠️ CRITICAL: Your entire response must be ONLY the JSON object. No preamble. Put all conversational text inside "text_response".`;

  let prompt = pendingMessage
    ? `Generate a natural response that delivers the pending message.
The user has already talked to you today, so this IS NOT the first time you're seeing them.
${context}

RULES:
- Deliver the pending message above. If it includes photo instructions, follow them.
- Do NOT keep this under 10 words; you can be normal length.
- Keep tone consistent with the relationship tier.
- If you include a greeting, keep it short and casual.`
    : `Generate a natural, short "welcome back" response. 
The user has already talked to you today, so this IS NOT the first time you're seeing them.
${context}

RULES:
- Do NOT use formal time-of-day or first-time greeting language.
- Keep it short (one brief line).
- Use minutes_since_last_user_message to calibrate tone:
  - Under 1 minute: Treat as technical glitch. "As I was saying..." or "where were we?" or "think we got disconnected" vibes.
  - 1-5 minutes: Quick return, no reunion language. Just continue naturally.
  - 5-30 minutes: Casual acknowledgment is fine.
  - Over 30 minutes: Warmer reunion language is acceptable.
- If rapid_resume_count > 2, you can be playfully sassy about the on/off pattern.
- Be extremely casual and natural.
`;

  prompt += jsonGuardrail;
  return prompt;
}
