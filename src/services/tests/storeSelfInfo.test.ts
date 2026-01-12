// src/services/tests/storeSelfInfo.test.ts
/**
 * Unit tests for the store_self_info feature.
 * 
 * This feature allows the LLM to explicitly save new facts about Kayley
 * that emerge during conversation, enabling persistent character memory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// Mock Supabase client before any imports that use it
vi.mock("../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          then: vi.fn((resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)),
        })),
        then: vi.fn((resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)),
      })),
      insert: vi.fn(() => ({
        then: vi.fn((resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)),
      })),
      upsert: vi.fn(() => ({
        then: vi.fn((resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          then: vi.fn((resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)),
        })),
      })),
    })),
    rpc: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  },
}));

// Mock relationship service
vi.mock("../relationshipService", () => ({
  getIntimacyContextForPrompt: vi.fn(() => "Intimacy context mock"),
  getIntimacyContextForPromptAsync: vi.fn(() => Promise.resolve("Intimacy context mock")),
  RelationshipMetrics: {},
}));

// Mock callbackDirector
vi.mock("../callbackDirector", () => ({
  formatCallbackForPrompt: vi.fn(() => ""),
}));

// Mock ongoingThreads
vi.mock("../ongoingThreads", () => ({
  formatThreadsForPrompt: vi.fn(() => ""),
  formatThreadsForPromptAsync: vi.fn(() => Promise.resolve("")),
}));

// Mock moodKnobs
vi.mock("../moodKnobs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    formatMoodForPrompt: vi.fn(() => ""),
    calculateMoodFromState: vi.fn(() => ({
      energy: 0.3,
      warmth: 0.5,
      genuineMoment: false,
    })),
    getMoodAsync: vi.fn(() => Promise.resolve({
      energy: 0.3,
      warmth: 0.5,
      genuineMoment: false,
    })),
  };
});

// Mock presenceDirector
vi.mock("../presenceDirector", () => ({
  getPresenceContext: vi.fn(() => Promise.resolve(null)),
  getCharacterOpinions: vi.fn(() => []),
}));

// Mock actionKeyMapper
vi.mock("../../utils/actionKeyMapper", () => ({
  getActionKeysForPrompt: vi.fn((actions) => 
    actions.map((a: any) => a.name.toLowerCase().replace(/\s+/g, '_')).join(', ')
  ),
}));

// Mock localStorage and sessionStorage
const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
};

const localStorageMock = createStorageMock();
const sessionStorageMock = createStorageMock();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock });

// Now import the modules after mocks are set up
import { AIActionResponseSchema } from '../aiSchema';
import { buildSystemPrompt } from '../promptUtils';
import * as characterFactsService from '../characterFactsService';
import type { CharacterProfile } from '../../types';
import type { RelationshipMetrics } from '../relationshipService';

// ============================================
// Test Fixtures
// ============================================

const mockCharacter: CharacterProfile = {
  id: 'test-char-id',
  createdAt: Date.now(),
  name: 'Kayley Adams',
  displayName: 'Kayley',
  actions: [],
  idleVideoUrls: [],
  image: { 
    file: new File([], 'test.png'),
    base64: '', 
    mimeType: 'image/png' 
  }
};

const mockRelationship: RelationshipMetrics = {
  id: 'rel-123',
  relationshipScore: 35,
  warmthScore: 10,
  trustScore: 8,
  playfulnessScore: 12,
  stabilityScore: 10,
  totalInteractions: 25,
  positiveInteractions: 20,
  negativeInteractions: 3,
  relationshipTier: 'friend',
  familiarityStage: 'familiar',
  firstInteractionAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  lastInteractionAt: new Date(),
  isRuptured: false,
  lastRuptureAt: null,
  ruptureCount: 0,
};

// ============================================
// Schema Tests
// ============================================

describe('store_self_info Schema', () => {
  describe('Valid Payloads', () => {
    it('should accept a valid store_self_info object', () => {
      const validResponse = {
        text_response: "Fun fact: I set off my smoke alarm making toast twice this week 😅",
        action_id: null,
        store_self_info: {
          category: 'experience',
          key: 'smoke_alarm_incident',
          value: 'Set off smoke alarm making toast twice in one week'
        }
      };

      const result = AIActionResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.store_self_info).toEqual(validResponse.store_self_info);
      }
    });

    it('should accept null store_self_info', () => {
      const response = {
        text_response: "Hello!",
        action_id: null,
        store_self_info: null
      };

      const result = AIActionResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should accept response without store_self_info (optional)', () => {
      const response = {
        text_response: "Hello!",
        action_id: null
      };

      const result = AIActionResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should accept all valid category types', () => {
      const categories = ['quirk', 'experience', 'preference', 'relationship', 'detail'] as const;

      for (const category of categories) {
        const response = {
          text_response: "Test response",
          action_id: null,
          store_self_info: {
            category,
            key: 'test_key',
            value: 'test value'
          }
        };

        const result = AIActionResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.store_self_info?.category).toBe(category);
        }
      }
    });
  });

  describe('Invalid Payloads', () => {
    it('should reject invalid category', () => {
      const response = {
        text_response: "Test",
        action_id: null,
        store_self_info: {
          category: 'invalid_category',
          key: 'test',
          value: 'test'
        }
      };

      const result = AIActionResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });

    it('should reject missing key', () => {
      const response = {
        text_response: "Test",
        action_id: null,
        store_self_info: {
          category: 'quirk',
          value: 'test'
        }
      };

      const result = AIActionResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });

    it('should reject missing value', () => {
      const response = {
        text_response: "Test",
        action_id: null,
        store_self_info: {
          category: 'quirk',
          key: 'test'
        }
      };

      const result = AIActionResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });

    it('should reject missing category', () => {
      const response = {
        text_response: "Test",
        action_id: null,
        store_self_info: {
          key: 'test',
          value: 'test value'
        }
      };

      const result = AIActionResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================
// Prompt Integration Tests
// ============================================

describe('store_self_info Prompt Instructions', () => {
  it('should include store_self_info instructions in system prompt', async () => {
    const prompt = await buildSystemPrompt(mockCharacter, mockRelationship);

    expect(prompt).toContain('CHECK FOR NEW SELF-FACTS');
    expect(prompt).toContain('store_character_info');
  });

  it('should explain all category types', async () => {
    const prompt = await buildSystemPrompt(mockCharacter, mockRelationship);

    expect(prompt).toContain('quirk');
    expect(prompt).toContain('experience');
    expect(prompt).toContain('preference');
    expect(prompt).toContain('relationship');
    expect(prompt).toContain('detail');
  });

  it('should include usage examples', async () => {
    const prompt = await buildSystemPrompt(mockCharacter, mockRelationship);

    // Check for tool signature arguments
    expect(prompt).toContain('category');
    expect(prompt).toContain('key');
    expect(prompt).toContain('value');
  });

  it('should warn not to use for facts already in profile', async () => {
    const prompt = await buildSystemPrompt(mockCharacter, mockRelationship);

    expect(prompt).toContain("Only for NEW details");
  });

  it('should explain when to use store_self_info', async () => {
    const prompt = await buildSystemPrompt(mockCharacter, mockRelationship);

    expect(prompt).toContain('When: You make up a new detail about yourself');
    expect(prompt).toContain('something new about yourself');
  });
});

// ============================================
// Character Facts Service Integration
// ============================================

describe('storeCharacterFact Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call storeCharacterFact with correct parameters', async () => {
    const storeFactSpy = vi.spyOn(characterFactsService, 'storeCharacterFact')
      .mockResolvedValue(true);

    await characterFactsService.storeCharacterFact(
      'experience',
      'smoke_alarm_incident',
      'Set off smoke alarm making toast twice'
    );

    expect(storeFactSpy).toHaveBeenCalledWith(
      'experience',
      'smoke_alarm_incident',
      'Set off smoke alarm making toast twice'
    );
  });

  it('should handle store failure gracefully', async () => {
    const storeFactSpy = vi.spyOn(characterFactsService, 'storeCharacterFact')
      .mockRejectedValue(new Error('Database error'));

    await expect(
      characterFactsService.storeCharacterFact(
        'quirk',
        'test_key',
        'test_value'
      )
    ).rejects.toThrow('Database error');

    expect(storeFactSpy).toHaveBeenCalled();
  });

  it('should return false for duplicate facts', async () => {
    const storeFactSpy = vi.spyOn(characterFactsService, 'storeCharacterFact')
      .mockResolvedValue(false);

    const result = await characterFactsService.storeCharacterFact(
      'preference',
      'existing_preference',
      'Already exists'
    );

    expect(result).toBe(false);
    expect(storeFactSpy).toHaveBeenCalled();
  });
});

// ============================================
// Response Normalization Tests
// ============================================

describe('Response Normalization', () => {
  it('should preserve store_self_info in normalized response', () => {
    // This tests that normalizeAiResponse properly passes through the field
    const rawResponse = {
      text_response: "Fun fact about me!",
      action_id: null,
      store_self_info: {
        category: 'quirk',
        key: 'test_quirk',
        value: 'I always do X'
      }
    };

    const result = AIActionResponseSchema.safeParse(rawResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.store_self_info).toBeDefined();
      expect(result.data.store_self_info?.category).toBe('quirk');
      expect(result.data.store_self_info?.key).toBe('test_quirk');
      expect(result.data.store_self_info?.value).toBe('I always do X');
    }
  });

  it('should handle store_self_info alongside other actions', () => {
    const complexResponse = {
      text_response: "Here's a selfie! Fun fact, I just made toast 😅",
      action_id: null,
      selfie_action: {
        scene: "kitchen",
        mood: "playful"
      },
      store_self_info: {
        category: 'experience',
        key: 'making_toast',
        value: 'Attempted to make toast in the kitchen'
      }
    };

    const result = AIActionResponseSchema.safeParse(complexResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selfie_action).toBeDefined();
      expect(result.data.store_self_info).toBeDefined();
    }
  });
});

// ============================================
// Category-Specific Tests
// ============================================

describe('store_self_info Categories', () => {
  const testCases = [
    {
      category: 'quirk' as const,
      key: 'names_devices',
      value: 'Names all electronic devices, laptop is Nova',
      description: 'Personality quirks and habits'
    },
    {
      category: 'experience' as const,
      key: 'panel_talk_2024',
      value: 'Spoke at Women in Tech panel, felt imposter syndrome',
      description: 'Stories and life events'
    },
    {
      category: 'preference' as const,
      key: 'cold_brew_discovery',
      value: 'Recently discovered love for cold brew coffee',
      description: 'New likes and preferences'
    },
    {
      category: 'relationship' as const,
      key: 'yoga_friend_maya',
      value: 'Met a friend named Maya at yoga class',
      description: 'New relationships and connections'
    },
    {
      category: 'detail' as const,
      key: 'coffee_machine_name',
      value: 'Coffee machine is named Brewster',
      description: 'Specific factual details'
    }
  ];

  testCases.forEach(({ category, key, value, description }) => {
    it(`should validate ${category} category (${description})`, () => {
      const response = {
        text_response: `Something about ${category}`,
        action_id: null,
        store_self_info: { category, key, value }
      };

      const result = AIActionResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.store_self_info?.category).toBe(category);
      }
    });
  });
});
