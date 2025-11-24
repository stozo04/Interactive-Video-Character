Junior Developer Implementation Guide: "Idle Breakers"
Here is exactly how to implement Idea #1 (Idle Breakers) because it reuses your existing triggerSystemMessage logic.

Step 1: Define the Idle Logic
In src/App.tsx, add a new useEffect to watch for silence.

TypeScript

// src/App.tsx

useEffect(() => {
  // 1. Configuration
  const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  const IDLE_CHECK_INTERVAL = 10000;  // Check every 10 seconds

  const checkIdle = () => {
    const now = Date.now();
    const timeSinceInteraction = now - lastInteractionAt;

    // Conditions to trigger a breaker:
    // 1. User has been silent for > 5 mins
    // 2. We are NOT currently speaking or processing
    // 3. We haven't already triggered one recently (you might need a new ref for this)
    
    if (timeSinceInteraction > IDLE_TIMEOUT && !isProcessingAction && !isSpeaking) {
       // Trigger the breaker!
       triggerIdleBreaker();
    }
  };

  const interval = setInterval(checkIdle, IDLE_CHECK_INTERVAL);
  return () => clearInterval(interval);
}, [lastInteractionAt, isProcessingAction, isSpeaking]);
Step 2: The Trigger Function
Add this function inside App.tsx. It reuses your existing triggerSystemMessage (which you used for the Morning Briefing).

TypeScript

const triggerIdleBreaker = async () => {
  // Prevent double-firing
  setLastInteractionAt(Date.now()); // Reset the timer so it doesn't fire again instantly

  console.log("💤 User is idle. Triggering breaker...");

  // Context-aware prompt
  // If you have 'relationship', use it to customize the tone!
  const prompt = `
    [SYSTEM EVENT: USER_IDLE]
    The user has been silent for over 5 minutes. 
    Your goal: Gently check in. 
    - If relationship is 'close_friend', maybe send a random thought or joke.
    - If 'acquaintance', politely ask if they are still there.
    - Keep it very short (1 sentence).
    - Do NOT repeat yourself if you did this recently.
  `;

  // Reuse your existing hidden system message trigger
  await triggerSystemMessage(prompt);
};
Step 3: Enhance the "Life"
To make this feature truly killer, update your buildSystemPrompt in promptUtils.ts to handle the [SYSTEM EVENT: USER_IDLE] tag specifically.

TypeScript

// src/services/promptUtils.ts

// Add to the Style & Output section:
`
If you receive [SYSTEM EVENT: USER_IDLE]:
- You are initiating the conversation.
- Act like a friend sitting in the same room who just noticed the silence.
- Don't be robotic ("Are you there?"). Be human ("So... catch any good movies lately?" or "You focused? You've been quiet.")
`
Summary
By implementing Idle Breakers, you change the dynamic from Tool (waiting for input) to Companion (sharing space). It creates the illusion that she is aware of the passage of time.