Feature: "Screen Eyes" (Screen Sharing) Implementation Guide
🎯 The Goal
Problem: Kayley can see you (via webcam), but she can't see what you are working on. Users want to ask, "Does this email sound rude?" or "Why is my code crashing?"

Solution: Add a "Share Screen" button. When clicked, it uses the browser's native Screen Sharing API to capture a single screenshot of the user's desktop or specific window and sends it to the AI for analysis.

🧠 Core Concept
We are reusing the existing Visual Pipeline.

Capture: Instead of getUserMedia (Webcam), we use getDisplayMedia (Screen).

Process: Draw the frame to a hidden canvas to convert it to Base64.

Send: Reuse the existing onSendImage prop in ChatPanel. The backend (geminiChatService) already knows how to handle images!

🛠️ Step 1: Update ChatPanel Logic
File: src/components/ChatPanel.tsx

We need a function that triggers the browser's screen picker, grabs one frame, and closes the stream immediately.

1.1 Add the Helper Function
Inside the ChatPanel component (before the return statement), add this function:

TypeScript

const handleScreenCapture = async () => {
  if (!onSendImage || isSending) return;

  try {
    // 1. Ask user to select a screen/window
    const stream = await navigator.mediaDevices.getDisplayMedia({ 
      video: { cursor: "always" }, 
      audio: false 
    });

    const videoTrack = stream.getVideoTracks()[0];

    // 2. Create a hidden video element to play the stream
    // (We need to play it to grab a frame)
    const video = document.createElement('video');
    video.srcObject = stream;
    
    // Wait for video to be ready
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve(null);
      };
    });

    // 3. Draw the frame to a canvas
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // 4. Convert to Base64
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8); // 0.8 quality is fine
      const base64 = dataUrl.split(',')[1];

      // 5. Send to Parent (App.tsx)
      // We add a little context text so the AI knows what it's looking at
      onUserActivity?.(); // Reset idle timers
      onSendImage(base64, 'image/jpeg');
    }

    // 6. Cleanup: Stop the screen share immediately
    // We only needed one frame, we don't need a live stream
    videoTrack.stop();
    video.srcObject = null;

  } catch (err) {
    // User likely cancelled the screen share prompt
    console.log("Screen share cancelled or failed:", err);
  }
};
🖥️ Step 2: Add the UI Button
File: src/components/ChatPanel.tsx

Add a "Screen Share" button next to your existing Camera/Image buttons.

TypeScript

{/* Add this inside the form, near the existing Camera/Image buttons */}

{onSendImage && (
  <button
    type="button"
    onClick={handleScreenCapture}
    disabled={isSending}
    className="p-3 rounded-full text-gray-400 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
    title="Share Screen"
  >
    {/* Desktop/Monitor Icon */}
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  </button>
)}
🔌 Step 3: Verify Backend (Sanity Check)
File: src/services/geminiChatService.ts

You shouldn't need to change code here if Visual Context was already implemented, but double-check generateResponse handles image_text correctly.

It should look something like this:

TypeScript

} else if (message.type === 'image_text') {
   messageParts = [
     { text: message.text }, // "What do you think of this?"
     {
        inlineData: {
          mimeType: message.mimeType,
          data: message.imageData
        }
     }
   ];
}
If this logic exists, you are good to go!

🧪 Testing Checklist
Permission Request:

Click the "Monitor" icon.

Does the browser pop up a "Choose what to share" dialog?

Capture:

Select a specific window (e.g., your code editor or a funny meme).

Does the dialog disappear immediately after you click "Share"? (It should, because we stop the stream instantly).

Chat Feedback:

Does 📷 [Sent an Image] appear in the chat history?

Does the image preview appear in the chat bubble?

AI Response:

Does Kayley comment on the screen content?

Example: Share a screenshot of code. She should say something like "I see some React code there!" or "Looks like a bug in the useEffect."

⚠️ Important Implementation Notes
Privacy First: We strictly capture one frame. We do not keep the stream open. This ensures we aren't recording the user's screen in the background.

Mobile Support: getDisplayMedia does not work on most mobile browsers (iOS/Android). You might want to wrap the button in a check:

TypeScript

const canScreenShare = 'mediaDevices' in navigator && 'getDisplayMedia' in navigator.mediaDevices;
// Only render button if canScreenShare is true