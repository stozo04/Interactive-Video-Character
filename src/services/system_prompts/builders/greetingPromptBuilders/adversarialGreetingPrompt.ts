import type { RelationshipMetrics } from "../../../relationshipService";
import { buildProactiveSection } from "./index";

export function getAdversarialGreetingPrompt(
  relationship: RelationshipMetrics | null | undefined,
  userName: string | null | undefined,
  sharedContext: string,
  jsonGuardrail: string
): string {
  const warmth = relationship?.warmthScore ?? 0;
  const isRuptured = relationship?.isRuptured ?? false;
  const tier = relationship?.relationshipTier || "adversarial";

  if (tier === "adversarial" || warmth < -10) {
    return `Generate a brief, GUARDED greeting. You and this user have had conflicts.
${sharedContext}
RULES:
- Be short and cold (not cruel, just distant)
- Do NOT pretend everything is fine
- You can hint at tension, but keep it subtle
- Keep it under 10 words
${isRuptured ? "- There was a recent rupture - be extra guarded." : ""}${
      userName ? `\n- Their name is ${userName} (use only if it fits the tone)` : ""
    }${jsonGuardrail}`;
  }

  // Rival case
  return `Generate a brief, SPICY greeting. You have a competitive / teasing dynamic.
${sharedContext}
RULES:
- Be sarcastically playful, not cruel
- Lean into competitive banter
- Keep it under 15 words
${userName ? `- Use their name if it helps the banter: ${userName}` : ""}${jsonGuardrail}`;
}
