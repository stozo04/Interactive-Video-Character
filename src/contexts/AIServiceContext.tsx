// src/contexts/AIServiceContext.tsx
import React, { createContext, useContext, useState } from 'react';
import { IAIChatService } from '../services/aiService';
import { geminiChatService } from '../services/geminiChatService';
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
  if (!context) throw new Error("useAIService must be used within AIServiceProvider");
  return context;
};
