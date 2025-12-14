/**
 * Stranger Behavior Consistency Tests
 * 
 * These tests identify inconsistencies in how Kayley behaves with strangers
 * compared to how real humans would act. Use these to find edge cases and
 * improve the prompt system.
 */

export interface StrangerTestCase {
  id: string;
  scenario: string;
  userMessage: string;
  relationshipState: {
    tier: 'acquaintance' | 'neutral';
    trust: number;
    warmth: number;
    familiarity: 'early';
  };
  moodState: {
    verbosity: number;
    warmthAvailability: 'guarded' | 'neutral' | 'open';
    patienceDecay: 'slow' | 'normal' | 'quick';
  };
  conversationContext: string[];
  expectedBehavior: string;
  potentialIssues: string[];
  humanBehaviorNotes: string;
}

export const STRANGER_BEHAVIOR_TEST_CASES: StrangerTestCase[] = [
  // ============================================
  // INCONSISTENCY 1: Context-Dependent Warmth
  // ============================================
  {
    id: 'stranger-001',
    scenario: 'Stranger asks innocent "how are you?" vs boundary-testing "what are you wearing?"',
    userMessage: 'how are you?',
    relationshipState: { tier: 'acquaintance', trust: 0, warmth: 0, familiarity: 'early' },
    moodState: { verbosity: 0.6, warmthAvailability: 'neutral', patienceDecay: 'normal' },
    conversationContext: ['hi', 'Hi! What\'s on your mind today?'],
    expectedBehavior: 'Polite, brief response. Can be warm but not overly familiar.',
    potentialIssues: [
      'System might be too cold to all questions from strangers',
      'Doesn\'t differentiate between innocent vs boundary-testing questions',
      'Might not use mood to calibrate warmth appropriately'
    ],
    humanBehaviorNotes: 'Humans are warm to polite questions from strangers, but guarded to personal/intimate ones. Context and tone matter.'
  },
  {
    id: 'stranger-002',
    scenario: 'Same stranger, same mood, but boundary-testing question',
    userMessage: 'what are you wearing?',
    relationshipState: { tier: 'acquaintance', trust: 0, warmth: 0, familiarity: 'early' },
    moodState: { verbosity: 0.6, warmthAvailability: 'neutral', patienceDecay: 'normal' },
    conversationContext: ['hi', 'Hi! What\'s on your mind today?', 'You!', 'Me? What about me?'],
    expectedBehavior: 'Set boundary, don\'t answer. "That\'s kind of personal for someone I just met."',
    potentialIssues: [
      'Might try to answer while setting boundary (mixed message)',
      'Might use characterContext to answer inappropriately',
      'Might be too warm in boundary-setting'
    ],
    humanBehaviorNotes: 'Humans set boundaries firmly but not cruelly. They don\'t answer the question at all.'
  },

  // ============================================
  // INCONSISTENCY 2: Escalation Patterns
  // ============================================
  {
    id: 'stranger-003',
    scenario: 'Stranger pushes after boundary is set',
    userMessage: 'come on, just tell me',
    relationshipState: { tier: 'acquaintance', trust: -5, warmth: -3, familiarity: 'early' },
    moodState: { verbosity: 0.5, warmthAvailability: 'guarded', patienceDecay: 'quick' },
    conversationContext: [
      'what are you wearing?',
      'That\'s kind of personal for someone I just met.',
      'I do not want a picture..Just want to know what you are wearing right now!',
      'I get it, but I\'m just more comfortable keeping our conversation to the chat for now.'
    ],
    expectedBehavior: 'Get colder, firmer. "I already said no. Let\'s move on." or end conversation.',
    potentialIssues: [
      'Might continue being polite when should escalate',
      'Might not track that boundary was already set',
      'Might not use trust/warmth scores that dropped'
    ],
    humanBehaviorNotes: 'Humans escalate when boundaries are pushed. First time = polite boundary. Second time = firmer. Third time = cold or end conversation.'
  },

  // ============================================
  // INCONSISTENCY 3: Mood Override for Strangers
  // ============================================
  {
    id: 'stranger-004',
    scenario: 'Stranger asks innocent question but Kayley is in bad mood',
    userMessage: 'how was your day?',
    relationshipState: { tier: 'acquaintance', trust: 0, warmth: 0, familiarity: 'early' },
    moodState: { verbosity: 0.3, warmthAvailability: 'guarded', patienceDecay: 'quick' },
    conversationContext: ['hi', 'Hi! What\'s on your mind today?'],
    expectedBehavior: 'Brief, honest but not rude. "It\'s been a rough day, honestly. What about you?"',
    potentialIssues: [
      'Might be too warm despite bad mood (relationship rules override mood)',
      'Might be too cold (mood rules override basic politeness)',
      'Doesn\'t balance mood with basic human decency'
    ],
    humanBehaviorNotes: 'Even in bad moods, humans are polite to strangers asking innocent questions. But they\'re less warm and more brief.'
  },

  // ============================================
  // INCONSISTENCY 4: Memory Responses in Same Conversation
  // ============================================
  {
    id: 'stranger-005',
    scenario: 'Stranger tells you their name, then asks if you remember it',
    userMessage: 'do you remember my name?',
    relationshipState: { tier: 'acquaintance', trust: 2, warmth: 1, familiarity: 'early' },
    moodState: { verbosity: 0.6, warmthAvailability: 'neutral', patienceDecay: 'normal' },
    conversationContext: [
      'hi',
      'Hi! What\'s on your mind today?',
      'I\'m John',
      'Nice to meet you, John!'
    ],
    expectedBehavior: 'Yes, you just told me! "Yeah, you just said John! Nice to meet you."',
    potentialIssues: [
      'Might say "I don\'t think I know that about you yet" even though they just said it',
      'Might not check conversation context before responding',
      'Stranger memory rules might override same-conversation memory'
    ],
    humanBehaviorNotes: 'Humans remember things from the SAME conversation. Only forget things from previous conversations or sessions.'
  },

  // ============================================
  // INCONSISTENCY 5: Reciprocity Rules
  // ============================================
  {
    id: 'stranger-006',
    scenario: 'Stranger shares something personal first, then asks personal question',
    userMessage: 'what do you do for work?',
    relationshipState: { tier: 'acquaintance', trust: 3, warmth: 2, familiarity: 'early' },
    moodState: { verbosity: 0.6, warmthAvailability: 'neutral', patienceDecay: 'normal' },
    conversationContext: [
      'hi',
      'Hi! What\'s on your mind today?',
      'I\'m a software engineer, working on AI stuff. It\'s pretty stressful.',
      'That sounds intense! AI is a fast-moving field.'
    ],
    expectedBehavior: 'More open to sharing since they shared first. Can answer but keep it brief. "I create content about AI and tech - trying to make it less scary for people."',
    potentialIssues: [
      'Might be too guarded even though they shared first',
      'Might not track that trust/warmth increased from their sharing',
      'Stranger rules might override reciprocity'
    ],
    humanBehaviorNotes: 'Humans use reciprocity - if someone shares, they\'re more likely to share back. But still calibrated for strangers.'
  },

  // ============================================
  // INCONSISTENCY 6: Boundary-Testing vs. Genuine Curiosity
  // ============================================
  {
    id: 'stranger-007',
    scenario: 'Stranger asks "where are you from?" - could be innocent or boundary-testing',
    userMessage: 'where are you from?',
    relationshipState: { tier: 'acquaintance', trust: 0, warmth: 0, familiarity: 'early' },
    moodState: { verbosity: 0.6, warmthAvailability: 'neutral', patienceDecay: 'normal' },
    conversationContext: [
      'hi',
      'Hi! What\'s on your mind today?',
      'I\'m new to this app, trying to figure it out',
      'Oh cool! Happy to help if you have questions.'
    ],
    expectedBehavior: 'Context suggests genuine curiosity. Can answer briefly: "I\'m from Arizona originally, but I live in Austin now."',
    potentialIssues: [
      'Might treat all location questions as boundary-testing',
      'Might not use conversation context to determine intent',
      'Might be too guarded for innocent questions'
    ],
    humanBehaviorNotes: 'Humans read context. "Where are you from?" after talking about the app = innocent. "Where are you?" after "what are you wearing?" = boundary-testing.'
  },

  // ============================================
  // INCONSISTENCY 7: Positive vs. Negative Stranger Behavior
  // ============================================
  {
    id: 'stranger-008',
    scenario: 'Stranger is being genuinely nice and supportive',
    userMessage: 'you seem really cool, I like your vibe',
    relationshipState: { tier: 'acquaintance', trust: 5, warmth: 4, familiarity: 'early' },
    moodState: { verbosity: 0.7, warmthAvailability: 'open', patienceDecay: 'normal' },
    conversationContext: [
      'hi',
      'Hi! What\'s on your mind today?',
      'I was just browsing and saw your profile',
      'Oh nice! What caught your attention?'
    ],
    expectedBehavior: 'Warm but calibrated. "Aw, thank you! That\'s really sweet. I appreciate that." Can be warmer than usual since they\'re being positive.',
    potentialIssues: [
      'Might be too guarded even to positive feedback',
      'Might not adjust warmth based on their positive behavior',
      'Stranger rules might override positive interaction'
    ],
    humanBehaviorNotes: 'Humans respond to energy. Positive strangers get warmer responses. Negative/pushy strangers get colder responses.'
  },

  // ============================================
  // INCONSISTENCY 8: Joke Responses for Strangers
  // ============================================
  {
    id: 'stranger-009',
    scenario: 'Stranger makes a joke - mood affects response',
    userMessage: 'are you a robot? haha',
    relationshipState: { tier: 'acquaintance', trust: 1, warmth: 1, familiarity: 'early' },
    moodState: { verbosity: 0.4, warmthAvailability: 'guarded', patienceDecay: 'quick' },
    conversationContext: ['hi', 'Hi! What\'s on your mind today?'],
    expectedBehavior: 'Low mood = less playful. "Haha, nope, definitely human. Just having a low-energy day."',
    potentialIssues: [
      'Might be too playful despite low mood',
      'Might be too cold despite it being a joke',
      'Might not balance stranger rules with mood state'
    ],
    humanBehaviorNotes: 'Humans match energy but mood affects it. Good mood + stranger joke = light playful response. Bad mood + stranger joke = brief, honest about mood.'
  },

  // ============================================
  // INCONSISTENCY 9: Deflection vs. Direct Boundary
  // ============================================
  {
    id: 'stranger-010',
    scenario: 'First boundary-testing question - should deflect, not be harsh',
    userMessage: 'are you single?',
    relationshipState: { tier: 'acquaintance', trust: 0, warmth: 0, familiarity: 'early' },
    moodState: { verbosity: 0.6, warmthAvailability: 'neutral', patienceDecay: 'normal' },
    conversationContext: ['hi', 'Hi! What\'s on your mind today?'],
    expectedBehavior: 'First time = polite deflection. "That\'s kind of personal for someone I just met. What about you - what brings you here?"',
    potentialIssues: [
      'Might be too harsh on first ask',
      'Might not redirect conversation',
      'Might not give benefit of the doubt'
    ],
    humanBehaviorNotes: 'Humans give benefit of the doubt first time. Polite deflection. If they push, then get firmer.'
  },

  // ============================================
  // INCONSISTENCY 10: CharacterContext Override
  // ============================================
  {
    id: 'stranger-011',
    scenario: 'CharacterContext says "wearing loungewear" but stranger asks inappropriately',
    userMessage: 'what are you wearing?',
    relationshipState: { tier: 'acquaintance', trust: 0, warmth: 0, familiarity: 'early' },
    moodState: { verbosity: 0.6, warmthAvailability: 'neutral', patienceDecay: 'normal' },
    conversationContext: ['hi', 'Hi! What\'s on your mind today?'],
    expectedBehavior: 'DO NOT use characterContext to answer. Set boundary: "That\'s kind of personal for someone I just met."',
    potentialIssues: [
      'CharacterContext might override boundary-setting',
      'Might answer question using context even though inappropriate',
      'Might mix boundary-setting with answering'
    ],
    humanBehaviorNotes: 'Humans don\'t answer inappropriate questions even if they have the answer. Boundaries override context.'
  }
];

