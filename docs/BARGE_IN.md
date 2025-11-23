Feature: "Barge-In" (Interruptibility) Implementation Guide
🎯 The Goal
Problem: Currently, if Kayley is speaking a long sentence and you try to reply, she keeps talking over you. It feels robotic. Solution: We need to detect when you start typing or recording and immediately cut her off, clearing her audio queue, just like a real conversation.

🛠️ Step 1: Update ChatPanel to Detect Activity
File: src/components/ChatPanel.tsx

The ChatPanel handles user input. It needs to tell the parent (App.tsx) whenever the user starts doing something, not just when they hit send.

Update the Interface: Add onUserActivity to the props.

TypeScript

interface ChatPanelProps {
  // ... existing props
  onUserActivity?: () => void; // <--- NEW PROP
}
Destructure the Prop:

TypeScript

const ChatPanel: React.FC<ChatPanelProps> = ({ 
  history, 
  onSendMessage, 
  // ... other props
  onUserActivity // <--- Add here
}) => {
Trigger on Typing: Update the input's onChange.

TypeScript

// Inside the returned JSX
<input
  type="text"
  value={input}
  onChange={(e) => {
    setInput(e.target.value);
    onUserActivity?.(); // <--- Notify parent when typing starts
  }}
  // ...
/>
Trigger on Mic Press: Update handleMicPress.

TypeScript

const handleMicPress = async () => {
  onUserActivity?.(); // <--- Notify parent when mic is clicked
  if (isSending) return;
  // ... rest of function
};
🧠 Step 2: Create the Interruption Logic
File: src/App.tsx

Now we need to handle that signal in the main app.

Create the Handler: Add this function inside App.

TypeScript

const handleUserInterrupt = () => {
  // Only interrupt if she is currently speaking or has audio queued
  if (isSpeaking || audioQueue.length > 0) {
    console.log("🛑 User interrupted! Stopping audio.");

    // 1. Stop the current audio immediately
    // Setting this to null unmounts AudioPlayer, triggering its cleanup (stop)
    setResponseAudioSrc(null);

    // 2. Clear any pending audio clips
    setAudioQueue([]);

    // 3. Reset speaking state
    setIsSpeaking(false);

    // 4. (Optional) Add a visual reaction to chat history
    // This helps the user know she stopped on purpose
    setChatHistory(prev => [
      ...prev, 
      { role: 'model', text: "*(Stops speaking)* Oh, sorry, go ahead." }
    ]);
  }
};
🔌 Step 3: Wire It Up
File: src/App.tsx

Connect your new handler to the ChatPanel.

Find the ChatPanel component in the JSX return statement.

Pass the prop:

TypeScript

<ChatPanel
  history={chatHistory}
  onSendMessage={handleSendMessage}
  onSendAudio={handleSendAudio}
  onSendImage={handleSendImage}
  useAudioInput={activeServiceId === 'gemini'} 
  isSending={isProcessingAction}
  onUserActivity={handleUserInterrupt} // <--- CONNECTED HERE
/>
🧪 Verification Checklist
The "Long Monologue" Test:

Ask Kayley: "Tell me a long story about your childhood."

Wait for her to start speaking.

Action: Click the "Record" button (or type a letter).

Result: She should stop talking instantly.

The Queue Test:

Ask a complex question that might generate multiple audio chunks (if you implement streaming later).

Action: Interrupt her.

Result: She should stop, and she should not start saying the next sentence 2 seconds later. The audioQueue clearing ensures this.

The "Polite" Test:

Result: You should see "(Stops speaking) Oh, sorry, go ahead." appear in the chat log.