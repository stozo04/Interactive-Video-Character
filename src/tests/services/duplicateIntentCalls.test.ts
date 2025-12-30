// src/tests/services/duplicateIntentCalls.test.ts
/**
 * Test to verify that detectFullIntentLLMCached is only called once per message
 * when BaseAIService.generateResponse is used.
 * 
 * This prevents duplicate network calls when sending a message.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock environment variables
vi.stubEnv('VITE_GEMINI_API_KEY', 'test-api-key');
vi.stubEnv('VITE_USER_ID', 'test-user-id');

// Mock supabaseClient
vi.mock('../../services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ data: [], error: null })),
      insert: vi.fn(() => ({ data: [], error: null })),
      update: vi.fn(() => ({ data: [], error: null })),
      delete: vi.fn(() => ({ data: [], error: null })),
    })),
  },
}));

// Mock messageAnalyzer to track analyzeUserMessageBackground calls
vi.mock('../../services/messageAnalyzer', () => ({
  default: {
    analyzeUserMessageBackground: vi.fn(),
  },
  analyzeUserMessageBackground: vi.fn(),
}));

// Mock detectFullIntentLLMCached to track call count
vi.mock('../../services/intentService', async () => {
  const actual = await vi.importActual('../../services/intentService');
  return {
    ...actual,
    detectFullIntentLLMCached: vi.fn(),
  };
});

// Mock other dependencies
vi.mock('../../services/promptUtils', () => ({
  buildSystemPrompt: vi.fn(() => Promise.resolve('Test system prompt')),
  buildProactiveThreadPrompt: vi.fn(() => Promise.resolve('Test proactive prompt')),
}));

vi.mock('../../services/elevenLabsService', () => ({
  generateSpeech: vi.fn(() => Promise.resolve(new ArrayBuffer(0))),
}));

vi.mock('../../services/moodKnobs', () => ({
  recordInteractionAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../services/ongoingThreads', () => ({
  getOngoingThreadsAsync: vi.fn(() => Promise.resolve([])),
  selectProactiveThread: vi.fn(() => null),
  markThreadMentionedAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../services/presenceDirector', () => ({
  getTopLoopToSurface: vi.fn(() => null),
  markLoopSurfaced: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../services/characterFactsService', () => ({
  storeCharacterFact: vi.fn(() => Promise.resolve(null)),
  processAndStoreCharacterFacts: vi.fn(() => Promise.resolve(0)),
}));

// Import after mocks
import { BaseAIService } from '../../services/BaseAIService';
import { AIChatSession, UserContent, AIChatOptions } from '../../services/aiService';
import type { FullMessageIntent } from '../../services/intentService';
import type { CharacterProfile } from '../../types';
import { analyzeUserMessageBackground } from '../../services/messageAnalyzer';
import { detectFullIntentLLMCached } from '../../services/intentService';

// Get mocked functions after imports
const mockAnalyzeUserMessageBackground = vi.mocked(analyzeUserMessageBackground);
const mockDetectFullIntentLLMCached = vi.mocked(detectFullIntentLLMCached);

// Create a mock FullMessageIntent for testing
const createMockIntent = (): FullMessageIntent => ({
  genuineMoment: {
    isGenuine: false,
    category: null,
    confidence: 0,
  },
  tone: {
    sentiment: 0.5,
    primaryEmotion: 'neutral',
    intensity: 0.5,
    isSarcastic: false,
  },
  topics: {
    topics: [],
    primaryTopic: null,
    emotionalContext: {},
    entities: [],
  },
  openLoops: {
    hasFollowUp: false,
    loopType: null,
    topic: null,
    suggestedFollowUp: null,
    timeframe: null,
    salience: 0,
  },
  relationshipSignals: {
    isVulnerable: false,
    isSeekingSupport: false,
    isAcknowledgingSupport: false,
    isJoking: false,
    isDeepTalk: false,
    milestone: null,
    milestoneConfidence: 0,
    isHostile: false,
    hostilityReason: null,
    isInappropriate: false,
    inappropriatenessReason: null,
  },
});

// Test implementation of BaseAIService
class TestAIService extends BaseAIService {
  model = 'test-model';

  protected async callProvider(
    systemPrompt: string,
    userMessage: UserContent,
    history: any[],
    session?: AIChatSession
  ): Promise<{ response: any; session: AIChatSession }> {
    return {
      response: {
        text_response: 'Test response',
      },
      session: session || { userId: 'test-user', characterId: 'test-char' },
    };
  }
}

describe('Duplicate Intent Detection Calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mock to return a valid intent
    mockDetectFullIntentLLMCached.mockResolvedValue(createMockIntent());
    mockAnalyzeUserMessageBackground.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call detectFullIntentLLMCached exactly once when generateResponse is called', async () => {
    const service = new TestAIService();
    const mockCharacter: CharacterProfile = {
      id: 'test-char',
      name: 'Test Character',
      systemPrompt: 'Test prompt',
      actions: [],
    };

    const options: AIChatOptions = {
      character: mockCharacter,
      chatHistory: [],
      relationship: undefined,
      upcomingEvents: [],
      characterContext: {},
      tasks: [],
    };

    const input: UserContent = {
      type: 'text',
      text: 'Hello, this is a test message',
    };

    await service.generateResponse(input, options);

    // Verify detectFullIntentLLMCached was called exactly once
    expect(mockDetectFullIntentLLMCached).toHaveBeenCalledTimes(1);
    expect(mockDetectFullIntentLLMCached).toHaveBeenCalledWith(
      'Hello, this is a test message',
      expect.any(Object) // conversationContext
    );
  });

  it('should pass the intent to analyzeUserMessageBackground when provided', async () => {
    const service = new TestAIService();
    const mockCharacter: CharacterProfile = {
      id: 'test-char',
      name: 'Test Character',
      systemPrompt: 'Test prompt',
      actions: [],
    };

    const options: AIChatOptions = {
      character: mockCharacter,
      chatHistory: [],
      relationship: undefined,
      upcomingEvents: [],
      characterContext: {},
      tasks: [],
    };

    const input: UserContent = {
      type: 'text',
      text: 'Hello, this is a test message',
    };

    const mockIntent = createMockIntent();
    mockDetectFullIntentLLMCached.mockResolvedValue(mockIntent);

    await service.generateResponse(input, options);

    // Verify analyzeUserMessageBackground was called with the intent
    expect(mockAnalyzeUserMessageBackground).toHaveBeenCalledTimes(1);
    expect(mockAnalyzeUserMessageBackground).toHaveBeenCalledWith(
      expect.any(String), // userId
      'Hello, this is a test message',
      expect.any(Number), // interactionCount
      expect.any(Object), // conversationContext
      mockIntent // preCalculatedIntent
    );
  });

  it('should not call detectFullIntentLLMCached for very short messages', async () => {
    const service = new TestAIService();
    const mockCharacter: CharacterProfile = {
      id: 'test-char',
      name: 'Test Character',
      systemPrompt: 'Test prompt',
      actions: [],
    };

    const options: AIChatOptions = {
      character: mockCharacter,
      chatHistory: [],
      relationship: undefined,
      upcomingEvents: [],
      characterContext: {},
      tasks: [],
    };

    const input: UserContent = {
      type: 'text',
      text: 'Hi', // Very short message
    };

    await service.generateResponse(input, options);

    // Should not call detectFullIntentLLMCached for messages shorter than 5 chars
    expect(mockDetectFullIntentLLMCached).not.toHaveBeenCalled();
  });
});

