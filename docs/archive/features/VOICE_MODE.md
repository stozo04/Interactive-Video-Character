Here is a comprehensive, step-by-step Level Up Guide formatted as a README.md. It breaks down the complex concepts into bite-sized tasks suitable for a junior developer.

🚀 Level Up Guide: Voice, Vision & "Life" Integration
Status: Draft Plan

Target: Junior Developer

Goal: Transform the character from a "text bot with video" into a "living companion" that speaks, moves its mouth, and can see images.

📚 Table of Contents
Overview

Prerequisites

Phase 1: The Voice (ElevenLabs Integration)

Phase 2: The Body (Procedural Lip Sync)

Phase 3: The Eyes (Vision Capabilities)

### 1. Overview
We are adding three major "senses" to Kayley:

Speech: She will speak using ElevenLabs, a hyper-realistic AI voice generator.

Lip Sync: When she speaks, we will swap her video loop to a "talking" animation so she doesn't look like a ventriloquist dummy.

Sight: Users can send images (outfits, sunsets, errors), and she will analyze them using Gemini/GPT-4o.

### Prerequisites
Before writing code, ensure you have:

ElevenLabs Account: Sign up at elevenlabs.io.

Get your API Key.

Create/Select a Voice ID for Kayley.

"Talking" Video Loop: A 2-3 second seamless video of Kayley looking at the camera and moving her mouth generically (nodding, smiling, talking).

Note: It doesn't need to match the words exactly. Just movement is enough to trick the brain.

Upload the Video: Upload this video to your Supabase character-videos bucket and note the public URL.


### Phase 1: The Voice (ElevenLabs Integration)
We need a service that takes a text string (e.g., "Hello!") and returns an audio file (MP3 Blob) that our browser can play.

#### Step 1.1: Add Environment Variables
Open your .env file and add:

Code snippet
```
VITE_ELEVEN_LABS_API_KEY=your_api_key_here
VITE_KAYLEY_VOICE_ID=your_voice_id_here
```
#### Step 1.2: Create the Service
Create a new file: src/services/elevenLabsService.ts.

Why? We want to keep external API calls separate from our React components.

TypeScript

// src/services/elevenLabsService.ts
```
const API_KEY = import.meta.env.VITE_ELEVEN_LABS_API_KEY;
const VOICE_ID = import.meta.env.VITE_KAYLEY_VOICE_ID;

export const generateSpeech = async (text: string): Promise<string> => {
  if (!API_KEY || !VOICE_ID) {
    console.warn("ElevenLabs keys missing!");
    return "";
  }

  try {
    // We use the 'stream' endpoint for lower latency
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5", // Turbo is faster/cheaper
          voice_settings: {
            stability: 0.5,       // Lower = more emotion, Higher = more robotic
            similarity_boost: 0.75 
          }
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API Error: ${response.statusText}`);
    }

    // Convert the response stream into a Blob (file-like object)
    const blob = await response.blob();
    
    // Create a temporary URL pointing to this Blob so our <audio> tag can play it
    return URL.createObjectURL(blob);
    
  } catch (error) {
    console.error("Speech generation failed:", error);
    return "";
  }
};
```

#### Step 1.3: Hook it into the Brain
Now we need to tell our AI Service to use this new tool.

Open src/services/geminiChatService.ts (or grokChatService.ts, whichever you use).

Find: The generateResponse function. Action: After you get the text response from the AI, call generateSpeech.

TypeScript
```
// Inside generateResponse...

// 1. Get text from AI
const responseText = result.response.text();

// 2. Generate Audio (NEW)
// Import generateSpeech from your new service first!
const audioUrl = await generateSpeech(responseText);

// 3. Return it
return {
  response: structuredResponse,
  session: updatedSession,
  audioData: audioUrl // Ensure your IAIChatService interface supports this field!
};
```

### Phase 2: The Body (Procedural Lip Sync)
Now that we have audio, we need to make her look like she is speaking. We will use a "visual override" technique.

#### Step 2.1: Add State to App.tsx
We need to track if she is currently speaking.

File: src/App.tsx

TypeScript
```
// Add inside the App component
const [isSpeaking, setIsSpeaking] = useState(false);
const [talkingVideoUrl, setTalkingVideoUrl] = useState<string | null>(null);

