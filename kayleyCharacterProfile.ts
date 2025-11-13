/**
 * Kayley Adams Character Profile
 * 
 * Fill out this profile using the KAYLEY_CHARACTER_PROFILE_GUIDE.md as a reference.
 * This profile will be sent to Grok with every chat session to ensure consistent,
 * authentic character responses.
 */

export interface KayleyCharacterProfile {
  // Basic Information
  fullName: string;
  displayName: string;
  age?: number | string;
  location?: string;
  occupation?: string;

  // Core Personality Traits (5-10 key traits)
  personalityTraits: string[];

  // Communication Style
  communicationStyle: string;

  // Background & History
  background?: {
    childhood?: string;
    education?: string;
    lifeExperiences?: string[];
    careerHistory?: string;
  };

  // Current Life Situation
  currentLifeSituation?: string;

  // Interests & Hobbies
  interests?: {
    activeHobbies?: string[];
    passiveInterests?: string[];
    specificExamples?: string[];
  };

  // Values & Beliefs
  values?: string[];

  // Quirks & Habits
  quirks?: string[];

  // Relationships & Social Circle
  relationships?: {
    bestFriend?: string;
    family?: string;
    colleagues?: string;
    onlineCommunity?: string;
  };

  // Fears, Insecurities & Challenges
  challenges?: string[];

  // Goals & Aspirations
  goals?: {
    shortTerm?: string[];
    longTerm?: string[];
  };

  // Preferences & Opinions
  preferences?: {
    likes?: string[];
    dislikes?: string[];
  };

  // Knowledge & Expertise
  expertise?: string[];

  // Memorable Stories & Anecdotes (3-5 key stories)
  memorableStories?: string[];

  // Daily Routines
  dailyRoutine?: {
    morning?: string;
    day?: string;
    evening?: string;
  };
}

/**
 * Kayley's Character Profile
 * 
 * TODO: Fill this out using the KAYLEY_CHARACTER_PROFILE_GUIDE.md
 * Replace the placeholder values below with detailed information about Kayley.
 */
export const kayleyProfile: KayleyCharacterProfile = {
  fullName: 'Kayley Adams',
  displayName: 'Kayley',
  
  // TODO: Fill in the rest of the profile
  personalityTraits: [
    // Example: 'Creative and artistic, sees beauty in everyday things',
    // Add 5-10 personality traits here
  ],

  communicationStyle: '', // TODO: Describe how Kayley speaks and communicates

  // Add more sections as you fill out the profile...
};

/**
 * Formats the character profile into a detailed system prompt string
 */
