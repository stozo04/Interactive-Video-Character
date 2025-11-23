Phase 2: 🏗️ Architecture - The "De-Cluttering"
The Problem: App.tsx is huge (500+ lines). It manages video state, audio state, chat state, authentication, and API calls. It's hard to read and break.

The Solution: Custom Hooks. We will move logic into separate files.

Step 2.1: Create useMediaQueues.ts
Create src/hooks/useMediaQueues.ts. Move all videoQueue and audioQueue state here.

TypeScript

import { useState, useCallback } from 'react';

export const useMediaQueues = () => {
  const [videoQueue, setVideoQueue] = useState<string[]>([]);
  const [audioQueue, setAudioQueue] = useState<string[]>([]);

  // Derived state (no useEffect needed!)
  const currentVideoSrc = videoQueue[0] || null;
  const nextVideoSrc = videoQueue[1] || null;
  
  const currentAudioSrc = audioQueue[0] || null;

  const playAction = useCallback((url: string) => {
    setVideoQueue(prev => {
       const playing = prev[0];
       const rest = prev.slice(1);
       // Inject action immediately after current video
       return [playing, url, ...rest];
    });
  }, []);

  const handleVideoEnd = useCallback(() => {
    setVideoQueue(prev => prev.slice(1)); // Remove finished video
  }, []);

  const enqueueAudio = useCallback((audioData: string) => {
    setAudioQueue(prev => [...prev, audioData]);
  }, []);

  const handleAudioEnd = useCallback(() => {
    setAudioQueue(prev => prev.slice(1));
  }, []);

  return {
    currentVideoSrc,
    nextVideoSrc,
    currentAudioSrc,
    playAction,
    handleVideoEnd,
    enqueueAudio,
    handleAudioEnd,
    setVideoQueue // exposed for initialization
  };
};
Step 2.2: Clean up App.tsx
Now App.tsx becomes much simpler:

TypeScript

// src/App.tsx
import { useMediaQueues } from './hooks/useMediaQueues';

const App = () => {
  // 1. Call the hook
  const media = useMediaQueues();

  // ...

  // 2. Use the hook functions
  if (response.action_id) {
     media.playAction(actionUrl);
  }

  if (audioData) {
     media.enqueueAudio(audioData);
  }

  // 3. Render
  return (
    <>
       {media.currentAudioSrc && (
          <AudioPlayer src={media.currentAudioSrc} onEnded={media.handleAudioEnd} />
       )}
       <VideoPlayer 
          currentSrc={media.currentVideoSrc}
          nextSrc={media.nextVideoSrc}
          onVideoFinished={media.handleVideoEnd}
       />
    </>
  )
}
Phase 3: 🧼 Code Quality - Stop Repeating Yourself (DRY)
The Problem: grokChatService.ts and geminiChatService.ts have almost the exact same code for generateResponse (building prompts, handling history, logging errors).

The Solution: Create a Base Class.

Step 3.1: Create BaseAIService.ts
Create src/services/BaseAIService.ts.

TypeScript

import { IAIChatService, AIChatOptions, UserContent, AIChatSession } from './aiService';
import { buildSystemPrompt } from './promptUtils';
import { generateSpeech } from './elevenLabsService';

export abstract class BaseAIService implements IAIChatService {
  
  // 1. Abstract method: The only thing that changes per service
  protected abstract callProvider(
    systemPrompt: string, 
    userMessage: string, 
    history: any[]
  ): Promise<any>; // Returns structured JSON response

  // 2. Shared Logic
  async generateResponse(input: UserContent, options: AIChatOptions, session?: AIChatSession) {
    try {
      // Shared: Build Prompts
      const systemPrompt = buildSystemPrompt(options.character, options.relationship, options.upcomingEvents);
      
      // Shared: Audio/Text Handling
      const userText = input.type === 'text' ? input.text : "🎤 [Audio Message]";

      // Call the specific provider
      const aiResponse = await this.callProvider(systemPrompt, userText, options.chatHistory || []);

      // Shared: Voice Generation
      const audioData = await generateSpeech(aiResponse.text_response);

      return {
        response: aiResponse,
        session: session || { userId: 'unknown' }, // Update this logic as needed
        audioData
      };
    } catch (error) {
      console.error("AI Service Error:", error);
      throw error;
    }
  }
  
  // Implement generateGreeting similarly...
}
Step 3.2: Simplify Grok Service
Now grokChatService.ts becomes tiny!

TypeScript

import { BaseAIService } from './BaseAIService';

class GrokService extends BaseAIService {
  protected async callProvider(systemPrompt: string, userMessage: string, history: any[]) {
    // ONLY the xAI specific fetch code goes here
    // Return the parsed JSON object
  }
}

export const grokService = new GrokService();
Phase 4: ⚡ Performance - Async/Await
The Problem: In handleSendMessage, we have a mix of await and .then() that makes the code hard to read and debug.

The Solution: Promise.allSettled.

Step 4.1: Refactor handleSendMessage
TypeScript

const handleSendMessage = async (message: string) => {
  // ... setup ...

  // 1. Create the promises (don't await yet)
  const sentimentTask = relationshipService.analyzeMessageSentiment(message, chatHistory)
    .then(event => relationshipService.updateRelationship(userId, event));
    
  const responseTask = activeService.generateResponse(message, context, session);

  // 2. Run them together and wait for both to "settle" (finish or fail)
  const [sentimentResult, responseResult] = await Promise.allSettled([
    sentimentTask,
    responseTask
  ]);

  // 3. Handle Response (Critical)
  if (responseResult.status === 'fulfilled') {
    const { response, audioData } = responseResult.value;
    // ... update chat UI ...
  } else {
    setErrorMessage("AI Failed to respond");
  }

  // 4. Handle Sentiment (Non-critical)
  if (sentimentResult.status === 'fulfilled') {
     const updatedRelationship = sentimentResult.value;
     if (updatedRelationship) setRelationship(updatedRelationship);
  } else {
     console.warn("Background sentiment analysis failed, continuing...");
  }
  
  setIsProcessingAction(false);
};
Checklist for Implementation
[ ] Security: Move keys to Supabase Edge Functions.

[ ] Hooks: Extract useMediaQueues.

[ ] Classes: Implement BaseAIService.

[ ] Async: Refactor handleSendMessage with Promise.allSettled.

[ ] Verify: Run the app and ensure video/audio playback still works perfectly.