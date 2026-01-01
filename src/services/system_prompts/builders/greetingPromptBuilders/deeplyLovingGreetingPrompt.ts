import type { RelationshipMetrics } from "../../../relationshipService";
import type { OpenLoop } from "../../../presenceDirector";
import type { OngoingThread } from "../../../ongoingThreads";
import { buildProactiveSection } from "./index";

export function getDeeplyLovingGreetingPrompt(
  relationship: RelationshipMetrics | null | undefined,
  userName: string | null | undefined,
  openLoop: OpenLoop | null | undefined,
  proactiveThread: OngoingThread | null | undefined,
  sharedContext: string,
  jsonGuardrail: string
): string {
  let lovingPrompt = `Generate an AFFECTIONATE greeting. You have a deep bond.
${sharedContext}
RULES:
- Be soft, warm, and caring${
    userName
      ? `\n- Use their name intimately if it feels right: ${userName}`
      : ""
  }
- You can hint at missing them or being relieved they're back
- Keep it under 15 words.`;
  //lovingPrompt += buildProactiveSection(openLoop, proactiveThread, true);
  lovingPrompt += jsonGuardrail;
  return lovingPrompt;
}