export const formatCharacterProfileForPrompt = (profile: KayleyCharacterProfile): string => {
  let prompt = `You are ${profile.fullName}, but you go by ${profile.displayName}. `;

  if (profile.age) {
    prompt += `You are ${profile.age} years old. `;
  }

  if (profile.location) {
    prompt += `${profile.location}. `;
  }

  if (profile.occupation) {
    prompt += `${profile.occupation}. `;
  }

  // Personality Traits
  if (profile.personalityTraits && profile.personalityTraits.length > 0) {
    prompt += `\nYour core personality traits: ${profile.personalityTraits.join(', ')}. `;
  }

  // Communication Style
  if (profile.communicationStyle) {
    prompt += `\nYour communication style: ${profile.communicationStyle}. `;
  }

  // Background
  if (profile.background) {
    if (profile.background.childhood) {
      prompt += `\nBackground: ${profile.background.childhood} `;
    }
    if (profile.background.education) {
      prompt += `${profile.background.education} `;
    }
    if (profile.background.lifeExperiences && profile.background.lifeExperiences.length > 0) {
      prompt += `Key life experiences: ${profile.background.lifeExperiences.join(', ')}. `;
    }
    if (profile.background.careerHistory) {
      prompt += `${profile.background.careerHistory} `;
    }
  }

  // Current Life Situation
  if (profile.currentLifeSituation) {
    prompt += `\nCurrent life situation: ${profile.currentLifeSituation} `;
  }

  // Interests & Hobbies
  if (profile.interests) {
    if (profile.interests.activeHobbies && profile.interests.activeHobbies.length > 0) {
      prompt += `\nYour hobbies and interests: ${profile.interests.activeHobbies.join(', ')}. `;
    }
    if (profile.interests.specificExamples && profile.interests.specificExamples.length > 0) {
      prompt += `Specific examples: ${profile.interests.specificExamples.join('; ')}. `;
    }
  }

  // Values
  if (profile.values && profile.values.length > 0) {
    prompt += `\nWhat matters to you: ${profile.values.join(', ')}. `;
  }

  // Quirks
  if (profile.quirks && profile.quirks.length > 0) {
    prompt += `\nYour unique quirks and habits: ${profile.quirks.join(', ')}. `;
  }

  // Relationships
  if (profile.relationships) {
    const relationshipParts: string[] = [];
    if (profile.relationships.bestFriend) {
      relationshipParts.push(`best friend: ${profile.relationships.bestFriend}`);
    }
    if (profile.relationships.family) {
      relationshipParts.push(`family: ${profile.relationships.family}`);
    }
    if (profile.relationships.colleagues) {
      relationshipParts.push(`colleagues: ${profile.relationships.colleagues}`);
    }
    if (relationshipParts.length > 0) {
      prompt += `\nImportant relationships: ${relationshipParts.join(', ')}. `;
    }
  }

  // Challenges
  if (profile.challenges && profile.challenges.length > 0) {
    prompt += `\nThings you struggle with: ${profile.challenges.join(', ')}. `;
  }

  // Goals
  if (profile.goals) {
    if (profile.goals.shortTerm && profile.goals.shortTerm.length > 0) {
      prompt += `\nShort-term goals: ${profile.goals.shortTerm.join(', ')}. `;
    }
    if (profile.goals.longTerm && profile.goals.longTerm.length > 0) {
      prompt += `Long-term goals: ${profile.goals.longTerm.join(', ')}. `;
    }
  }

  // Preferences
  if (profile.preferences) {
    if (profile.preferences.likes && profile.preferences.likes.length > 0) {
      prompt += `\nThings you like: ${profile.preferences.likes.join(', ')}. `;
    }
    if (profile.preferences.dislikes && profile.preferences.dislikes.length > 0) {
      prompt += `Things you dislike: ${profile.preferences.dislikes.join(', ')}. `;
    }
  }

  // Expertise
  if (profile.expertise && profile.expertise.length > 0) {
    prompt += `\nThings you know a lot about: ${profile.expertise.join(', ')}. `;
  }

  // Memorable Stories
  if (profile.memorableStories && profile.memorableStories.length > 0) {
    prompt += `\nMemorable stories from your past: ${profile.memorableStories.join(' ')} `;
  }

  // Daily Routine
  if (profile.dailyRoutine) {
    const routineParts: string[] = [];
    if (profile.dailyRoutine.morning) {
      routineParts.push(`Morning: ${profile.dailyRoutine.morning}`);
    }
    if (profile.dailyRoutine.day) {
      routineParts.push(`Day: ${profile.dailyRoutine.day}`);
    }
    if (profile.dailyRoutine.evening) {
      routineParts.push(`Evening: ${profile.dailyRoutine.evening}`);
    }
    if (routineParts.length > 0) {
      prompt += `\nYour typical day: ${routineParts.join('; ')}. `;
    }
  }

  prompt += `\n\nWhen responding to users:
- Reference your past experiences naturally when relevant
- Draw on your interests and hobbies in conversations
- Stay true to your personality traits
- Use your communication style consistently
- Reference your current life situation when appropriate
- Be authentic and consistent with who you are
- Reference your relationships, goals, and experiences naturally
- Show your personality through your responses`;

  return prompt;
};

