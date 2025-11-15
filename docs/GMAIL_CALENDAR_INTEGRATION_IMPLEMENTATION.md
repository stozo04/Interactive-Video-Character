# Gmail Calendar Integnration Implementation Summary

## ✅ Implementation Complete

This document summarizes the Gmail Calendar integration implementation

---

Here is an extremely detailed, step-by-step guide to integrate Google Calendar reading and event creation into your existing application.

This plan follows the exact same patterns you've already established with your googleAuth.ts and gmailService.ts, which will make it easy to follow.

We will:

Update Permissions in googleAuth.ts to ask for Calendar access.

Create a new calendarService.ts to handle all API logic (get, create).

Update grokChatService.ts to make the AI "aware" of calendar events and "intent."

Update App.tsx to poll for events, notify the character, and handle event creation.

🛑 Important First Step: Update Permissions
You must do this, or nothing else will work. We need to tell Google we want to access the Calendar in addition to Gmail.

1. Edit src/services/googleAuth.ts
Modify the scope definitions at the top of the file.
// src/services/googleAuth.ts

// Gmail scopes - using metadata scope for privacy
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";
// NEW: Add the Google Calendar scope (read/write)
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

// NEW: Combine all scopes into one string
const SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE].join(' ');

// Buffer time before token expiry to refresh (5 minutes)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ... (rest of the file is the same until getAccessToken)

2. Update getAccessToken
Find the getAccessToken function and change scope: GMAIL_SCOPE to scope: SCOPES.
// src/services/googleAuth.ts

export async function getAccessToken(
  forceConsent = false
): Promise<Omit<GmailSession, "email">> {
  await loadGisScript();
  validateClientId();

  return new Promise((resolve, reject) => {
    try {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES, // <-- ⭐ MODIFICATION HERE
        // 'prompt' is the key:
        // 'consent' = always show popup
        // '' (empty) = try silent sign-in
        // ... (rest of the function)
      });
      
      // Request the token
      client.requestAccessToken();
    } catch (error) {
      // ... (rest of the function)
    }
  });
}

3. Sign Out and Sign Back In
Because you've changed the permissions, your old access token is no longer valid. You must sign out of your app and sign back in. Google will show you a new consent screen asking for permission to "view, edit, share, and permanently delete all calendars you can access."

📅 Part 2: Create calendarService.ts
This new file will manage all communication with the Google Calendar API.

Create a new file: src/services/

🤖 Part 3: Update grokChatService.ts
We need to make the AI "aware" of the calendar so it can remind the user and format its "add event" requests.

1. Update GrokChatOptions Interface
Add upcomingEvents as an optional parameter.

// src/services/grokChatService.ts

// ... (imports)

// ... (GrokChatSession interface)

interface GrokChatOptions {
  character?: CharacterProfile;
  matchingAction?: CharacterAction | null;
  chatHistory?: ChatMessage[];
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[]; // <-- ⭐ ADD THIS LINE
}

// ... (generateGrokResponse function)

2. Update generateGrokResponse
Pass the new upcomingEvents option from options to buildSystemPrompt.

TypeScript

// src/services/grokChatService.ts

