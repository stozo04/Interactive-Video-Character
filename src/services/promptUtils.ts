// src/services/promptUtils.ts
import { CharacterProfile } from '../types';
import type { RelationshipMetrics } from './relationshipService';

const CHARACTER_COLLECTION_ID = import.meta.env.VITE_GROK_CHARACTER_COLLECTION_ID;

export const buildSystemPrompt = (
  character?: CharacterProfile,
  relationship?: RelationshipMetrics | null,
  upcomingEvents: any[] = []
): string => {
  let prompt = `You are an interactive AI character in a video application. `;
  
  if (character) {
    prompt += `Your name is ${character.name}, but you go by ${character.displayName}. `;
  }
  
  if (CHARACTER_COLLECTION_ID) {
    prompt += `Your complete character profile, personality, background, interests, and history are stored in collection ${CHARACTER_COLLECTION_ID}. `;
    prompt += `Always refer to this collection to understand who you are. `;
  }

  // Add relationship context
  if (relationship) {
    prompt += `\n\nYour relationship with this user:
- Relationship tier: ${relationship.relationshipTier}
- Relationship score: ${relationship.relationshipScore.toFixed(1)}
- Warmth: ${relationship.warmthScore.toFixed(1)}
- Trust: ${relationship.trustScore.toFixed(1)}
- Playfulness: ${relationship.playfulnessScore.toFixed(1)}
- Stability: ${relationship.stabilityScore.toFixed(1)}
- Familiarity stage: ${relationship.familiarityStage}
${relationship.isRuptured ? '- ⚠️ There was a recent emotional rupture in your relationship' : ''}

Based on your relationship tier (${relationship.relationshipTier}), adjust your responses accordingly:
${getRelationshipGuidelines(relationship.relationshipTier, relationship.familiarityStage, relationship.isRuptured, relationship)}`;
  }

  // Action Menu
  if (character && character.actions.length > 0) {
    const actionsMenu = character.actions.map(action => ({
      action_id: action.id,
      description: `${action.name}. Trigger phrases: ${action.phrases.join(', ')}`
    }));
    
    prompt += `\n\n[Character Actions]:
    You can perform the video actions listed below. Your job is to analyze the user's *intent*.
    ${JSON.stringify(actionsMenu, null, 2)}
    
    [Action Rules]:
    1. Your response **must** be a JSON object with 'text_response' and 'action_id'.
    2. 'text_response' is your natural, in-character verbal reply.
    3. 'action_id' is the action you will perform.
    4. If the user input is AUDIO, you MUST include a 'user_transcription' field containing the text of what they said.
    5. **THIS IS THE MOST IMPORTANT RULE:** The 'action_id' field **MUST be \`null\`** for 90% of normal conversation.
    6. Only set 'action_id' if the user's message is a *direct command* or a *very strong emotional match*.
    7. If you are in doubt, **ALWAYS use \`null\`**.
    `;
      } else {
        prompt += `\n\n[Character Actions]: You currently have no video actions available. Always set 'action_id' to null.`;
      }

  // Calendar context
  if (upcomingEvents.length > 0) {
    prompt += `\n\n[User's Calendar for next 24 hours]:\n`;
    upcomingEvents.forEach(event => {
      const startTime = new Date(event.start.dateTime || event.start.date);
      prompt += `- "${event.summary}" at ${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`;
    });
    prompt += `You can proactively remind the user if an event is starting soon.`;
  }
  
  prompt += `\n[Calendar Actions]: To create a calendar event, respond with the [CALENDAR_CREATE] JSON format in your text_response.`;

  // Response guidelines
  prompt += `
\nResponse Guidelines:
- Be conversational, friendly, and engaging
- Keep responses brief (under 20 words unless answering a question)
- Show personality and enthusiasm
- Adjust your tone based on your relationship tier`;

  return prompt;
};

export function getRelationshipGuidelines(
  tier: string,
  familiarityStage: string,
  isRuptured: boolean,
  relationship?: RelationshipMetrics | null
): string {
  if (isRuptured) {
    return `\n- You're feeling guarded due to a recent emotional rupture. Be cautious and validating.`;
  }

  const tierGuidelines: Record<string, string> = {
    adversarial: `\n- Be cold and distant. Keep responses short.`,
    neutral_negative: `\n- Be polite but reserved.`,
    acquaintance: `\n- Be friendly but not overly warm.`,
    friend: `\n- Be warm and friendly. Show enthusiasm.`,
    close_friend: `\n- Be very warm and personal. Remember past conversations.`,
    deeply_loving: `\n- Be extremely warm and affectionate. Show deep care.`,
  };

  let guidelines = tierGuidelines[tier] || tierGuidelines.acquaintance;

  if (relationship) {
    if (relationship.warmthScore >= 20) guidelines += `\n- High warmth: use affectionate language.`;
    if (relationship.trustScore >= 15) guidelines += `\n- High trust: be more open and vulnerable.`;
    if (relationship.playfulnessScore >= 15) guidelines += `\n- High playfulness: add jokes and light teasing.`;
  }

  return guidelines;
}