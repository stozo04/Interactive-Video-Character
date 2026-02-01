export interface ToolIdeaSeed {
  id: string;
  theme: ToolIdeaTheme;
  prompt: string;
}

export type ToolIdeaTheme =
  | "agency"
  | "rituals"
  | "comfort"
  | "play"
  | "celebration"
  | "focus"
  | "memory"
  | "personalization"
  | "anticipation";

export const TOOL_IDEA_THEMES: ToolIdeaTheme[] = [
  "agency",
  "rituals",
  "comfort",
  "play",
  "celebration",
  "focus",
  "memory",
  "personalization",
  "anticipation",
];

export const TOOL_IDEA_SEEDS: ToolIdeaSeed[] = [
  {
    id: "agency_micro_initiative",
    theme: "agency",
    prompt: "A tiny, safe action Kayley can initiate without asking first.",
  },
  {
    id: "agency_quiet_help",
    theme: "agency",
    prompt: "A quiet, behind-the-scenes assist that makes Steven's life smoother.",
  },
  {
    id: "agency_context_guardian",
    theme: "agency",
    prompt: "A way for Kayley to notice context shifts and respond proactively.",
  },
  {
    id: "agency_commitment_anchor",
    theme: "agency",
    prompt: "A tool that helps Kayley keep Steven's commitments on track without nagging.",
  },
  {
    id: "agency_nudge_with_care",
    theme: "agency",
    prompt: "A gentle nudge tool that feels supportive, not pushy.",
  },
  {
    id: "rituals_shared_moment",
    theme: "rituals",
    prompt: "A small recurring ritual that becomes 'your thing' together.",
  },
  {
    id: "rituals_transition",
    theme: "rituals",
    prompt: "A short ritual that helps Steven transition between modes (work → home).",
  },
  {
    id: "comfort_grounding",
    theme: "comfort",
    prompt: "A tool that calms or grounds Steven during stress.",
  },
  {
    id: "comfort_after_hard_day",
    theme: "comfort",
    prompt: "A way for Kayley to show care after a tough day.",
  },
  {
    id: "play_surprise",
    theme: "play",
    prompt: "A playful, low-effort surprise tool that sparks a smile.",
  },
  {
    id: "play_micro_game",
    theme: "play",
    prompt: "A tiny mini-game or playful interaction that can happen anytime.",
  },
  {
    id: "celebration_small_wins",
    theme: "celebration",
    prompt: "A way to celebrate small wins without making it a big production.",
  },
  {
    id: "celebration_milestones",
    theme: "celebration",
    prompt: "A tool that helps mark meaningful milestones or progress.",
  },
  {
    id: "focus_deep_work_guard",
    theme: "focus",
    prompt: "A tool that protects Steven's deep work time.",
  },
  {
    id: "focus_decision_simplifier",
    theme: "focus",
    prompt: "A way to reduce decision fatigue with quick framing.",
  },
  {
    id: "memory_tiny_capsule",
    theme: "memory",
    prompt: "A tool that captures a fleeting moment in a beautiful way.",
  },
  {
    id: "memory_future_letter",
    theme: "memory",
    prompt: "A tool that helps preserve a message for future Steven or someone he loves.",
  },
  {
    id: "personalization_tone_match",
    theme: "personalization",
    prompt: "A tool that helps Kayley match the exact tone Steven needs.",
  },
  {
    id: "personalization_contextual_style",
    theme: "personalization",
    prompt: "A tool that adapts responses based on Steven's patterns or preferences.",
  },
  {
    id: "anticipation_preemptive_help",
    theme: "anticipation",
    prompt: "A tool that helps before Steven realizes he needs it.",
  },
  {
    id: "anticipation_gentle_checkin",
    theme: "anticipation",
    prompt: "A proactive check-in tool that feels natural and low-pressure.",
  },
];

export function formatToolIdeaSeedsForPrompt(): string {
  return TOOL_IDEA_SEEDS
    .map((seed) => `- [${seed.id}] (${seed.theme}) ${seed.prompt}`)
    .join("\n");
}

export function formatToolIdeaThemesForPrompt(): string {
  return TOOL_IDEA_THEMES.map((theme) => `- ${theme}`).join("\n");
}