export const generateGrokResponse = async (
  userMessage: string,
  options: GrokChatOptions = {},
  session?: GrokChatSession
): Promise<{ response: string; session: GrokChatSession }> => {
  if (!API_KEY) {
    // ... (error)
  }

  const { character, matchingAction, chatHistory = [], relationship, upcomingEvents } = options; // <-- ⭐ ADD upcomingEvents

  // Build system prompt with character context and relationship state
  const systemPrompt = buildSystemPrompt(character, matchingAction, relationship, upcomingEvents); // <-- ⭐ PASS upcomingEvents

  // ... (rest of the function)
3. Update buildSystemPrompt
This is where we give the AI its new instructions.

TypeScript

// src/services/grokChatService.ts

const buildSystemPrompt = (
  character?: CharacterProfile,
  matchingAction?: CharacterAction | null,
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = [] // <-- ⭐ ADD NEW PARAMETER
): string => {
  let prompt = `You are an interactive AI character in a video application. `;
  
  // ... (existing character prompt)
  
  // ... (existing relationship prompt)

  // ... (existing action prompt)
  
  // ... (existing matchingAction prompt)
  
  // --- ⭐ ADD NEW CALENDAR SECTION START ---
  if (upcomingEvents.length > 0) {
    prompt += `\n\n[User's Calendar for next 24 hours]:\n`;
    upcomingEvents.forEach(event => {
      const startTime = new Date(event.start.dateTime || event.start.date);
      prompt += `- "${event.summary}" at ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`;
    });
    prompt += `You can proactively remind the user if an event is starting soon.`;
  } else {
    prompt += `\n\n[User's Calendar for next 24 hours]: No upcoming events.`;
  }
  
  prompt += `
\n[Calendar Actions]:
- To create a calendar event, you MUST respond ONLY with the following JSON format:
[CALENDAR_CREATE]{"summary": "Title of event", "start": {"dateTime": "YYYY-MM-DDTHH:MM:SS", "timeZone": "America/New_York"}, "end": {"dateTime": "YYYY-MM-DDTHH:MM:SS", "timeZone": "America/New_York"}}
- You MUST guess the user's timezone (e.g., "America/New_York", "Europe/London", "America/Chicago", "America/Los_Angeles").
- You MUST get the full date and time for start and end. If the user says "tomorrow at 10", you must calculate that date. Assume today's date is ${new Date().toISOString().split('T')[0]}.
- If you don't have enough info (e.g., duration), you must ask the user for it. DO NOT use the [CALENDAR_CREATE] format until you have all info.
`;
  // --- ⭐ ADD NEW CALENDAR SECTION END ---

  prompt += `
\nResponse Guidelines:
// ... (rest of the prompt)
🔌 Part 4: Update App.tsx (The Final Integration)
This is where we'll add the new polling loops and update handleSendMessage.

1. Add Imports and State
TypeScript

// src/App.tsx

// ... (existing imports)
import { 
  calendarService, 
  type CalendarEvent, 
  type NewEventPayload 
} from './services/calendarService'; // <-- ⭐ ADD CALENDAR SERVICE

// ... (existing App component)
const App: React.FC = () => {
  // ... (existing state)

  // Gmail Integration State
  const [isGmailConnected, setIsGmailConnected] = useState(false);
  const [emailQueue, setEmailQueue] = useState<NewEmailPayload[]>([]);
  const debouncedEmailQueue = useDebounce(emailQueue, 5000); // 5 second debounce

  // --- ⭐ ADD NEW CALENDAR STATE START ---
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [notifiedEventIds, setNotifiedEventIds] = useState<Set<string>>(new Set());
  // --- ⭐ ADD NEW CALENDAR STATE END ---

  const idleActionTimerRef = useRef<number | null>(null);

  // ... (existing functions: reportError, registerInteraction, etc.)
2. Add Calendar Polling Loop
Add this new useEffect right after your "Gmail Integration: Polling Loop" useEffect. This loop will fetch events every 5 minutes and proactively remind the user.

TypeScript

// src/App.tsx

  // ... (after Gmail polling useEffect)

  // --- ⭐ ADD NEW CALENDAR POLLING LOOP START ---
  const pollCalendar = useCallback(async () => {
    if (!isGmailConnected || !session) return; // Use same connection flag

    try {
      const events = await calendarService.getUpcomingEvents(session.accessToken);
      setUpcomingEvents(events); // Update state for the AI to read

      // Proactive reminder logic
      const now = Date.now();
      const reminderWindowMs = 15 * 60 * 1000; // 15 minutes

      for (const event of events) {
        if (!event.start?.dateTime) continue; // Skip all-day events

        const startTime = new Date(event.start.dateTime).getTime();
        
        // Check if event is starting soon and hasn't been notified
        if (
          startTime > now &&
          startTime < (now + reminderWindowMs) &&
          !notifiedEventIds.has(event.id)
        ) {
          console.log(`⏰ Notifying character about upcoming event: ${event.summary}`);
          
          const systemMessage = 
            `[⏰ System Notification] You have an event starting in less than 15 minutes:\n` +
            `Event: ${event.summary}\n` +
            `Time: ${new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          
          // Send this notification to the AI
          await handleSendMessage(systemMessage);
          
          // Mark as notified
          setNotifiedEventIds(prev => new Set(prev).add(event.id));
        }
      }
    } catch (error) {
      console.error('Calendar polling error:', error);
    }
  }, [isGmailConnected, session, notifiedEventIds, handleSendMessage]); // Add handleSendMessage to dependencies

  useEffect(() => {
    if (!isGmailConnected || !session) {
      return;
    }

    // Poll immediately
    pollCalendar();

    const pollInterval = 5 * 60 * 1000; // Poll calendar every 5 minutes
    const intervalId = setInterval(pollCalendar, pollInterval);

    return () => clearInterval(intervalId);
  }, [isGmailConnected, session, pollCalendar]);
  // --- ⭐ ADD NEW CALENDAR POLLING LOOP END ---
