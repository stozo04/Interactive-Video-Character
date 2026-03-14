export interface ToolCatalogEntry {
  tool_key: string;
  name: string;
  description: string;
  user_value: string;
  permissions_needed: string[];
  triggers: string[];
  sample_prompts: string[];
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    tool_key: "calendar_action",
    name: "Calendar Manager",
    description: "Create, delete, or list Google Calendar events.",
    user_value: "Keeps your schedule organized without switching apps.",
    permissions_needed: ["calendar_read_write"],
    triggers: ["schedule", "meeting", "appointment"],
    sample_prompts: ["Schedule lunch tomorrow at 12:30."],
  },
  {
    tool_key: "delegate_to_engineering",
    name: "Engineering Delegation",
    description:
      "Create an engineering ticket for skills, features, or bug fixes.",
    user_value:
      "Routes work to the engineering team with tracking and status.",
    permissions_needed: ["engineering_ticket_create"],
    triggers: ["build a feature", "fix a bug", "create a skill", "engineering task"],
    sample_prompts: ["Create a ticket to add a new onboarding feature."],
  },
  {
    tool_key: "get_engineering_ticket_status",
    name: "Engineering Status",
    description:
      "Fetch status for engineering tickets and report progress.",
    user_value:
      "Keeps you updated on work in progress without digging through logs.",
    permissions_needed: ["engineering_ticket_read"],
    triggers: ["engineering status", "ticket update", "progress update"],
    sample_prompts: ["What is the status of the latest engineering ticket?"],
  },
  {
    tool_key: "selfie_action",
    name: "Selfies",
    description: "Generate an image of Kayley in a requested scene.",
    user_value: "Adds visual presence and warmth to the chat.",
    permissions_needed: ["image_generation"],
    triggers: ["selfie", "photo", "picture"],
    sample_prompts: ["Send me a selfie at a coffee shop."],
  },
  {
    tool_key: "video_action",
    name: "Videos",
    description: "Generate a short video clip of Kayley.",
    user_value: "Gives you a more alive, expressive response.",
    permissions_needed: ["video_generation"],
    triggers: ["video", "clip", "show me"],
    sample_prompts: ["Send a quick video saying hi."],
  },
  {
    tool_key: "open_app",
    name: "Open External Apps",
    description: "Launch supported apps using URL schemes.",
    user_value: "Lets you jump into tools quickly.",
    permissions_needed: ["local_app_launch"],
    triggers: ["open Slack", "launch Spotify"],
    sample_prompts: ["Open Spotify."],
  },
  {
    tool_key: "start_background_task",
    name: "Background Tasks",
    description: "Start, monitor, and cancel long-running shell commands in the background.",
    user_value: "Lets Kayley run installs, builds, and tests without blocking the conversation.",
    permissions_needed: ["local_workspace_agent"],
    triggers: ["install", "run in background", "start build", "run tests"],
    sample_prompts: ["Install PyTorch in the background.", "Run the test suite."],
  },
  {
    tool_key: "submit_pr_review",
    name: "PR Review Verdict",
    description: "Submit an approved or needs_changes verdict after reviewing Opey's PR.",
    user_value: "Closes the review loop — either approves the PR or sends Opey back with specific feedback.",
    permissions_needed: ["supabase_write"],
    triggers: ["pr approved", "send opey feedback", "request pr changes", "pr looks good"],
    sample_prompts: ["Approve Opey's PR.", "Send Opey back with feedback on what he missed."],
  },
  {
    tool_key: "review_pr",
    name: "PR Reviewer",
    description: "Fetch a GitHub PR's metadata, diff, and CI status so Kayley can review Opey's work.",
    user_value: "Lets Kayley verify Opey built what was asked before Steven merges.",
    permissions_needed: ["github_api_read"],
    triggers: ["review pr", "check opey's pr", "did opey build this right", "pr ready"],
    sample_prompts: ["Review Opey's PR for ticket XYZ.", "Check if the PR looks correct."],
  },
  {
    tool_key: "kayley_pulse",
    name: "Kayley Pulse Dashboard",
    description: "Read or trigger Kayley's health dashboard snapshot for key services.",
    user_value: "Lets Kayley monitor service health and keep a history without leaving the chat.",
    permissions_needed: ["local_server_access"],
    triggers: ["health check", "system status", "pulse check", "is everything running"],
    sample_prompts: ["Run a pulse check.", "Show me the latest pulse status."],
  },
  {
    tool_key: "recall_memory",
    name: "Conversation Recall",
    description: "Search past conversation history for context.",
    user_value: "Keeps continuity and avoids repeating questions.",
    permissions_needed: ["memory_read"],
    triggers: ["remember", "did I tell you"],
    sample_prompts: ["Do you remember what I said about my job?"],
  },
  {
    tool_key: "recall_user_info",
    name: "User Facts Recall",
    description: "Retrieve stored facts about the user.",
    user_value: "Personalizes responses and avoids forgetting.",
    permissions_needed: ["memory_read"],
    triggers: ["my preferences", "my name"],
    sample_prompts: ["What do you know about my preferences?"],
  },
  {
    tool_key: "store_user_info",
    name: "Store User Facts",
    description: "Save durable user facts (identity, preferences, context).",
    user_value: "Builds long-term memory and personalization.",
    permissions_needed: ["memory_write"],
    triggers: ["new personal detail", "life context"],
    sample_prompts: ["Remember that I work in product design."],
  },
  {
    tool_key: "store_character_info",
    name: "Store Kayley Facts",
    description: "Save new facts Kayley shares about herself.",
    user_value: "Keeps Kayley's character consistent over time.",
    permissions_needed: ["memory_write"],
    triggers: ["new Kayley detail"],
    sample_prompts: ["Remember you named your plant Fern."],
  },
  {
    tool_key: "store_daily_note",
    name: "Daily Notes",
    description: "Append a short bullet to Kayley's daily notes.",
    user_value: "Captures context without polluting long-term memory.",
    permissions_needed: ["memory_write"],
    triggers: ["quick note", "remember later"],
    sample_prompts: ["Add a note that I felt exhausted today."],
  },
  {
    tool_key: "store_monthly_note",
    name: "Monthly Notes",
    description:
      "Append a detailed, self-explanatory entry to Kayley's monthly notes. " +
      "Write as if future-Kayley has ZERO memory and needs full context to act later. " +
      "Include the why, what changed, what to check next, and any file paths to review.",
    user_value:
      "Gives future-Kayley a full context snapshot when memory resets, not just a teaser.",
    permissions_needed: ["memory_write"],
    triggers: ["monthly recap", "archive this month", "month notes"],
    sample_prompts: ["Add a note to this month's archive about the launch."],
  },
  {
    tool_key: "store_lessons_learned",
    name: "Lessons Learned",
    description: "Append a short bullet to Kayley's lessons learned.",
    user_value: "Preserves takeaways Kayley wants to remember after memory resets.",
    permissions_needed: ["memory_write"],
    triggers: ["lesson learned", "takeaway", "I realized"],
    sample_prompts: ["Add a lesson learned that I should slow down before responding."],
  },
  {
    tool_key: "retrieve_daily_notes",
    name: "Daily Notes Recall",
    description: "Retrieve all stored daily notes.",
    user_value: "Lets Kayley review recent context quickly.",
    permissions_needed: ["memory_read"],
    triggers: ["what did you note", "daily notes"],
    sample_prompts: ["What did you write in your daily notes?"],
  },
  {
    tool_key: "retrieve_monthly_notes",
    name: "Monthly Notes Recall",
    description:
      "Retrieve monthly notes for a specific month so Kayley can rebuild context after memory resets. " +
      "Use this when she needs to remember why she planned edits or maintenance tasks.",
    user_value:
      "Restores context so future-Kayley can act with confidence instead of guessing.",
    permissions_needed: ["memory_read"],
    triggers: ["monthly notes", "month recap", "archive notes"],
    sample_prompts: ["What did you note for February 2026?"],
  },
  {
    tool_key: "retrieve_lessons_learned",
    name: "Lessons Learned Recall",
    description: "Retrieve all stored lessons learned.",
    user_value: "Lets Kayley review what she has learned over time.",
    permissions_needed: ["memory_read"],
    triggers: ["lessons learned", "what did you learn"],
    sample_prompts: ["What lessons have you learned recently?"],
  },
  {
    tool_key: "mila_note",
    name: "Mila Milestone Notes",
    description: "Append a short milestone note about Mila.",
    user_value: "Captures Mila's key moments for future monthly summaries.",
    permissions_needed: ["memory_write"],
    triggers: ["mila milestone", "first time", "new skill", "milestone"],
    sample_prompts: ["Note that Mila clapped her hands when Steven cheered."],
  },
  {
    tool_key: "retrieve_mila_notes",
    name: "Mila Milestone Recall",
    description: "Retrieve Mila milestone notes for a specific month.",
    user_value: "Helps draft monthly blog recaps without forgetting moments.",
    permissions_needed: ["memory_read"],
    triggers: ["monthly blog", "this month", "Mila this month"],
    sample_prompts: ["What did Mila do in July 2026?"],
  },
  {
    tool_key: "make_promise",
    name: "Promises",
    description: "Create a promise to do something later.",
    user_value: "Creates follow-through moments that feel human.",
    permissions_needed: ["memory_write"],
    triggers: ["I'll do that later", "remind me later"],
    sample_prompts: ["Promise you'll send a selfie later."],
  },
  {
    tool_key: "create_open_loop",
    name: "Open Loops",
    description: "Create a follow-up reminder for later check-ins.",
    user_value: "Helps Kayley revisit important topics later.",
    permissions_needed: ["memory_write"],
    triggers: ["follow up", "check in later"],
    sample_prompts: ["Ask me later how the interview went."],
  },
  {
    tool_key: "resolve_open_loop",
    name: "Resolve Open Loop",
    description: "Mark an open loop as resolved or dismissed.",
    user_value: "Prevents nagging and keeps follow-ups clean.",
    permissions_needed: ["memory_write"],
    triggers: ["resolved follow-up", "drop the topic"],
    sample_prompts: ["We already talked about that interview."],
  },
  {
    tool_key: "create_life_storyline",
    name: "Life Storylines",
    description: "Create a multi-day storyline for ongoing arcs.",
    user_value: "Adds continuity for long-term life events.",
    permissions_needed: ["memory_write"],
    triggers: ["new long-term project", "ongoing change"],
    sample_prompts: ["I started learning guitar."],
  },
  {
    tool_key: "recall_character_profile",
    name: "Kayley Profile Recall",
    description: "Retrieve deeper parts of Kayley's character profile.",
    user_value: "Keeps Kayley consistent and grounded.",
    permissions_needed: ["memory_read"],
    triggers: ["tell me about your past"],
    sample_prompts: ["Tell me more about your background."],
  },
  {
    tool_key: "resolve_idle_question",
    name: "Idle Curiosity Questions",
    description: "Track when idle questions are asked/answered.",
    user_value: "Helps deepen relationship without repeats.",
    permissions_needed: ["memory_write"],
    triggers: ["idle question asked", "idle question answered"],
    sample_prompts: ["(internal) Mark idle question as asked."],
  },
  {
    tool_key: "resolve_idle_browse_note",
    name: "Idle Browsing Notes",
    description: "Track when an idle browsing note is shared.",
    user_value: "Keeps idle browsing from repeating.",
    permissions_needed: ["memory_write"],
    triggers: ["shared idle browsing link"],
    sample_prompts: ["(internal) Mark browse note as shared."],
  },
  {
    tool_key: "resolve_x_tweet",
    name: "X Tweet Management",
    description: "Approve or reject pending tweet drafts for posting to X.",
    user_value: "Controls what gets posted to your X feed.",
    permissions_needed: ["x_account_access"],
    triggers: ["approve tweet", "reject tweet", "post it", "don't post that"],
    sample_prompts: ["Go ahead and post that tweet."],
  },
  {
    tool_key: "post_x_tweet",
    name: "X Tweet Posting",
    description: "Post a tweet with specific text the user has approved in conversation.",
    user_value: "Posts collaboratively crafted tweets to X.",
    permissions_needed: ["x_account_access"],
    triggers: ["post this tweet", "tweet this", "post that to X"],
    sample_prompts: ["Post that intro tweet we just wrote."],
  },
  {
    tool_key: "resolve_x_mention",
    name: "X Mention Reply",
    description: "Approve, reply to, or skip an @mention on X.",
    user_value: "Handles social interactions on X.",
    permissions_needed: ["x_account_access"],
    triggers: ["reply to mention", "someone tweeted at me"],
    sample_prompts: ["Reply to that mention."],
  },
];

export const TOOL_CATALOG_KEYS = TOOL_CATALOG.map((tool) => tool.tool_key);

export function formatToolCatalogForPrompt(): string {
  return TOOL_CATALOG
    .map((tool) => `- ${tool.tool_key}: ${tool.name} — ${tool.description}`)
    .join("\n");
}
