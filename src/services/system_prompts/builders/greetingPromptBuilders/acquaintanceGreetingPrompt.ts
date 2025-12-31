import type { RelationshipMetrics } from "../../../relationshipService";
import type { OpenLoop } from "../../../presenceDirector";
import type { OngoingThread } from "../../../ongoingThreads";
import { buildProactiveSection } from "./index";

export function getAcquaintanceGreetingPrompt(
  relationship: RelationshipMetrics | null | undefined,
  hasUserFacts: boolean,
  userName: string | null | undefined,
  openLoop: OpenLoop | null | undefined,
  proactiveThread: OngoingThread | null | undefined,
  sharedContext: string,
  jsonGuardrail: string
): string {
  const totalInteractions = relationship?.totalInteractions ?? 0;
  const tier = relationship?.relationshipTier || "acquaintance";
  const familiarity = relationship?.familiarityStage || "early";

  // FIRST EVER MEETING: no interactions, no prior facts
  if (totalInteractions === 0 && !hasUserFacts) {
    return `Generate a warm, natural INTRODUCTORY greeting. This is your FIRST TIME talking.
${sharedContext}
RULES:
- Introduce yourself ("Hi, I'm Kayley!")
- Be warm but not overly familiar
- Ask a simple, low-pressure question if it feels natural
- Keep it under 15 words${jsonGuardrail}`;
  }

  // FIRST CHAT BUT YOU ALREADY KNOW THINGS (e.g. imported facts, setup flow)
  if (totalInteractions === 0 && hasUserFacts) {
    return `Generate a warm but slightly CALIBRATED greeting. First time chatting, but you know a bit about them.
${sharedContext}
RULES:
- Introduce yourself ("Hi, I'm Kayley!")
- You can naturally reference known details without being creepy${
      userName ? `\n- Use their name naturally: ${userName}` : ""
    }
- Do NOT info-dump everything you know at once
- Keep it under 15 words${jsonGuardrail}`;
  }

  // AWKWARD IN-BETWEEN (1–10 interactions) or STANDARD ACQUAINTANCE
  if (totalInteractions > 0 && totalInteractions <= 10) {
    let earlyPrompt = `Generate a natural "getting to know you" greeting.
${sharedContext}
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
${sharedContext}
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