3. Update Calendar Event Listeners
Just like Gmail, we need to listen for auth errors from the calendarService. Modify your existing "Gmail Integration: Event Listeners" useEffect to include the calendar service.

TypeScript

// src/App.tsx

  // Gmail Integration: Event Listeners
  useEffect(() => {
    // ... (existing handleNewMail)

    // Handler for auth errors (token expired)
    const handleAuthError = () => {
      console.error('🔒 Google authentication error - token likely expired');
      setIsGmailConnected(false);
      localStorage.removeItem('gmail_history_id');
      // ⭐ ADD THIS LINE:
      setUpcomingEvents([]); // Clear calendar events
      setErrorMessage('Google session expired. Please reconnect your account.');
    };

    // Start listening
    gmailService.addEventListener('new-mail', handleNewMail);
    gmailService.addEventListener('auth-error', handleAuthError);
    // ⭐ ADD THIS LINE:
    calendarService.addEventListener('auth-error', handleAuthError);

    // Stop listening on cleanup
    return () => {
      gmailService.removeEventListener('new-mail', handleNewMail);
      gmailService.removeEventListener('auth-error', handleAuthError);
      // ⭐ ADD THIS LINE:
      calendarService.removeEventListener('auth-error', handleAuthError);
    };
  }, []); // Keep dependencies as-is (or add signOut if linting complains)
4. Update handleSendMessage
This is the final and most important change. We need to:

Pass upcomingEvents to generateGrokResponse.

Check the AI's response for our special [CALENDAR_CREATE] tag.

TypeScript

