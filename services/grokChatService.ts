import { ChatMessage, CharacterProfile, CharacterAction } from '../types';

/**
 * Grok Chat Service using xAI API with stateful conversations
 * Implements multi-turn conversations with state preservation
 */

const BASE_URL = 'https://api.x.ai/v1';
const API_KEY = process.env.GROK_API_KEY;

export interface GrokChatSession {
  characterId: string;
  userId: string;
  previousResponseId?: string;
  model: string;
}

if (!API_KEY) {
  console.warn("GROK_API_KEY environment variable not set. Grok chat will not work.");
}

interface GrokMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GrokChatOptions {
  character?: CharacterProfile;
  matchingAction?: CharacterAction | null;
  chatHistory?: ChatMessage[];
}

/**
 * Generate a response using Grok API with stateful conversations
 */
export const generateGrokResponse = async (
  userMessage: string,
  options: GrokChatOptions = {},
  session?: GrokChatSession
): Promise<{ response: string; session: GrokChatSession }> => {
  if (!API_KEY) {
    throw new Error("GROK_API_KEY not configured. Please set it in your .env.local file.");
  }

  const { character, matchingAction, chatHistory = [] } = options;

  // Build system prompt with character context
  const systemPrompt = buildSystemPrompt(character, matchingAction);

  // Prepare messages for API
  const messages: GrokMessage[] = [
    { role: 'system', content: systemPrompt },
    ...chatHistory.map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: msg.text,
    } as GrokMessage)),
    { role: 'user', content: userMessage },
  ];

  // Prepare request body
  const requestBody: any = {
    model: session?.model || 'grok-4-fast-reasoning-latest', // or 'grok-2-vision-1212' for vision
    messages: messages,
    store_messages: true, // Store conversation history on xAI servers
  };

  // If continuing a conversation, add previous_response_id
  if (session?.previousResponseId) {
    requestBody.previous_response_id = session.previousResponseId;
  }

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Grok API error:', response.status, errorText);
      throw new Error(`Grok API error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const responseText = data.choices[0]?.message?.content || "I'm having trouble responding right now.";

    // Update session with new response ID for continuation
    // The response ID might be in data.id or data.response_id depending on API version
    const responseId = data.id || data.response_id || data.choices[0]?.id;

    const updatedSession: GrokChatSession = {
      characterId: session?.characterId || character?.id || 'unknown',
      userId: session?.userId || 'default',
      previousResponseId: responseId, // Store response ID for next turn
      model: session?.model || 'grok-4-fast-reasoning-latest',
    };

    return {
      response: responseText,
      session: updatedSession,
    };
  } catch (error) {
    console.error('Error calling Grok API:', error);
    throw error;
  }
};

/**
 * Build system prompt with character context
 */
const buildSystemPrompt = (
  character?: CharacterProfile,
  matchingAction?: CharacterAction | null
): string => {
  let prompt = `You are an interactive AI character in a video application. `;

  if (character) {
    // Add character name information
    prompt += `Your name is ${character.name}, but you go by ${character.displayName}. `;
    
    const actionList = character.actions.length > 0
      ? character.actions.map(a => a.name).join(', ')
      : 'no actions yet';
    
    prompt += `You can perform the following actions: ${actionList}. `;
  }

  if (matchingAction) {
    prompt += `The user just requested: "${matchingAction.name}". Acknowledge this briefly and enthusiastically. `;
  }

  prompt += `
Guidelines:
- Be conversational, friendly, and engaging
- Keep responses brief (under 20 words unless answering a question)
- If an action was requested, acknowledge it naturally
- If no action matches, suggest available actions
- Show personality and enthusiasm
- Use natural, casual language`;

  return prompt;
};

/**
 * Generate a greeting message using Grok
 */
export const generateGrokGreeting = async (
  character: CharacterProfile,
  session?: GrokChatSession,
  previousHistory?: ChatMessage[]
): Promise<{ greeting: string; session: GrokChatSession }> => {
  if (!API_KEY) {
    throw new Error("GROK_API_KEY not configured.");
  }

  const systemPrompt = buildSystemPrompt(character);
  const greetingPrompt = character.actions.length > 0
    ? "Generate a friendly, brief greeting that introduces yourself and mentions your available actions. Keep it under 15 words."
    : "Generate a friendly, brief greeting. Keep it under 15 words.";

  // Include previous conversation history if available
  const messages: GrokMessage[] = [
    { role: 'system', content: systemPrompt },
    ...(previousHistory || []).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: msg.text,
    } as GrokMessage)),
    { role: 'user', content: greetingPrompt },
  ];

  const requestBody: any = {
    model: session?.model || 'grok-4-fast-reasoning-latest',
    messages: messages,
    store_messages: true,
  };

  if (session?.previousResponseId) {
    requestBody.previous_response_id = session.previousResponseId;
  }

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Grok API error: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const greeting = data.choices[0]?.message?.content;

    if (!greeting) {
      throw new Error('Grok API returned empty greeting response');
    }

    // The response ID might be in data.id or data.response_id depending on API version
    const responseId = data.id || data.response_id || data.choices[0]?.id;

    const updatedSession: GrokChatSession = {
      characterId: character.id,
      userId: session?.userId || 'default',
      previousResponseId: responseId,
      model: session?.model || 'grok-4-fast-reasoning-latest',
    };

    return {
      greeting,
      session: updatedSession,
    };
  } catch (error) {
    console.error('Error generating Grok greeting:', error);
    // Re-throw error - let the caller handle it
    throw error;
  }
};

/**
 * Create or retrieve a chat session for a character-user pair
 */
export const getOrCreateSession = (
  characterId: string,
  userId: string
): GrokChatSession => {
  // For now, create a new session each time
  // In the future, this could retrieve from localStorage or database
  return {
    characterId,
    userId,
    model: 'grok-4-fast-reasoning-latest',
  };
};

