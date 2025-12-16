import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CharacterProfile } from '../../types';
import type { RelationshipMetrics } from '../relationshipService';

// Mock localStorage
const localStorageMock = (() => {
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
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Mock Supabase to avoid environment variable issues
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: [], error: null })),
      update: vi.fn(() => Promise.resolve({ data: [], error: null })),
      delete: vi.fn(() => Promise.resolve({ data: [], error: null })),
    })),
  },
}));

// Mock ongoingThreads
vi.mock('../ongoingThreads', () => ({
  formatThreadsForPromptAsync: vi.fn(() => Promise.resolve('ONGOING MENTAL THREADS:\nTest threads')),
}));

// Mock moodKnobs
vi.mock('../moodKnobs', () => ({
  getMoodKnobsAsync: vi.fn(() => Promise.resolve({
    curiosityDepth: 'balanced',
    initiationRate: 0.5,
    verbosity: 0.5,
    warmthAvailability: 'open',
    patienceDecay: 'moderate',
    flirtThreshold: 0.5,
  })),
  formatMoodKnobsForPrompt: vi.fn(() => 'MOOD KNOBS:\nTest mood'),
  calculateMoodKnobsFromState: vi.fn(() => ({
    curiosityDepth: 'balanced',
    initiationRate: 0.5,
    verbosity: 0.5,
    warmthAvailability: 'open',
    patienceDecay: 'moderate',
    flirtThreshold: 0.5,
  })),
}));

// Mock other dependencies
vi.mock('../callbackDirector', () => ({
  formatCallbackForPrompt: vi.fn(() => 'CALLBACK:\nTest callback'),
}));

vi.mock('../presenceDirector', () => ({
  getPresenceContext: vi.fn(() => Promise.resolve(undefined)),
  getCharacterOpinions: vi.fn(() => []),
}));

vi.mock('../relationshipService', () => ({
  getIntimacyContextForPromptAsync: vi.fn(() => Promise.resolve('')),
}));

vi.mock('../stateService', () => ({
  getFullCharacterContext: vi.fn(() => Promise.resolve({
    mood_state: null,
    emotional_momentum: null,
    ongoing_threads: [],
  })),
}));

// Import after mocks
import { buildSystemPrompt } from '../promptUtils';

describe('buildSystemPrompt with Proactive Threads', () => {
  const mockCharacter: CharacterProfile = {
    id: 'test-char',
    name: 'Test Character',
    displayName: 'Test',
    description: 'Test character',
    videoUrl: '',
    actions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('should include bridging instructions in system prompt', async () => {
    const prompt = await buildSystemPrompt(
      mockCharacter,
      null,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'test-user-id',
      undefined
    );

    // Verify bridging instructions are present
    expect(prompt).toContain('PROACTIVE CONVERSATION STARTERS');
    expect(prompt).toMatch(/bridge|bridging/i);
    expect(prompt).toContain('question');
    expect(prompt).toContain('dead end');
    expect(prompt).toContain('GOOD examples');
    expect(prompt).toContain('BAD examples');
  });

  it('should emphasize that bridging is mandatory', async () => {
    const prompt = await buildSystemPrompt(
      mockCharacter,
      null,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'test-user-id',
      undefined
    );

    expect(prompt).toMatch(/MUST|CRITICAL|ALWAYS/i);
    expect(prompt).toMatch(/bridge|bridging/i);
    expect(prompt).toContain('NOT optional');
  });
});

