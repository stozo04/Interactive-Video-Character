import React, { createContext, useContext, useState, useEffect } from 'react';
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

  const setService = (id: ServiceType) => {
    console.log(`🧠 [AIServiceContext] Switching active brain to: ${id.toUpperCase()}`);
    setActiveServiceId(id);
  };

  const activeService = activeServiceId === 'grok' ? grokService : geminiChatService;

  useEffect(() => {
    console.log(`✅ [AIServiceContext] Active Service is now: ${activeServiceId}`);
  }, [activeServiceId]);

  return (
    <AIServiceContext.Provider value={{ activeServiceId, activeService, setService }}>
      {children}
    </AIServiceContext.Provider>
  );
}

export const useAIService = () => {
  const context = useContext(AIServiceContext);
  if (!context) throw new Error("useAIService must be used within AIServiceProvider");
  return context;
};