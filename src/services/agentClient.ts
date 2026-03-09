// src/services/agentClient.ts
//
// Thin client that calls the server-side agent API.
// Replaces direct processUserMessage + GeminiService calls in App.tsx.
//
// Usage:
//   const result = await agentClient.sendMessage({ message, sessionId, ... });
//   const greeting = await agentClient.getGreeting({ sessionId, ... });

import type { OrchestratorResult } from '../handlers/messageActions/types';
import type { ChatMessage, NewEmailPayload } from '../types';
import type { UserContent } from './aiService';

const AGENT_BASE_URL = '/agent';

// ============================================================================
// Request Types
// ============================================================================

export interface AgentMessageRequest {
  message: string;
  /** Optional AI-specific message text (e.g., includes attachment contents) */
  messageForAI?: string;
  userContent?: UserContent;
  sessionId: string;
  chatHistory?: ChatMessage[];
  isMuted?: boolean;
  pendingEmail?: NewEmailPayload | null;
}

export interface AgentGreetingRequest {
  sessionId: string;
}

// ============================================================================
// Response Types
// ============================================================================

interface AgentMessageResponse {
  success: boolean;
  result: OrchestratorResult;
  error?: string;
}

interface AgentGreetingResponse {
  success: boolean;
  result: {
    greeting: any;
    session: any;
    audioData?: string;
  };
  error?: string;
}

interface ResolveTweetDraftResponse {
  success: boolean;
  tweetUrl?: string;
  error?: string;
}

// ============================================================================
// Client
// ============================================================================

async function sendMessage(request: AgentMessageRequest): Promise<OrchestratorResult> {
  const response = await fetch(`${AGENT_BASE_URL}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Agent message failed (${response.status}): ${text}`);
  }

  const data: AgentMessageResponse = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Agent message returned success=false');
  }

  return data.result;
}

async function getGreeting(request: AgentGreetingRequest): Promise<AgentGreetingResponse['result']> {
  const response = await fetch(`${AGENT_BASE_URL}/greeting`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Agent greeting failed (${response.status}): ${text}`);
  }

  const data: AgentGreetingResponse = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Agent greeting returned success=false');
  }

  return data.result;
}

async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${AGENT_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveTweetDraft(
  id: string,
  action: "post" | "reject",
): Promise<ResolveTweetDraftResponse> {
  const response = await fetch(`${AGENT_BASE_URL}/tweet-drafts/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });

  const data: ResolveTweetDraftResponse = await response.json().catch(() => ({
    success: false,
    error: 'Invalid server response.',
  }));

  if (!response.ok || !data.success) {
    return {
      success: false,
      error: data.error || `Failed to resolve tweet draft (${response.status}).`,
    };
  }

  return data;
}

export const agentClient = {
  sendMessage,
  getGreeting,
  healthCheck,
  resolveTweetDraft,
};