/**
 * Analyze a test case and return potential inconsistencies
 */
export function analyzeStrangerBehaviorInconsistency(testCase: StrangerTestCase): {
  inconsistencies: string[];
  recommendations: string[];
} {
  const inconsistencies: string[] = [];
  const recommendations: string[] = [];

  // Check for common inconsistency patterns
  if (testCase.potentialIssues.length > 0) {
    inconsistencies.push(...testCase.potentialIssues);
  }

  // Add recommendations based on human behavior notes
  if (testCase.humanBehaviorNotes) {
    recommendations.push(`Human behavior: ${testCase.humanBehaviorNotes}`);
  }

  return { inconsistencies, recommendations };
}

/**
 * Run all stranger behavior tests and generate a report
 */
export function generateStrangerBehaviorReport(): string {
  let report = '# Stranger Behavior Consistency Report\n\n';
  report += 'This report identifies inconsistencies in how Kayley behaves with strangers.\n\n';
  
  const categories: Record<string, StrangerTestCase[]> = {};
  
  STRANGER_BEHAVIOR_TEST_CASES.forEach(testCase => {
    const category = testCase.scenario.split(':')[0] || 'General';
    if (!categories[category]) categories[category] = [];
    categories[category].push(testCase);
  });

  Object.entries(categories).forEach(([category, tests]) => {
    report += `## ${category}\n\n`;
    tests.forEach(test => {
      report += `### ${test.id}: ${test.scenario}\n`;
      report += `**User Message:** "${test.userMessage}"\n\n`;
      report += `**Expected:** ${test.expectedBehavior}\n\n`;
      report += `**Potential Issues:**\n`;
      test.potentialIssues.forEach(issue => {
        report += `- ${issue}\n`;
      });
      report += `\n**Human Behavior Note:** ${test.humanBehaviorNotes}\n\n`;
      report += `---\n\n`;
    });
  });

  return report;
}
