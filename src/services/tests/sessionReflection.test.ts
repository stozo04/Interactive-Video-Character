/**
 * Session Reflection Tests
 *
 * Tests for post-session reflection generation and retrieval.
 * Validates that Kayley creates thoughtful reflections after conversations end.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type {
  SessionReflection,
  MemorableMoment,
  MoodProgression,
} from '../spontaneity/types';

// Mock Supabase
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn(() => ({
  insert: mockInsert,
  select: mockSelect,
  delete: mockDelete,
}));

mockInsert.mockReturnValue({
  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
});

mockSelect.mockReturnValue({
  eq: vi.fn().mockReturnValue({
    order: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  }),
});

mockDelete.mockReturnValue({
  in: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// Import after mocks
import {
  createSessionReflection,
  getRecentReflections,
  getUnresolvedThreadsFromReflections,
  clearReflectionsCache,
} from '../spontaneity/sessionReflection';

describe('Session Reflection Service', () => {
  const testUserId = 'test-user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    clearReflectionsCache();
  });

  afterEach(() => {
    clearReflectionsCache();
  });

  // ============================================================================
  // createSessionReflection Tests
  // ============================================================================

  describe('createSessionReflection', () => {
    it('should create a session reflection with all required fields', async () => {
      const sessionData = {
        sessionStartAt: new Date('2025-01-01T10:00:00Z'),
        sessionEndAt: new Date('2025-01-01T11:00:00Z'),
        messageCount: 15,
        memorableMoments: [
          {
            type: 'genuine' as const,
            content: 'User opened up about their job stress',
            emotionalWeight: 0.8,
          },
        ],
        moodProgression: [
          {
            timestamp: new Date('2025-01-01T10:00:00Z'),
            mood: 'casual' as const,
          },
          {
            timestamp: new Date('2025-01-01T10:30:00Z'),
            mood: 'deep' as const,
            trigger: 'User vulnerability',
          },
        ],
      };

      const reflection = await createSessionReflection(testUserId, sessionData);

      // Should have ID and userId
      expect(reflection.id).toBeTruthy();
      expect(reflection.userId).toBe(testUserId);

      // Should capture session metadata
      expect(reflection.sessionStartAt).toEqual(sessionData.sessionStartAt);
      expect(reflection.sessionEndAt).toEqual(sessionData.sessionEndAt);
      expect(reflection.messageCount).toBe(15);

      // Should have emotional arc synthesized
      expect(reflection.emotionalArc).toBeTruthy();
      expect(typeof reflection.emotionalArc).toBe('string');

      // Should have dominant mood
      expect(reflection.dominantMood).toBeTruthy();

      // Should have mood progression
      expect(reflection.moodProgression).toHaveLength(2);

      // Should have memorable moments
      expect(reflection.memorableMoments).toHaveLength(1);

      // Should have relationship deltas
      expect(typeof reflection.intimacyDelta).toBe('number');
      expect(typeof reflection.trustDelta).toBe('number');
      expect(typeof reflection.warmthDelta).toBe('number');

      // Should have insights
      expect(reflection.conversationInsights).toBeTruthy();

      // Should have created timestamp
      expect(reflection.createdAt).toBeInstanceOf(Date);
    });

    it('should calculate emotional arc correctly for progressive mood shifts', async () => {
      const sessionData = {
        sessionStartAt: new Date(),
        sessionEndAt: new Date(),
        messageCount: 10,
        memorableMoments: [],
        moodProgression: [
          { timestamp: new Date(), mood: 'tense' as const },
          { timestamp: new Date(), mood: 'casual' as const },
          { timestamp: new Date(), mood: 'playful' as const },
        ],
      };

      const reflection = await createSessionReflection(testUserId, sessionData);

      expect(reflection.emotionalArc).toContain('Started tense');
      expect(reflection.emotionalArc).toContain('ended playful');
    });

    it('should calculate dominant mood from progression', async () => {
      const sessionData = {
        sessionStartAt: new Date(),
        sessionEndAt: new Date(),
        messageCount: 10,
        memorableMoments: [],
        moodProgression: [
          { timestamp: new Date(), mood: 'playful' as const },
          { timestamp: new Date(), mood: 'playful' as const },
          { timestamp: new Date(), mood: 'casual' as const },
        ],
      };

      const reflection = await createSessionReflection(testUserId, sessionData);

      // 'playful' appears most (2x)
      expect(reflection.dominantMood).toBe('playful');
    });

    it('should extract unresolved threads from memorable moments', async () => {
      const sessionData = {
        sessionStartAt: new Date(),
        sessionEndAt: new Date(),
        messageCount: 8,
        memorableMoments: [
          {
            type: 'genuine' as const,
            content: 'User mentioned wanting to talk about their career later',
            emotionalWeight: 0.7,
          },
          {
            type: 'tense' as const,
            content: 'User said "but we can discuss that another time"',
            emotionalWeight: 0.5,
          },
        ],
        moodProgression: [],
      };

      const reflection = await createSessionReflection(testUserId, sessionData);

      // Should extract threads from moments with "later", "but", etc.
      expect(reflection.unresolvedThreads.length).toBeGreaterThan(0);
    });

    it('should calculate positive intimacy delta for vulnerable moments', async () => {
      const sessionData = {
        sessionStartAt: new Date(),
        sessionEndAt: new Date(),
        messageCount: 10,
        memorableMoments: [
          {
            type: 'vulnerable' as const,
            content: 'User shared deep personal story',
            emotionalWeight: 0.9,
          },
          {
            type: 'breakthrough' as const,
            content: 'Major realization moment',
            emotionalWeight: 0.8,
          },
        ],
        moodProgression: [],
      };

      const reflection = await createSessionReflection(testUserId, sessionData);

      // Should have positive intimacy and trust deltas
      expect(reflection.intimacyDelta).toBeGreaterThan(0);
      expect(reflection.trustDelta).toBeGreaterThan(0);
    });

    it('should calculate negative deltas for tense moments', async () => {
      const sessionData = {
        sessionStartAt: new Date(),
        sessionEndAt: new Date(),
        messageCount: 10,
        memorableMoments: [
          {
            type: 'tense' as const,
            content: 'Disagreement about topic',
            emotionalWeight: 0.8,
          },
        ],
        moodProgression: [],
      };

      const reflection = await createSessionReflection(testUserId, sessionData);

      // Should have negative deltas
      expect(reflection.intimacyDelta).toBeLessThanOrEqual(0);
      expect(reflection.warmthDelta).toBeLessThan(0);
    });

    it('should generate conversation insights based on moments', async () => {
      const sessionData = {
        sessionStartAt: new Date(),
        sessionEndAt: new Date(),
        messageCount: 25,
        memorableMoments: [
          {
            type: 'vulnerable' as const,
            content: 'User opened up',
            emotionalWeight: 0.8,
          },
          {
            type: 'funny' as const,
            content: 'Shared joke',
            emotionalWeight: 0.6,
          },
        ],
        moodProgression: [],
      };

      const reflection = await createSessionReflection(testUserId, sessionData);

      // Should mention long conversation
      expect(reflection.conversationInsights).toContain('Long');

      // Should mention vulnerability or laughs
      expect(
        reflection.conversationInsights.includes('opened up') ||
          reflection.conversationInsights.includes('laughs')
      ).toBe(true);
    });

    it('should generate suggested follow-ups from unresolved threads', async () => {
      const sessionData = {
        sessionStartAt: new Date(),
        sessionEndAt: new Date(),
        messageCount: 10,
        memorableMoments: [
          {
            type: 'genuine' as const,
            content: 'User mentioned wanting to discuss career change later',
            emotionalWeight: 0.7,
          },
        ],
        moodProgression: [],
      };

      const reflection = await createSessionReflection(testUserId, sessionData);

      // Should have at least one follow-up suggestion
      expect(reflection.suggestedFollowups.length).toBeGreaterThan(0);
    });

    it('should save reflection to Supabase', async () => {
      const sessionData = {
        sessionStartAt: new Date(),
        sessionEndAt: new Date(),
        messageCount: 5,
        memorableMoments: [],
        moodProgression: [],
      };

      await createSessionReflection(testUserId, sessionData);

      // Should call Supabase insert
      expect(mockFrom).toHaveBeenCalledWith('session_reflections');
      expect(mockInsert).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // getRecentReflections Tests
  // ============================================================================

  describe('getRecentReflections', () => {
    it('should fetch recent reflections from Supabase', async () => {
      const mockReflections = [
        {
          id: 'refl-1',
          user_id: testUserId,
          session_start_at: new Date().toISOString(),
          session_end_at: new Date().toISOString(),
          message_count: 10,
          emotional_arc: 'Started casual, ended playful',
          dominant_mood: 'playful',
          mood_progression: [],
          memorable_moments: [],
          unresolved_threads: [],
          intimacy_delta: 0.1,
          trust_delta: 0.05,
          warmth_delta: 0.08,
          new_user_facts: [],
          conversation_insights: 'Good vibes',
          suggested_followups: [],
          created_at: new Date().toISOString(),
        },
      ];

      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: mockReflections,
              error: null,
            }),
          }),
        }),
      });

      const reflections = await getRecentReflections(testUserId, 5);

      expect(reflections).toHaveLength(1);
      expect(reflections[0].id).toBe('refl-1');
      expect(reflections[0].userId).toBe(testUserId);
    });

    it('should respect limit parameter', async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn((lim: number) => {
              expect(lim).toBe(3);
              return Promise.resolve({ data: [], error: null });
            }),
          }),
        }),
      });

      await getRecentReflections(testUserId, 3);
    });

    it('should cache results to avoid repeat DB calls', async () => {
      const mockReflections = [
        {
          id: 'refl-1',
          user_id: testUserId,
          session_start_at: new Date().toISOString(),
          session_end_at: new Date().toISOString(),
          message_count: 10,
          emotional_arc: 'Casual',
          dominant_mood: 'casual',
          mood_progression: [],
          memorable_moments: [],
          unresolved_threads: [],
          intimacy_delta: 0,
          trust_delta: 0,
          warmth_delta: 0,
          new_user_facts: [],
          conversation_insights: 'Test',
          suggested_followups: [],
          created_at: new Date().toISOString(),
        },
      ];

      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: mockReflections,
              error: null,
            }),
          }),
        }),
      });

      // First call
      await getRecentReflections(testUserId, 5);
      const firstCallCount = mockSelect.mock.calls.length;

      // Second call - should use cache
      await getRecentReflections(testUserId, 5);
      const secondCallCount = mockSelect.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount); // No new DB call
    });

    it('should return empty array on error', async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: null,
              error: new Error('DB error'),
            }),
          }),
        }),
      });

      const reflections = await getRecentReflections(testUserId);

      expect(reflections).toEqual([]);
    });
  });

  // ============================================================================
  // getUnresolvedThreadsFromReflections Tests
  // ============================================================================

  describe('getUnresolvedThreadsFromReflections', () => {
    it('should collect unresolved threads from recent reflections', async () => {
      const mockReflections = [
        {
          id: 'refl-1',
          user_id: testUserId,
          session_start_at: new Date().toISOString(),
          session_end_at: new Date().toISOString(),
          message_count: 10,
          emotional_arc: 'Test',
          dominant_mood: 'casual',
          mood_progression: [],
          memorable_moments: [],
          unresolved_threads: ['Career change discussion', 'Moving plans'],
          intimacy_delta: 0,
          trust_delta: 0,
          warmth_delta: 0,
          new_user_facts: [],
          conversation_insights: 'Test',
          suggested_followups: [],
          created_at: new Date().toISOString(),
        },
        {
          id: 'refl-2',
          user_id: testUserId,
          session_start_at: new Date().toISOString(),
          session_end_at: new Date().toISOString(),
          message_count: 8,
          emotional_arc: 'Test',
          dominant_mood: 'casual',
          mood_progression: [],
          memorable_moments: [],
          unresolved_threads: ['Family visit'],
          intimacy_delta: 0,
          trust_delta: 0,
          warmth_delta: 0,
          new_user_facts: [],
          conversation_insights: 'Test',
          suggested_followups: [],
          created_at: new Date().toISOString(),
        },
      ];

      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: mockReflections,
              error: null,
            }),
          }),
        }),
      });

      const threads = await getUnresolvedThreadsFromReflections(testUserId);

      expect(threads).toHaveLength(3);
      expect(threads).toContain('Career change discussion');
      expect(threads).toContain('Moving plans');
      expect(threads).toContain('Family visit');
    });

    it('should deduplicate threads', async () => {
      const mockReflections = [
        {
          id: 'refl-1',
          user_id: testUserId,
          session_start_at: new Date().toISOString(),
          session_end_at: new Date().toISOString(),
          message_count: 10,
          emotional_arc: 'Test',
          dominant_mood: 'casual',
          mood_progression: [],
          memorable_moments: [],
          unresolved_threads: ['Job interview', 'Job interview'],
          intimacy_delta: 0,
          trust_delta: 0,
          warmth_delta: 0,
          new_user_facts: [],
          conversation_insights: 'Test',
          suggested_followups: [],
          created_at: new Date().toISOString(),
        },
      ];

      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: mockReflections,
              error: null,
            }),
          }),
        }),
      });

      const threads = await getUnresolvedThreadsFromReflections(testUserId);

      // Should only have 1 "Job interview" despite duplicates
      expect(threads).toHaveLength(1);
      expect(threads[0]).toBe('Job interview');
    });
  });
});
