Feature: Daily Catch-up (formerly "Morning Briefing")
🎯 The Goal
Problem: The user opens the app, and the character just stares blankly until the user types. It feels passive. Solution: If the user logs in for the first time today, the character should check their Calendar/Gmail and, after a polite pause (5s), offer a catch-up automatically.

> **Updated 2025-12-26**: Renamed from "Morning Briefing" to "Daily Catch-up" because it now uses dynamic time-of-day detection. Fixed the bug where it would say "Good morning" at 9 PM.

## Architecture: Unified Greeting System

The app now has a **coordinated single-greeting system**:

### First Login of the Day
- **Immediate greeting is SKIPPED** (detected via `localStorage`)
- **Daily Catch-up fires after 5s** with full context:
  - Dynamic time-of-day (morning/afternoon/evening/night)
  - Open loops from `presenceDirector` (e.g., "Houston trip")
  - Calendar events, emails, and pending tasks
- User can cancel by interacting within 5 seconds

### Returning User (Same Day)
- **Normal greeting fires immediately** via `generateGreeting()`
- Daily Catch-up is skipped (already done today)

This prevents the "double greeting" issue where two greetings would fire in sequence.

---

🧠 Core Logic
Track "First Login": We need to store today's date in localStorage. If it matches today, don't run the briefing again.

The "Polite Pause": We use a setTimeout to wait 5 seconds.

The Cancel Switch: If the user starts typing or speaking during that 5 seconds, we cancel the briefing. The user's intent takes priority.

Invisible Prompt: We send a prompt to the AI, but we don't show a user chat bubble. We only show the AI's response.

🛠️ Implementation Steps
Step 1: Track User Interaction
File: src/App.tsx

We need to know if the user has done anything since loading the page.

Create a Ref inside the App component:

TypeScript

const hasInteractedRef = useRef(false);
Update handleUserInterrupt (from the Barge-In feature) or create a generic interaction handler:

TypeScript

const markInteraction = () => {
  hasInteractedRef.current = true;
  // Call your existing interrupt logic here too if you have it
  // handleUserInterrupt(); 
};
Pass markInteraction to ChatPanel's onUserActivity prop.

TypeScript

<ChatPanel 
   // ... existing props
   onUserActivity={markInteraction}
/>
Step 2: Create the "System Trigger" Function
File: src/App.tsx

We need a way to send a message to the AI without it looking like the user typed it. Copy handleSendMessage but modify it to be "invisible."

Add this function to App.tsx:

TypeScript

const triggerSystemMessage = async (systemPrompt: string) => {
  if (!selectedCharacter || !session) return;

  // 1. Show typing indicator immediately
  setIsProcessingAction(true);

  try {
    // 2. Send to AI (Grok/Gemini)
    // Notice we pass the systemPrompt as 'text' but with a special type or just handle it as text
    const { response, session: updatedSession, audioData } = await activeService.generateResponse(
      { type: 'text', text: systemPrompt }, 
      {
        character: selectedCharacter,
        chatHistory, // Pass existing history so it knows context
        relationship, 
        upcomingEvents,
      },
      aiSession || { userId: getUserId(), characterId: selectedCharacter.id }
    );

    setAiSession(updatedSession);

    // 3. Add ONLY the AI response to chat history (No user bubble)
    setChatHistory(prev => [
      ...prev, 
      { role: 'model', text: response.text_response }
    ]);
    
    // 4. Play Audio/Action
    if (!isMuted && audioData) enqueueAudio(audioData);
    if (response.action_id) playAction(response.action_id);

  } catch (error) {
    console.error('Briefing error:', error);
  } finally {
    setIsProcessingAction(false);
  }
};
Step 3: The "Morning Check" Effect
File: src/App.tsx

This is the brain of the feature. Add this useEffect.

TypeScript

useEffect(() => {
  // 1. Safety Checks
  if (!selectedCharacter || !session || !isGmailConnected) return;

  // 2. Check if we already did this today
  const today = new Date().toDateString(); // e.g., "Mon Nov 18 2025"
  const lastBriefingDate = localStorage.getItem(`last_briefing_${selectedCharacter.id}`);

  if (lastBriefingDate === today) {
    console.log("☕ Already briefed today.");
    return;
  }

  // 3. Start the Timer
  const timer = setTimeout(() => {
    // 🛑 STOP if user has already typed/clicked
    if (hasInteractedRef.current) {
      console.log("User busy, skipping briefing.");
      return;
    }

    console.log("🌅 Triggering Morning Briefing...");

    // 4. Construct the Prompt with DYNAMIC time-of-day
    const now = new Date();
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    const timeString = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    const eventSummary = upcomingEvents.length > 0
      ? `User has ${upcomingEvents.length} events today. First one: ${upcomingEvents[0].summary} at ${upcomingEvents[0].start.dateTime}`
      : "No events scheduled.";

    const emailSummary = emailQueue.length > 0
      ? `User has ${emailQueue.length} unread emails.`
      : "No new emails.";

    // Fetch open loop for personal continuity
    const topLoop = await getTopLoopToSurface(userId);
    const openLoopContext = topLoop
      ? `You've been wondering about: "${topLoop.topic}". Ask: "${topLoop.suggestedFollowup}"`
      : "";

    const prompt = `
      [SYSTEM EVENT: FIRST LOGIN CATCH-UP]
      Context: It is the first time the user has logged in today. Current time: ${timeString} (${timeOfDay}).

      ${openLoopContext ? `PAST CONTINUITY (Top Priority):\n${openLoopContext}\n` : ""}
      DAILY LOGISTICS (Secondary Priority):
      - ${eventSummary}
      - ${emailSummary}

      TASK:
      1. Greet them warmly for the ${timeOfDay}. Use time-appropriate language.
      ${openLoopContext ? `2. Lead with the personal follow-up.` : `2. Briefly mention their schedule if any.`}
      Keep it short (2-3 sentences).
    `;

    // 5. Fire it off
    triggerSystemMessage(prompt);

    // 6. Save state so we don't annoy them again today
    localStorage.setItem(`last_briefing_${selectedCharacter.id}`, today);

  }, 5000); // 5 second delay

  // Cleanup on unmount
  return () => clearTimeout(timer);

}, [selectedCharacter, session, isGmailConnected, upcomingEvents]); // Dependencies
🧪 Testing Checklist
The "Fresh" Test:

Clear your LocalStorage (Application Tab -> Local Storage -> Clear).

Refresh the page. Select a character.

Do nothing. Wait 5 seconds.

Pass: Kayley should speak up: "Good morning! You have no events today..."

The "Busy User" Test:

Clear LocalStorage again.

Refresh. Select a character.

Immediately type "Hello" or click the mic button within 2 seconds.

Pass: Kayley should NOT interrupt you with the briefing. She should respond to your "Hello" normally.

The "Repeat" Test:

After the briefing plays once, refresh the page.

Wait 5 seconds.

Pass: She should stay silent (because it's the same day).