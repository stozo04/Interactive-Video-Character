Phase 1: Centralize the "Brain" Logic
Currently, all the smart logic (relationship handling, calendar awareness, action decisions) is locked inside grokChatService.ts. Before we can make Gemini smart, we need to extract this logic so both services can use it.

Step 1.1: Create src/services/promptUtils.ts Move the buildSystemPrompt and getRelationshipGuidelines functions from grokChatService.ts into this new file.

// src/services/promptUtils.ts
import { CharacterProfile } from '../types';
import type { RelationshipMetrics } from './relationshipService';

export const buildSystemPrompt = (
  character?: CharacterProfile,
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = []
): string => {
  // ... [COPY THE ENTIRE FUNCTION BODY FROM grokChatService.ts] ...
  // Ensure you copy the 'actionsMenu' generation logic and JSON rules too!
};

export function getRelationshipGuidelines(
  tier: string,
  familiarityStage: string,
  isRuptured: boolean,
  relationship?: RelationshipMetrics | null
): string {
   // ... [COPY THE ENTIRE FUNCTION BODY FROM grokChatService.ts] ...
}

Phase 2: Define the Interface
Create a contract that both services must follow. This ensures that App.tsx doesn't care which AI is running.

Step 2.1: Create src/services/aiService.ts

TypeScript

// src/services/aiService.ts
import { ChatMessage, CharacterProfile } from '../types';
import { RelationshipMetrics } from './relationshipService';
import { GrokActionResponse } from './grokSchema';

export interface AIChatOptions {
  character?: CharacterProfile;
  chatHistory?: ChatMessage[];
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[];
}

export interface AIChatSession {
  characterId: string;
  userId: string;
  previousResponseId?: string; // For Grok
  model?: string;
  geminiHistory?: any[]; // For Gemini's history array
}

export interface IAIChatService {
  generateResponse(
    message: string,
    options: AIChatOptions,
    session?: AIChatSession
  ): Promise<{ response: GrokActionResponse; session: AIChatSession }>;

  generateGreeting(
    character: CharacterProfile,
    session?: AIChatSession,
    previousHistory?: ChatMessage[],
    relationship?: RelationshipMetrics | null
  ): Promise<{ greeting: GrokActionResponse; session: AIChatSession }>;
}
Phase 3: Update Gemini Service
Now we upgrade Gemini to support Chat and JSON output using the shared prompt logic.

Step 3.1: Modify src/services/geminiService.ts

TypeScript

import { GoogleGenAI } from "@google/genai"; // You already have this
import { IAIChatService, AIChatOptions, AIChatSession } from './aiService';
import { buildSystemPrompt } from './promptUtils'; // Use shared logic
import { GrokActionResponse } from './grokSchema'; // Use shared schema type

// ... (Keep your existing video generation code) ...

export const geminiChatService: IAIChatService = {
  generateResponse: async (message, options, session) => {
    if (!process.env.API_KEY) throw new Error("API_KEY not set");
    
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const { character, relationship, upcomingEvents } = options;

    // 1. Use the SHARED brain logic
    const systemInstruction = buildSystemPrompt(character, relationship, upcomingEvents);

    // 2. Configure model for JSON output
    const model = ai.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      generationConfig: { 
        responseMimeType: "application/json" 
      },
      systemInstruction: systemInstruction
    });

    // 3. Manage History (Gemini needs 'user'/'model' roles)
    // Note: You'll need to map your ChatMessage[] to Gemini's format here
    const chat = model.startChat({
      history: convertToGeminiHistory(options.chatHistory || [])
    });

    // 4. Send Message
    const result = await chat.sendMessage(message);
    const responseText = result.response.text();

    // 5. Parse and Return
    const structuredResponse: GrokActionResponse = JSON.parse(responseText);
    
    return {
      response: structuredResponse,
      session: session || { characterId: 'unknown', userId: 'unknown' }
    };
  },

  generateGreeting: async (character, session, previousHistory, relationship) => {
    // Implement similarly to generateResponse but with the greeting prompt
    // ...
    return { greeting: { text_response: "Hello!", action_id: "GREETING" }, session: session! }; // Placeholder
  }
};

// Helper to map chat history
function convertToGeminiHistory(history: any[]) {
  return history.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));
}
Phase 4: Create the Toggle Context
We need a way to switch between these two implementations globally.

Step 4.1: Create src/contexts/AIServiceContext.tsx

TypeScript

import React, { createContext, useContext, useState } from 'react';
import { IAIChatService } from '../services/aiService';
import { geminiChatService } from '../services/geminiService';
// You'll need to update grokChatService to export a 'grokService' object implementing the interface
import { grokService } from '../services/grokChatService'; 

type ServiceType = 'grok' | 'gemini';

interface AIServiceContextType {
  activeServiceId: ServiceType;
  activeService: IAIChatService;
  setService: (id: ServiceType) => void;
}

const AIServiceContext = createContext<AIServiceContextType | undefined>(undefined);

export function AIServiceProvider({ children }: { children: React.ReactNode }) {
  const [activeServiceId, setActiveServiceId] = useState<ServiceType>('grok');

  const activeService = activeServiceId === 'grok' ? grokService : geminiChatService;

  return (
    <AIServiceContext.Provider value={{ activeServiceId, activeService, setService: setActiveServiceId }}>
      {children}
    </AIServiceContext.Provider>
  );
}

export const useAIService = () => {
  const context = useContext(AIServiceContext);
  if (!context) throw new Error("useAIService must be used within provider");
  return context;
};
Phase 5: Update the Settings UI
Add the dropdown to your settings panel.

Step 5.1: Update src/components/SettingsPanel.tsx

TypeScript

import { useAIService } from '../contexts/AIServiceContext';

export function SettingsPanel(...) {
  const { activeServiceId, setService } = useAIService();
  
  return (
    // ... existing JSX ...
    <div className="border-t border-gray-700 pt-4 mt-4">
      <h3 className="text-sm font-medium text-gray-300 mb-2">AI Intelligence</h3>
      <select 
        value={activeServiceId}
        onChange={(e) => setService(e.target.value as 'grok' | 'gemini')}
        className="w-full bg-gray-900 text-white text-sm rounded-md p-2 border border-gray-600"
      >
        <option value="grok">Grok (xAI) - Beta</option>
        <option value="gemini">Gemini 1.5 Flash</option>
      </select>
    </div>
    // ...
  );
}
Phase 6: Connect to App
Finally, replace the direct import in App.tsx with the dynamic context.

Step 6.1: Update src/App.tsx

TypeScript

// Remove: import * as grokChatService from './services/grokChatService';
import { useAIService } from './contexts/AIServiceContext';

const App: React.FC = () => {
  // Get the generic service
  const { activeService } = useAIService(); 

  const handleSendMessage = async (message: string) => {
    // ... setup code ...
    
    // CHANGE THIS:
    // const { response } = await grokChatService.generateGrokResponse(...)
    
    // TO THIS:
    const { response } = await activeService.generateResponse(
      message,
      {
        character: selectedCharacter,
        chatHistory: updatedHistory,
        relationship: updatedRelationship,
        upcomingEvents: upcomingEvents,
      },
      grokSession // You might need to rename this state variable to 'aiSession'
    );
    
    // ... rest of logic remains EXACTLY the same because the Interface is the same!
  };
}