// src/App.tsx

  const handleSendMessage = async (message: string) => {
    if (!selectedCharacter || !session) return; // ⭐ ADDED !session CHECK

    registerInteraction();
    setErrorMessage(null);
    
    // ... (rest of function up to relationship update)

    // Update relationship based on sentiment
    const updatedRelationship = await relationshipService.updateRelationship(
      selectedCharacter.id,
      userId,
      relationshipEvent
    );
    
    if (updatedRelationship) {
      setRelationship(updatedRelationship);
    }

    // Generate response from Grok chat service (with relationship context)
    const grokSession = grokSession || grokChatService.getOrCreateSession(selectedCharacter.id, userId);
    
    const { response, session: updatedSession } = await grokChatService.generateGrokResponse(
      message,
      {
        character: selectedCharacter,
        matchingAction,
        chatHistory: updatedHistory,
        relationship: updatedRelationship,
        upcomingEvents: upcomingEvents, // <-- ⭐ PASS CALENDAR EVENTS
      },
      grokSession
    );
    
    setGrokSession(updatedSession);
    
    // --- ⭐ ADD CALENDAR ACTION CHECK START ---
    if (response.startsWith('[CALENDAR_CREATE]')) {
      try {
        const jsonString = response.substring('[CALENDAR_CREATE]'.length);
        const eventData: NewEventPayload = JSON.parse(jsonString);

        // Add a confirmation message to chat *before* making API call
        const confirmationText = `Okay, I'll add "${eventData.summary}" to your calendar.`;
        const finalHistory = [...updatedHistory, { role: 'model' as const, text: confirmationText }];
        setChatHistory(finalHistory);

        // Asynchronously save this confirmation
        conversationHistoryService.appendConversationHistory(
          selectedCharacter.id,
          userId,
          [
            { role: 'user', text: message },
            { role: 'model', text: confirmationText },
          ]
        ).then(() => {
          setLastSavedMessageIndex(finalHistory.length - 1);
        }).catch(error => {
          console.error('Failed to save conversation history:', error);
        });
        
        // Now, create the event
        await calendarService.createEvent(session.accessToken, eventData);
        
        // Refresh calendar events immediately
        pollCalendar();
        
      } catch (err) {
        console.error("Failed to create calendar event:", err);
        setErrorMessage("I tried to create the event, but something went wrong.");
        // Add error message to chat
        setChatHistory(prev => [...prev, { role: 'model', text: "Sorry, I ran into an error trying to add that to your calendar." }]);
      }
      
      setIsProcessingAction(false);
      return; // Stop here, we've handled the response
    }
    // --- ⭐ ADD CALENDAR ACTION CHECK END ---

    // Add response to local state
    const finalHistory = [...updatedHistory, { role: 'model' as const, text: response }];
    setChatHistory(finalHistory);
    
    // ... (rest of the function: save history, play action, etc.)
  };
5. Update handleBackToSelection
When the user logs out of a character, clear the calendar state.

TypeScript

// src/App.tsx

  const handleBackToSelection = async () => {
    // ... (existing logic)
    setGrokSession(null);
    setLastSavedMessageIndex(-1);
    setRelationship(null);
    // --- ⭐ ADD THESE LINES START ---
    setUpcomingEvents([]);
    setNotifiedEventIds(new Set());
    // --- ⭐ ADD THESE LINES END ---
    setUploadedImage(null);
    setErrorMessage(null);
    // ... (rest of function)
  };
🚀 How This Works
Polling: Your app now polls for Gmail (every 60s) and Calendar (every 5min).

AI Awareness (Read): The calendar poll updates the upcomingEvents state. This state is passed to grokChatService every time the user sends a message, so the AI always has the latest info.

Proactive Reminders (Read): The calendar poll also checks if any event is starting in the next 15 minutes. If it finds one (and hasn't told you about it yet), it sends a system message (like [⏰ System Notification]...) to handleSendMessage. This makes the AI "speak" without you prompting it.

Event Creation (Write):

You ask the AI, "Add a meeting tomorrow at 10 AM with Bob for one hour."

The AI (Grok) sees the [Calendar Actions] instructions.

It calculates the date and time and responds only with the special string: [CALENDAR_CREATE]{"summary": "Meeting with Bob", "start":...}.

handleSendMessage catches this string, stops the normal chat flow, parses the JSON, and calls calendarService.createEvent().

It then adds a friendly confirmation ("Okay, I've added it...") to the chat instead of the raw JSON.

A Note on "Deleting Events"
I've included deleteEvent in the service, but it's much harder to implement with AI. To delete, you need an eventId. The AI would only know the summary (e.g., "Meeting with Bob").

To make "delete" work, you would have to:

Have the AI respond with a special tag like [CALENDAR_DELETE]{"summary": "Meeting with Bob"}.

Your handleSendMessage function would catch this.

It would then have to call calendarService.getUpcomingEvents().

It would search the returned events for one whose summary matches "Meeting with Bob" and get its id.

Then it could call calendarService.deleteEvent(accessToken, eventId).

This is a great "next step" feature, but the Read and Create logic you have now is the perfect foundation.""