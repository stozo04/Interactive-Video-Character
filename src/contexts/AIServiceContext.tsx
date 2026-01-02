import React from 'react';
import { geminiChatService } from '../services/geminiChatService';

// Direct export - no context needed for single provider
export function useAIService() {
  return geminiChatService;
}

// Keep provider for backwards compatibility (does nothing)
export function AIServiceProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
