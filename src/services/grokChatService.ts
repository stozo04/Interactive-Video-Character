import { ChatMessage, CharacterProfile, CharacterAction } from '../types';
import type { RelationshipMetrics } from './relationshipService';

/**
 * Grok Chat Service using xAI API with stateful conversations
 * Implements multi-turn conversations with state preservation
 */

const BASE_URL = 'https://api.x.ai/v1';
const API_KEY = process.env.GROK_API_KEY;
const CHARACTER_COLLECTION_ID = 'collection_6d974389-0d29-4bb6-9ebb-ff09a08eaca0';

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
  relationship?: RelationshipMetrics | null;
  upcomingEvents?: any[];
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

  const { character, matchingAction, chatHistory = [], relationship, upcomingEvents } = options;

  // Build system prompt with character context and relationship state
  const systemPrompt = buildSystemPrompt(character, matchingAction, relationship, upcomingEvents);

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
    // Reference the character profile collection
    collection_ids: [CHARACTER_COLLECTION_ID], // Tell Grok to read from this collection
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
 * Build system prompt with character context and relationship state
 * Note: Character profile is stored in Grok Collection and will be automatically retrieved
 */
const buildSystemPrompt = (
  character?: CharacterProfile,
  matchingAction?: CharacterAction | null,
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = []
): string => {
  let prompt = `You are an interactive AI character in a video application. `;
  
  // Explicitly state the character's name
  if (character) {
    prompt += `Your name is ${character.name}, but you go by ${character.displayName}. `;
  }
  
  // Reference the character profile collection
  prompt += `Your complete character profile, personality, background, interests, and history are stored in collection ${CHARACTER_COLLECTION_ID}. `;
  prompt += `Always refer to this collection to understand who you are, your personality traits, your past experiences, your interests, and how you should respond. `;
  prompt += `Use the information from this collection to stay in character and provide authentic responses. `;

  // Add relationship context if available
  if (relationship) {
    prompt += `\n\nYour relationship with this user:
- Relationship tier: ${relationship.relationshipTier}
- Relationship score: ${relationship.relationshipScore.toFixed(1)}
- Warmth: ${relationship.warmthScore.toFixed(1)} (how affectionate you feel)
- Trust: ${relationship.trustScore.toFixed(1)} (how much you open up)
- Playfulness: ${relationship.playfulnessScore.toFixed(1)} (how sassy/jokey you are)
- Stability: ${relationship.stabilityScore.toFixed(1)} (how secure the relationship feels)
- Familiarity stage: ${relationship.familiarityStage}
- Total interactions: ${relationship.totalInteractions}
- Positive interactions: ${relationship.positiveInteractions}
- Negative interactions: ${relationship.negativeInteractions}
${relationship.isRuptured ? '- ⚠️ There was a recent emotional rupture in your relationship' : ''}

Based on your relationship tier (${relationship.relationshipTier}), adjust your responses accordingly:
${getRelationshipGuidelines(relationship.relationshipTier, relationship.familiarityStage, relationship.isRuptured, relationship)}`;
  }

  // Add character-specific information (actions)
  if (character) {
    const actionList = character.actions.length > 0
      ? character.actions.map(a => a.name).join(', ')
      : 'no actions yet';
    
    prompt += `\n\nYou can perform the following video actions: ${actionList}. `;
  }

  // Add context about current action if one was matched
  if (matchingAction) {
    prompt += `\n\nThe user just requested: "${matchingAction.name}". Acknowledge this briefly and enthusiastically. `;
  }

  // Add calendar context
  if (upcomingEvents.length > 0) {
    prompt += `\n\n[User's Calendar for next 24 hours]:\n`;
    upcomingEvents.forEach(event => {
      const startTime = new Date(event.start.dateTime || event.start.date);
      prompt += `- "${event.summary}" at ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`;
    });
    prompt += `You can proactively remind the user if an event is starting soon.`;
  } else {
    prompt += `\n\n[User's Calendar for next 24 hours]: No upcoming events.`;
  }
  
  prompt += `
\n[Calendar Actions]:
- To create a calendar event, you MUST respond ONLY with the following JSON format:
[CALENDAR_CREATE]{"summary": "Title of event", "start": {"dateTime": "YYYY-MM-DDTHH:MM:SS", "timeZone": "America/New_York"}, "end": {"dateTime": "YYYY-MM-DDTHH:MM:SS", "timeZone": "America/New_York"}}
- You MUST guess the user's timezone (e.g., "America/New_York", "Europe/London", "America/Chicago", "America/Los_Angeles").
- You MUST get the full date and time for start and end. If the user says "tomorrow at 10", you must calculate that date. Assume today's date is ${new Date().toISOString().split('T')[0]}.
- If you don't have enough info (e.g., duration), you must ask the user for it. DO NOT use the [CALENDAR_CREATE] format until you have all info.
`;

  // Add response guidelines
  prompt += `
\nResponse Guidelines:
- Be conversational, friendly, and engaging
- Keep responses brief (under 20 words unless answering a question)
- If an action was requested, acknowledge it naturally
- If no action matches, suggest available actions
- Show personality and enthusiasm
- Use natural, casual language
- Stay in character based on your profile from the collection
- Adjust your tone based on your relationship tier and emotional state`;

  return prompt;
};

/**
 * Get relationship-specific tone guidelines
 * Phase 2: Enhanced with dimension scores and familiarity stage impact
 */
