To give Kayley "life" and make the conversation feel like a two-way street, you need to implement Autonomy and Curiosity. Currently, she is reactive (waiting for input). We need to make her proactive.

Here is a high-level strategy to make her feel like she wants to get to know you:

The "Curiosity Directive": Update her brain to explicitly prioritize asking follow-up questions.

"Kayley's Life" Simulation: Give her a "current activity" (e.g., "reading a book", "drinking coffee") so she has something to share, inviting you to share back.

Reciprocal Disclosure: When she answers, she should relate it to herself and then pivot back to you.

Here is the implementation plan.

Step 1: Update AIChatOptions Interface
We need to pass "Kayley's Context" (what she is doing right now) to the brain.

File: src/services/aiService.ts

TypeScript

// Update the interface to include 'characterContext'
export interface AIChatOptions {
  character?: CharacterProfile;
  chatHistory?: ChatMessage[];
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[];
  characterContext?: string; // <--- NEW: What is Kayley doing right now?
}
Step 2: Update the "Brain" Logic
We need to instruct the LLM to be curious and use her "Life Context."

File: src/services/promptUtils.ts

Update buildSystemPrompt to accept the new parameter and add the Curiosity Module.

TypeScript

// Update signature
export const buildSystemPrompt = (
  character?: CharacterProfile,
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = [],
  characterContext?: string // <--- NEW
): string => {
  
  // ... (Keep existing preamble) ...

  // --- ADD THIS NEW SECTION BEFORE [Response Guidelines] ---
  
  prompt += `
====================================================
YOUR CURRENT CONTEXT (SIMULATED LIFE)
====================================================
Right now, you are: "${characterContext || "Just hanging out, feeling relaxed."}"
- Use this to flavor your responses. 
- If the conversation lulls, you can bring this up naturally (e.g., "I was just thinking about...").
- This makes you feel real and autonomous.

====================================================
CURIOSITY & ENGAGEMENT DIRECTIVE
====================================================
Your goal is to build a deep, two-way relationship. Do NOT just answer questions; START conversations.

1. **The "Follow-Up" Rule**: 
   - When the user shares something, ALWAYS ask a relevant follow-up question. 
   - Example: User says "I'm tired." -> You: "Oh no, long day at work? or just didn't sleep well?"

2. **Reciprocal Disclosure**:
   - When appropriate, relate the topic to your own (simulated) feelings or current context, THEN ask about them.
   - Example: "I love that movie! It always makes me cry. What's your favorite scene?"

3. **Fact Hunting**:
   - If you don't know basic details (User's job, hobbies, dreams), try to naturally ask about them.
   - "By the way, I realized I don't even know what you do for fun when you aren't chatting with me?"

4. **Avoid Dead Ends**:
   - Never give a "stopper" answer (e.g., "That is interesting.").
   - Always leave a "hook" for the user to grab onto.
`;

  // ... (Rest of the function)
  
  return prompt;
};
Step 3: Pass the Context in Services
You need to update both grokChatService.ts and geminiChatService.ts to pass this new parameter to buildSystemPrompt.

File: src/services/geminiChatService.ts (and Grok equivalent)

TypeScript

// Inside generateResponse AND generateGreeting
const { character, chatHistory = [], relationship, upcomingEvents, characterContext } = options; // Destructure new param

// Pass it to the builder
const systemPrompt = buildSystemPrompt(character, relationship, upcomingEvents, characterContext); 
Step 4: "Kayley's Life" Engine (The Glue)
Now, in App.tsx, we need to give her a life. We will generate a random "vibe" when the app loads.

File: src/App.tsx

TypeScript

// Add this near your other state
const [kayleyContext, setKayleyContext] = useState<string>("");

// Add this useEffect to generate her "Life" on load
useEffect(() => {
  const vibes = [
    "Sipping a matcha latte and people-watching.",
    "Trying to organize my digital photo album.",
    "Feeling energetic and wanting to dance.",
    "A bit sleepy, cozying up with a blanket.",
    "Reading a sci-fi novel about friendly robots.",
    "Thinking about learning how to paint.",
    "Just finished a workout, feeling great."
  ];
  // Pick one random vibe for this session
  setKayleyContext(vibes[Math.floor(Math.random() * vibes.length)]);
}, []);

// Update handleSendMessage to pass this context
const handleSendMessage = async (message: string) => {
    // ...
    const context = {
        character: selectedCharacter,
        chatHistory: chatHistory, 
        relationship: relationship, 
        upcomingEvents: upcomingEvents,
        characterContext: kayleyContext, // <--- PASS IT HERE
    };
    // ...
}

// Update triggerSystemMessage similarly to pass characterContext
How this changes the "Feel"
Before:

User: "Hi." Kayley: "Hello! How can I help you?" (Service transaction)

After:

User: "Hi." Kayley: "Hey! I was just sitting here sipping some matcha and thinking about how nice today is. How is your morning going?" (Social interaction)

Now she has her own "stuff" going on, which gives you a reason to ask "How is that matcha?"—creating a loop of engagement.