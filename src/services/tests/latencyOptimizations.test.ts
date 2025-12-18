
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase client before any imports
vi.mock("../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          then: vi.fn((resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)),
        })),
        then: vi.fn((resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve)),
      })),
      insert: vi.fn(() => ({
        then: vi.fn((resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          then: vi.fn((resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)),
        })),
      })),
    })),
  },
}));

// Mock relationship service
vi.mock("../relationshipService", () => ({
  getIntimacyContextForPrompt: vi.fn(() => "Intimacy context mock"),
  getIntimacyContextForPromptAsync: vi.fn(() => Promise.resolve("Intimacy context mock async")),
  RelationshipMetrics: {},
}));

// Mock callbackDirector to avoid sessionStorage issues
vi.mock("../callbackDirector", () => ({
  formatCallbackForPrompt: vi.fn(() => ""),
}));

// Mock localStorage and sessionStorage before imports
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

import { buildSystemPrompt, getSoulLayerContextAsync } from '../promptUtils';
import * as characterFactsService from '../characterFactsService';
import * as stateService from '../stateService';
import * as presenceDirector from '../presenceDirector';
import * as moodKnobs from '../moodKnobs';
import * as ongoingThreads from '../ongoingThreads';

// Mock characterFactsService
vi.mock('../characterFactsService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as any,
    formatCharacterFactsForPrompt: vi.fn(() => Promise.resolve('Mocked Facts')),
  };
});

// Mock collaborators of getSoulLayerContextAsync
vi.mock('../stateService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as any,
    getFullCharacterContext: vi.fn(() => Promise.resolve({
      mood_state: {},
      emotional_momentum: {},
      ongoing_threads: []
    })),
  };
});

vi.mock('../presenceDirector', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as any,
    getPresenceContext: vi.fn(() => Promise.resolve({
      activeLoops: [],
      topLoop: null,
      opinions: [],
      promptSection: 'Mocked Presence Section'
    })),
  };
});

vi.mock('../moodKnobs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as any,
    getMoodKnobsAsync: vi.fn(() => Promise.resolve({
      patienceDecay: 'slow',
      warmthAvailability: 'open',
      socialBattery: 100,
      flirtThreshold: 0.5,
      verbosity: 0.8,
      initiationRate: 0.5,
      curiosityDepth: 'normal',
    })),
    calculateMoodKnobsFromState: vi.fn(() => ({
      patienceDecay: 'slow',
      warmthAvailability: 'open',
      socialBattery: 100,
      flirtThreshold: 0.5,
      verbosity: 0.8,
      initiationRate: 0.5,
      curiosityDepth: 'normal',
    })),
  };
});

vi.mock('../ongoingThreads', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual as any,
    formatThreadsForPromptAsync: vi.fn(() => Promise.resolve('Mocked Threads')),
    formatThreadsFromData: vi.fn(() => 'Mocked Threads from Data'),
  };
});

describe('Latency Optimizations - Phase 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Optimization 1: Parallelize Intent + Context Fetch (buildSystemPrompt)', () => {
    it('should use pre-fetched context instead of calling fetchers when provided', async () => {
      const prefetchedContext = {
        soulContext: {
          moodKnobs: {
            patienceDecay: 'quick' as const,
            warmthAvailability: 'guarded' as const,
            socialBattery: 50,
            flirtThreshold: 0.3,
            verbosity: 0.4,
            initiationRate: 0.2,
            curiosityDepth: 'shallow' as const,
          },
          threadsPrompt: 'Prefetched Threads',
          callbackPrompt: 'Prefetched Callback',
        },
        characterFacts: 'Prefetched Facts',
      };

      const prompt = await buildSystemPrompt(
        undefined, 
        undefined, 
        [], 
        undefined, 
        [], 
        null, 
        null, 
        null, 
        'test-user', 
        undefined, 
        prefetchedContext
      );

      // Verify fetchers were NOT called
      expect(stateService.getFullCharacterContext).not.toHaveBeenCalled();
      expect(characterFactsService.formatCharacterFactsForPrompt).not.toHaveBeenCalled();

      // Verify the prompt content reflects prefetched data
      expect(prompt).toContain('Prefetched Facts');
      expect(prompt).toContain('Prefetched Threads');
      
      // Patience level is part of Motivated Friction section
      expect(prompt).toContain('quick'); 
    });

    it('should fallback to calling fetchers when pre-fetched context is NOT provided', async () => {
      const prompt = await buildSystemPrompt(
        undefined, 
        undefined, 
        [], 
        undefined, 
        [], 
        null, 
        null, 
        null, 
        'test-user'
      );

      // Verify fetchers WERE called
      expect(stateService.getFullCharacterContext).toHaveBeenCalledWith('test-user');
      expect(characterFactsService.formatCharacterFactsForPrompt).toHaveBeenCalled();

      // Verify the prompt content reflects mocked (fallback) data
      expect(prompt).toContain('Mocked Facts');
      expect(prompt).toContain('Mocked Threads');
    });
  });
});
