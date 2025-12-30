Feature: "Fit Check" (Visual Context) Implementation Guide
🎯 The Goal
Problem: Currently, the AI is blind. It can hear and read, but it can't see. Solution: We will add a camera button. When clicked, it opens the webcam, captures a frame, and sends it to Gemini 1.5 Flash (which is multimodal) along with a prompt like "What do you think of this?"

🛠️ Step 1: Update the "Brain" Interfaces
File: src/services/aiService.ts

First, we need to teach our TypeScript interfaces that sending an "Image" is a valid operation. Currently, UserContent only supports 'text' and 'audio'.

Update UserContent type: Add the image_text type definition.

TypeScript

// src/services/aiService.ts

export type UserContent = 
  | { type: 'text'; text: string }
  | { type: 'audio'; data: string; mimeType: string }
  // 👇 ADD THIS:
  | { type: 'image_text'; text: string; imageData: string; mimeType: string };
🧠 Step 2: Teach Gemini to "See"
File: src/services/geminiChatService.ts

Now we need to update the Gemini service to handle this new message type.

Update generateResponse: Inside the try block, look for where messageParts is constructed. Add a case for image_text.

TypeScript

// src/services/geminiChatService.ts

let messageParts: any[] = [];

if (message.type === 'text') {
   // ... existing text logic
} else if (message.type === 'audio') {
   // ... existing audio logic
} else if (message.type === 'image_text') { // 👈 NEW BLOCK
   messageParts = [
     { text: message.text },
     {
       inlineData: {
         mimeType: message.mimeType,
         data: message.imageData // This is the Base64 string
       }
     }
   ];
}
📸 Step 3: Build the Camera UI
File: src/components/ChatPanel.tsx

This is the biggest task. We need to add a camera button, handle the webcam stream, and capture a still image.

3.1 Update Props
We need to accept a new function onSendImage from the parent.

TypeScript

// src/components/ChatPanel.tsx

interface ChatPanelProps {
  // ... existing props
  onSendImage?: (base64: string, mimeType: string) => void; // 👈 Add this
}

const ChatPanel: React.FC<ChatPanelProps> = ({ 
  // ... existing destructuring
  onSendImage, // 👈 Destructure it
  // ...
}) => {
3.2 Add State & Refs
We need state to track if the camera is open and refs to hold the video stream HTML elements.

TypeScript

  // Inside ChatPanel component
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
3.3 Create Helper Functions
Add these functions inside ChatPanel.

startCamera: Requests camera access.

TypeScript

const startCamera = async () => {
  setIsCameraOpen(true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  } catch (err) {
    console.error("Camera error:", err);
    setIsCameraOpen(false);
  }
};
capturePhoto: Grabs a frame, converts to Base64, and sends it.

TypeScript

const capturePhoto = () => {
  if (!videoRef.current || !canvasRef.current || !onSendImage) return;

  const video = videoRef.current;
  const canvas = canvasRef.current;

  // Set canvas size to match video
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  // Draw current video frame to canvas
  const context = canvas.getContext('2d');
  context?.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Convert to Base64 string
  const dataUrl = canvas.toDataURL('image/jpeg');
  const base64 = dataUrl.split(',')[1]; // Remove "data:image/jpeg;base64," prefix

  // Stop camera stream
  const stream = video.srcObject as MediaStream;
  stream?.getTracks().forEach(track => track.stop());
  setIsCameraOpen(false);

  // Send to parent
  onSendImage(base64, 'image/jpeg');
};
closeCamera: Cleanup function.

TypeScript

const closeCamera = () => {
  const stream = videoRef.current?.srcObject as MediaStream;
  stream?.getTracks().forEach(track => track.stop());
  setIsCameraOpen(false);
};
3.4 Update the JSX (The Buttons)
Add the camera button next to the microphone button.

TypeScript

{/* Inside your form/button area */}

{/* CAMERA BUTTON */}
<button
  type="button"
  onClick={startCamera}
  disabled={isSending || isCameraOpen}
  className="p-3 rounded-full bg-gray-700 text-white hover:bg-gray-600 transition-colors"
>
  📷
</button>

{/* CAMERA MODAL/OVERLAY */}
{isCameraOpen && (
  <div className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4">
    <div className="relative w-full max-w-md bg-black rounded-lg overflow-hidden">
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        className="w-full h-auto object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />
      
      <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
        <button 
          onClick={closeCamera}
          className="px-4 py-2 bg-red-600 text-white rounded-full font-semibold"
        >
          Cancel
        </button>
        <button 
          onClick={capturePhoto}
          className="px-6 py-2 bg-white text-black rounded-full font-bold"
        >
          Snap & Send
        </button>
      </div>
    </div>
  </div>
)}
🔌 Step 4: Wire it in App.tsx
File: src/App.tsx

Find where <ChatPanel /> is rendered.

Pass the onSendImage prop (which is already defined in your App.tsx as handleSendImage).

TypeScript

<ChatPanel
  history={chatHistory}
  onSendMessage={handleSendMessage}
  onSendAudio={handleSendAudio}
  onSendImage={handleSendImage} // 👈 Make sure this is connected!
  useAudioInput={activeServiceId === 'gemini'} 
  isSending={isProcessingAction}
  onUserActivity={handleUserInterrupt}
/>
🧪 Verification Checklist
Permission Test: Click the camera button. Does the browser ask for camera permission?

Preview Test: Do you see your webcam feed in the modal?

Capture Test: Click "Snap & Send".

Does the modal close?

Does a "📷 [Sent an Image]" message appear in the chat?

AI Reaction Test: Wait 2-3 seconds. Does Kayley respond specifically to what you showed her? (e.g., "That's a nice blue shirt!")