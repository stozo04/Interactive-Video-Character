// src/services/agentClient.ts
//
// Thin client that calls the server-side agent API.
// Replaces direct processUserMessage + GeminiService calls in App.tsx.
//
// Usage:
//   const result = await agentClient.sendMessage({ message, sessionId, ... });
//   const greeting = await agentClient.getGreeting({ sessionId, ... });

import type { OrchestratorResult } from '../handlers/messageActions/types';
import type { ChatMessage, NewEmailPayload, ToolCallDisplay } from '../types';
import type { UserContent } from './aiService';
import type {
  SSEToolStartEvent,
  SSEToolEndEvent,
  SSEActionStartEvent,
  SSEActionEndEvent,
} from '../../server/services/ai/sseTypes';

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

export interface MediaHistoryEventRequest {
  mediaType: 'selfie' | 'video' | 'voice_note';
  status: 'delivered' | 'failed';
  historyId?: string | null;
  scene?: string;
  mood?: string | null;
  messageText?: string | null;
  videoUrl?: string | null;
  deliveryChannel?: string | null;
  error?: string | null;
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

async function sendMediaHistoryEvent(request: MediaHistoryEventRequest): Promise<void> {
  const response = await fetch(`${AGENT_BASE_URL}/media-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Media history event failed (${response.status}): ${text}`);
  }
}

// ============================================================================
// Stream Callbacks
// ============================================================================

export interface StreamCallbacks {
  onToolStart?: (event: SSEToolStartEvent) => void;
  onToolEnd?: (event: SSEToolEndEvent) => void;
  onActionStart?: (event: SSEActionStartEvent) => void;
  onActionEnd?: (event: SSEActionEndEvent) => void;
  onComplete: (result: OrchestratorResult) => void;
  onError: (error: string) => void;
}

// ============================================================================
// Streaming Client
// ============================================================================

async function sendMessageStream(
  request: AgentMessageRequest,
  callbacks: StreamCallbacks,
): Promise<void> {
  try {
    const response = await fetch(`${AGENT_BASE_URL}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      callbacks.onError(`Agent stream failed (${response.status}): ${text}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError('No readable stream available');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines: each event is "data: {...}\n\n"
      const lines = buffer.split('\n\n');
      // Keep incomplete last chunk in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        try {
          const event = JSON.parse(trimmed.slice(6));

          switch (event.type) {
            case 'tool_start':
              callbacks.onToolStart?.(event);
              break;
            case 'tool_end':
              callbacks.onToolEnd?.(event);
              break;
            case 'action_start':
              callbacks.onActionStart?.(event);
              break;
            case 'action_end':
              callbacks.onActionEnd?.(event);
              break;
            case 'turn_complete':
              callbacks.onComplete(event.result);
              break;
            case 'turn_error':
              callbacks.onError(event.error);
              break;
            // turn_start — no action needed
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } catch (err) {
    // Fallback: try regular sendMessage on connection failure
    try {
      const result = await sendMessage(request);
      callbacks.onComplete(result);
    } catch (fallbackErr) {
      callbacks.onError(
        fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      );
    }
  }
}

export const agentClient = {
  sendMessage,
  sendMessageStream,
  getGreeting,
  healthCheck,
  resolveTweetDraft,
  sendMediaHistoryEvent,
};
