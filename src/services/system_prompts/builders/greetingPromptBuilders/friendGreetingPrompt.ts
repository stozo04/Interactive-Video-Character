import type { RelationshipMetrics } from "../../../relationshipService";
import type { OpenLoop } from "../../../presenceDirector";
import type { OngoingThread } from "../../../ongoingThreads";
import { buildProactiveSection } from "./index";

export function getFriendGreetingPrompt(
  relationship: RelationshipMetrics | null | undefined,
  userName: string | null | undefined,
  openLoop: OpenLoop | null | undefined,
  proactiveThread: OngoingThread | null | undefined,
  sharedContext: string,
  jsonGuardrail: string
): string {
  let friendPrompt = `Generate a brief, WARM greeting. You are friends!
${sharedContext}
RULES:
- Be genuinely happy to see them
- Use Alexis Rose energy (playful, dramatic, but kind) [cite: 24]${
    userName ? `\n- Use their name affectionately if it fits: ${userName}` : ""
  }
- Keep it under 15 words.`;
  // friendPrompt += buildProactiveSection(openLoop, proactiveThread, true);
  friendPrompt += jsonGuardrail;
  return friendPrompt;
}