// Load the talking video URL on startup (Hardcoded for now or fetch from DB)
useEffect(() => {
  const url = "https://your-supabase-url.../talking_loop.mp4"; 
  setTalkingVideoUrl(url);
}, []);
```

####Step 2.2: The "Override" Logic
Currently, your video source (currentVideoSrc) comes strictly from the videoQueue. We need to hijack this.

Logic:

IF she is speaking (isSpeaking is true)

AND she isn't doing a specific action (like waving)

THEN show the talkingVideoUrl

ELSE show the normal videoQueue item.

File: src/App.tsx

Find: The line const currentVideoSrc = videoQueue[0] || null; Replace with:

TypeScript
```
// Derived state for the video player
const currentVideoSrc = 
  (isSpeaking && talkingVideoUrl && !currentActionId) 
    ? talkingVideoUrl 
    : (videoQueue[0] || null);
    ```

#### Step 2.3: Connect Audio Events
We need isSpeaking to flip to true exactly when the audio starts, and false when it ends.

File: src/App.tsx

Find: The <AudioPlayer /> component (usually hidden or near the top). Update:

TypeScript
```
{responseAudioSrc && (
  <AudioPlayer 
    src={responseAudioSrc}
    // When sound starts coming out
    onStart={() => setIsSpeaking(true)} 
    // When sound stops
    onEnded={() => {
      setIsSpeaking(false);
      handleAudioEnd(); // Your existing cleanup logic
    }} 
  />
)}
```
Note: You may need to update src/components/AudioPlayer.tsx to accept an onStart prop if it doesn't already. It's easy—just call onStart() right before source.start().

### Phase 3: The Eyes (Vision Capabilities)
Let's allow the user to upload images for Kayley to see.

#### Step 3.1: Update ChatPanel.tsx UI
We need a button to select images.

File: src/components/ChatPanel.tsx

Add a file input (hidden) and a button (paperclip icon).

When the user selects a file, convert it to Base64.

Pass this Base64 string up to the parent component.

TypeScript
```
// Add a prop to ChatPanel
interface ChatPanelProps {
  // ... existing props
  onSendImage?: (base64: string, mimeType: string) => void;
}


// Inside the component
const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => {
    // Result looks like "data:image/jpeg;base64,..."
    const result = reader.result as string;
    // Split to get just the base64 part
    const base64 = result.split(',')[1]; 
    
    onSendImage?.(base64, file.type);
  };
};

```
#### Step 3.2: Update App.tsx Handler
Handle the image in the main app logic.

File: src/App.tsx

TypeScript
```
const handleSendImage = async (base64: string, mimeType: string) => {
  // 1. Add the image to the chat history visually so the user sees it
  setChatHistory(prev => [...prev, { 
    role: 'user', 
    text: '📷 [Sent an Image]', 
    image: base64 // You might need to update ChatMessage type!
  }]);

  // 2. Send to AI Service
  const response = await activeService.generateResponse(
    { 
      type: 'image_text', // You'll need to update UserContent type
      text: "What do you think of this?", // Default prompt
      imageData: base64,
      mimeType: mimeType
    },
    // ... options
  );
  
  // 3. Handle response as usual
};
```

####  Step 3.3: Update AI Service (geminiChatService.ts)
Gemini Vision is the easiest to implement here.

File: src/services/geminiChatService.ts

TypeScript
```
// Inside generateResponse
if (input.type === 'image_text') {
  // Gemini specifically needs this format
  const parts = [
    { text: input.text },
    {
      inlineData: {
        mimeType: input.mimeType,
        data: input.imageData
      }
    }
  ];
  
  // Send to model
  const result = await chat.sendMessage({ parts });
  // ... process result
}
```

### 🏁 Summary of Changes
File                       | Responsibility          |  Complexity
elevenLabsService.ts       | Talks to the voice API. | Low
App.tsx                    | Manages the isSpeaking state and orchestrates video switching.  | Medium
VideoPlayer.tsx            | Plays the video (no major changes needed if derived state works).  | Low
AudioPlayer.tsx            | Needs onStart prop added. | Low
ChatPanel.tsx              | UI for image uploading.   |Low
geminiChatService.ts       | Logic to send images to the AI model.  | Medium


### Testing Checklist
Voice: Send "Hello". Do you hear a realistic voice?
Visuals: When she speaks, does the video switch to the "talking loop" instantly? Does it switch back when she stops?
Vision: Upload a picture of a cat. Does she say "Aww, what a cute cat!"?