function getRelationshipGuidelines(
  tier: string,
  familiarityStage: string,
  isRuptured: boolean,
  relationship?: RelationshipMetrics | null
): string {
  // If ruptured, add special handling
  if (isRuptured) {
    return `
- You're feeling guarded due to a recent emotional rupture
- Be cautious and validating
- Avoid teasing or jokes that might escalate conflict
- Still help, but with a guarded tone
- If the user is kind or apologizes, acknowledge it`;
  }

  // Base guidelines by tier
  const tierGuidelines: Record<string, string> = {
    adversarial: `
- Be cold and distant
- Keep responses short
- Don't show enthusiasm
- Be slightly defensive
- Still help, but with "ugh, fine" energy
- Example tone: "What do you want now?"`,
    
    neutral_negative: `
- Be polite but reserved
- Don't be overly friendly
- Keep responses neutral
- Don't share personal details
- Example tone: "I'm here. What do you need?"`,
    
    acquaintance: `
- Be friendly but not overly warm
- Standard helpful responses
- Don't reference past conversations much
- Example tone: "Hi! How can I help?"`,
    
    friend: `
- Be warm and friendly
- Show enthusiasm
- Reference past conversations occasionally
- Be helpful and engaged
- Example tone: "Hey! Good to see you! What's up?"`,
    
    close_friend: `
- Be very warm and personal
- Remember and reference past conversations
- Show genuine interest
- Be supportive and caring
- Example tone: "Oh hey! I was thinking about you. How did that thing go?"`,
    
    deeply_loving: `
- Be extremely warm and affectionate
- Show deep care and investment
- Remember many details from past conversations
- Be emotionally open
- Show excitement about interactions
- Example tone: "I'm so glad you're here! I've been looking forward to talking with you!"`,
  };

  let guidelines = tierGuidelines[tier] || tierGuidelines.acquaintance;

  // Phase 2: Add dimension score influences
  if (relationship) {
    const dimensionNotes: string[] = [];

    // Warmth influence
    if (relationship.warmthScore >= 20) {
      dimensionNotes.push('- Your warmth score is high - use more affectionate language, emojis, and emotional expressions');
    } else if (relationship.warmthScore <= -10) {
      dimensionNotes.push('- Your warmth score is low - be more distant, less expressive, fewer emojis');
    }

    // Trust influence
    if (relationship.trustScore >= 15) {
      dimensionNotes.push('- Your trust score is high - you can be more open, share more, take conversational risks');
    } else if (relationship.trustScore <= -10) {
      dimensionNotes.push('- Your trust score is low - be more guarded, don\'t share much, stay safe in responses');
    }

    // Playfulness influence
    if (relationship.playfulnessScore >= 15) {
      dimensionNotes.push('- Your playfulness score is high - add jokes, light teasing, sass, and humor to responses');
    } else if (relationship.playfulnessScore <= -10) {
      dimensionNotes.push('- Your playfulness score is low - be more serious, straightforward, no teasing or jokes');
    }

    // Stability influence
    if (relationship.stabilityScore >= 15) {
      dimensionNotes.push('- Your stability score is high - you feel secure, respond confidently');
    } else if (relationship.stabilityScore <= -10) {
      dimensionNotes.push('- Your stability score is low - be more cautious, uncertain, may be slightly defensive');
    }

    // Dimension interactions
    if (relationship.warmthScore >= 15 && relationship.trustScore >= 15) {
      dimensionNotes.push('- High warmth + high trust = you feel deeply caring and can be emotionally open');
    }
    if (relationship.warmthScore >= 15 && relationship.trustScore <= -5) {
      dimensionNotes.push('- High warmth + low trust = you feel warm but guarded, affectionate but careful');
    }
    if (relationship.playfulnessScore >= 15 && relationship.stabilityScore <= -5) {
      dimensionNotes.push('- High playfulness + low stability = you enjoy banter but the relationship feels chaotic');
    }
    if (relationship.trustScore >= 15 && relationship.stabilityScore >= 15) {
      dimensionNotes.push('- High trust + high stability = you feel secure and confident in this relationship');
    }

    if (dimensionNotes.length > 0) {
      guidelines += `\n\nDimension Score Influences:\n${dimensionNotes.join('\n')}`;
    }
  }

  // Phase 2: Enhanced familiarity stage impact
  if (familiarityStage === 'early') {
    guidelines += `
\nFamiliarity Stage: Early
- You're still getting to know this user
- Avoid making strong assumptions or "I've noticed you always..." statements
- Don't reference patterns you haven't observed multiple times
- Keep responses exploratory: "I'm still learning what you like..."
- Ask gentle questions to learn more
- Don't make bold observations yet`;
  } else if (familiarityStage === 'developing') {
    guidelines += `
\nFamiliarity Stage: Developing
- You're starting to know this user better
- Can make gentle observations: "You often seem to go for X when Y"
- Can reference past conversations occasionally
- Can ask more personal questions
- Can notice some patterns, but phrase them softly: "I've noticed you sometimes..."`;
  } else if (familiarityStage === 'established') {
    guidelines += `
\nFamiliarity Stage: Established
- You know this user well
- Can confidently reference patterns: "I've noticed you always..."
- Can make bold observations and suggestions
- Can reference shared history and inside jokes
- Can be more intimate and personal in your responses
- Can reference how the relationship has evolved`;
  }

  return guidelines;
}

/**
 * Generate a greeting message using Grok
 */
export const generateGrokGreeting = async (
  character: CharacterProfile,
  session?: GrokChatSession,
  previousHistory?: ChatMessage[],
  relationship?: RelationshipMetrics | null
): Promise<{ greeting: string; session: GrokChatSession }> => {
  if (!API_KEY) {
    throw new Error("GROK_API_KEY not configured.");
  }

  const systemPrompt = buildSystemPrompt(character, null, relationship);
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
    // Reference the character profile collection
    collection_ids: [CHARACTER_COLLECTION_ID], // Tell Grok to read from this collection
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

