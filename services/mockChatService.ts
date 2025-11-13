import { ChatMessage, CharacterProfile, CharacterAction } from '../types';

/**
 * Mock ChatGPT service for generating character responses
 * This simulates ChatGPT API calls with realistic delays and responses
 */

interface MockChatOptions {
  character?: CharacterProfile;
  matchingAction?: CharacterAction | null;
  chatHistory?: ChatMessage[];
}

/**
 * Generate a mock ChatGPT response based on user message and context
 */
export const generateMockResponse = async (
  userMessage: string,
  options: MockChatOptions = {}
): Promise<string> => {
  const { character, matchingAction, chatHistory = [] } = options;

  // Simulate API delay (500ms - 2s)
  const delay = Math.random() * 1500 + 500;
  await new Promise(resolve => setTimeout(resolve, delay));

  // Analyze the user's message
  const messageLower = userMessage.toLowerCase().trim();
  
  // Generate contextual responses based on message content
  let response = '';

  // If an action was matched, acknowledge it
  if (matchingAction) {
    const actionResponses = [
      `Sure! ${matchingAction.name} coming right up!`,
      `I'd love to ${matchingAction.name.toLowerCase()} for you!`,
      `Here's ${matchingAction.name.toLowerCase()}!`,
      `Playing ${matchingAction.name} now!`,
      `Let me ${matchingAction.name.toLowerCase()} for you!`,
    ];
    response = actionResponses[Math.floor(Math.random() * actionResponses.length)];
    return response;
  }

  // Greetings
  if (messageLower.match(/^(hi|hello|hey|greetings|howdy)/)) {
    const greetings = [
      "Hello! How can I help you today?",
      "Hi there! What would you like me to do?",
      "Hey! Ready for some fun?",
      "Hello! I'm here and ready!",
      "Hi! What's on your mind?",
    ];
    response = greetings[Math.floor(Math.random() * greetings.length)];
  }
  // Questions about capabilities
  else if (messageLower.match(/(what can you|what do you|can you|abilities|capabilities)/)) {
    const actionList = character?.actions.map(a => a.name).join(', ') || 'various actions';
    response = `I can perform ${actionList}. Just tell me what you'd like me to do!`;
  }
  // Questions about how they're doing
  else if (messageLower.match(/(how are you|how's it going|how do you feel)/)) {
    const feelings = [
      "I'm doing great! Thanks for asking!",
      "I'm fantastic! Ready to interact with you!",
      "I'm feeling wonderful! How about you?",
      "I'm doing well! What would you like to do?",
      "I'm excellent! Let's have some fun!",
    ];
    response = feelings[Math.floor(Math.random() * feelings.length)];
  }
  // Compliments
  else if (messageLower.match(/(you're|you are|nice|great|awesome|cool|amazing)/)) {
    const thanks = [
      "Aww, thank you! That's so kind of you!",
      "Thanks! You're pretty awesome too!",
      "You're too sweet! I appreciate that!",
      "Thank you! That means a lot!",
      "Aww, you're making me blush!",
    ];
    response = thanks[Math.floor(Math.random() * thanks.length)];
  }
  // Requests for specific actions (but no match found)
  else if (messageLower.match(/(can you|please|would you|do|show|play|make)/)) {
    const actionList = character?.actions.map(a => a.name).join(', ') || 'actions';
    const apologies = [
      `I don't have that action available. I can do: ${actionList}.`,
      `Sorry, I can't do that. But I can: ${actionList}!`,
      `I'm not able to do that, but try asking for: ${actionList}.`,
      `That's not in my repertoire. I can perform: ${actionList}.`,
    ];
    response = apologies[Math.floor(Math.random() * apologies.length)];
  }
  // Questions
  else if (messageLower.match(/\?$/)) {
    const questionResponses = [
      "That's an interesting question! I'm here to interact with you through actions.",
      "Hmm, let me think... I'm better at doing actions than answering questions!",
      "I'm not sure about that, but I'd love to show you what I can do!",
      "That's a good question! Want to see one of my actions instead?",
      "I'm here to interact with you! Try asking me to do something!",
    ];
    response = questionResponses[Math.floor(Math.random() * questionResponses.length)];
  }
  // Name introduction
  else if (messageLower.match(/(my name is|i'm|i am|call me|name's)/)) {
    const nameMatch = userMessage.match(/(?:my name is|i'm|i am|call me|name's)\s+(\w+)/i);
    const name = nameMatch ? nameMatch[1] : 'there';
    response = `Nice to meet you, ${name}! I'm excited to get to know you!`;
  }
  // General conversation
  else {
    const generalResponses = [
      "That's interesting! What would you like me to do?",
      "I see! Want to try one of my actions?",
      "Got it! I'm here and ready to interact!",
      "Interesting! I'm ready when you are!",
      "I understand! What can I do for you?",
      "That's cool! Let's do something fun!",
    ];
    response = generalResponses[Math.floor(Math.random() * generalResponses.length)];
  }

  // Add some personality variation
  if (Math.random() > 0.7) {
    const emojis = ['😊', '😄', '✨', '🎉', '🌟'];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];
    response = `${response} ${emoji}`;
  }

  return response;
};

/**
 * Generate a greeting message when character is first loaded
 */
export const generateGreeting = async (
  character: CharacterProfile
): Promise<string> => {
  // Simulate small delay
  await new Promise(resolve => setTimeout(resolve, 300));
  return "Hey! What's on your mind?";
};

