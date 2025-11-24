import { CharacterProfile } from '../types';

/**
 * Scans a user's message to see if it matches any of the character's actions.
 * Returns the action ID if a match is found, or null.
 */
export const predictActionFromMessage = (
  message: string, 
  actions: CharacterProfile['actions']
): string | null => {
  const normalizedMsg = message.toLowerCase();
  
  // 🛡️ Guard Clause: Don't trigger if the user says "Don't"
  // Example: "Please don't wave" shouldn't trigger a wave.
  if (normalizedMsg.includes("don't") || normalizedMsg.includes("do not")) {
    return null;
  }

  // Loop through every available action the character has
  for (const action of actions) {
    // Check every trigger phrase for that action
    for (const phrase of action.phrases) {
      const normalizedPhrase = phrase.toLowerCase();
      
      // If the message contains the phrase (e.g. "wave hello" contains "wave")
      if (normalizedMsg.includes(normalizedPhrase)) {
        return action.id; // Found a match! Return "WAVE"
      }
    }
  }

  return null; // No match found
};

