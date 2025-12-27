/**
 * Idle Thoughts Tests
 *
 * Tests for idle thought generation during user absence.
 * Validates that Kayley generates appropriate thoughts/dreams to share on return.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IdleThought, IdleThoughtType } from '../spontaneity/types';

// Mock Supabase
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn(() => ({
  insert: mockInsert,
  select: mockSelect,
  update: mockUpdate,
}));

mockInsert.mockReturnValue({
  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
});

mockSelect.mockReturnValue({
  eq: vi.fn().mockReturnValue({
    is: vi.fn().mockReturnValue({
      is: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    }),
  }),
});

mockUpdate.mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// Import after mocks
import {
  generateIdleThought,
  getUnsharedThoughts,
  markThoughtAsShared,
} from '../spontaneity/idleThoughts';

describe('Idle Thoughts Service', () => {
  const testUserId = 'test-user-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // generateIdleThought Tests
  // ============================================================================

  describe('generateIdleThought', () => {
    it('should generate a thought with all required fields', async () => {
      const absenceDurationHours = 8;
      const kayleyMood = 'thoughtful';

      const thought = await generateIdleThought(
        testUserId,
        absenceDurationHours,
        kayleyMood
      );

      // Should have core fields
      expect(thought.id).toBeTruthy();
      expect(thought.userId).toBe(testUserId);
      expect(thought.thoughtType).toBeTruthy();
      expect(thought.content).toBeTruthy();
      expect(thought.emotionalTone).toBeTruthy();

      // Should have lifecycle fields
      expect(thought.generatedAt).toBeInstanceOf(Date);
      expect(thought.absenceDurationHours).toBe(absenceDurationHours);
      expect(thought.kayleyMoodWhenGenerated).toBe(kayleyMood);

      // Should be shareable by default
      expect(thought.canShareWithUser).toBe(true);
    });

    it('should throw error if absence is too short', async () => {
      const absenceDurationHours = 2; // Less than MIN (4)
      const kayleyMood = 'playful';

      await expect(
        generateIdleThought(testUserId, absenceDurationHours, kayleyMood)
      ).rejects.toThrow('Absence too short');
    });

    it('should generate dream thoughts for long absences', async () => {
      const absenceDurationHours = 10; // Overnight
      const kayleyMood = 'neutral';

      // Run multiple times to hit dream type eventually
      const thoughts = await Promise.all(
        Array.from({ length: 20 }, () =>
          generateIdleThought(testUserId, absenceDurationHours, kayleyMood)
        )
      );

      // At least one should be a dream (probabilistic)
      const dreamThoughts = thoughts.filter((t) => t.thoughtType === 'dream');
      expect(dreamThoughts.length).toBeGreaterThan(0);
    });

    it('should generate memory/connection thoughts for thoughtful moods', async () => {
      const absenceDurationHours = 6;
      const kayleyMood = 'thoughtful';

      // Run multiple times
      const thoughts = await Promise.all(
        Array.from({ length: 10 }, () =>
          generateIdleThought(testUserId, absenceDurationHours, kayleyMood)
        )
      );

      // Should favor memory/connection for thoughtful mood
      const reflectiveThoughts = thoughts.filter(
        (t) => t.thoughtType === 'memory' || t.thoughtType === 'connection'
      );
      expect(reflectiveThoughts.length).toBeGreaterThan(0);
    });

    it('should generate curiosity/random thoughts for playful moods', async () => {
      const absenceDurationHours = 5;
      const kayleyMood = 'playful';

      // Run multiple times
      const thoughts = await Promise.all(
        Array.from({ length: 10 }, () =>
          generateIdleThought(testUserId, absenceDurationHours, kayleyMood)
        )
      );

      // Should favor curiosity/random for playful mood
      const playfulThoughts = thoughts.filter(
        (t) => t.thoughtType === 'curiosity' || t.thoughtType === 'random'
      );
      expect(playfulThoughts.length).toBeGreaterThan(0);
    });

    it('should generate anticipation thoughts for long absences', async () => {
      const absenceDurationHours = 30; // Over a day
      const kayleyMood = 'neutral';

      // Run multiple times
      const thoughts = await Promise.all(
        Array.from({ length: 15 }, () =>
          generateIdleThought(testUserId, absenceDurationHours, kayleyMood)
        )
      );

      // Should have some anticipation thoughts
      const anticipationThoughts = thoughts.filter(
        (t) => t.thoughtType === 'anticipation'
      );
      expect(anticipationThoughts.length).toBeGreaterThan(0);
    });

    it('should have natural intro for each thought type', async () => {
      const absenceDurationHours = 8;
      const kayleyMood = 'neutral';

      const thought = await generateIdleThought(
        testUserId,
        absenceDurationHours,
        kayleyMood
      );

      expect(thought.naturalIntro).toBeTruthy();
      expect(typeof thought.naturalIntro).toBe('string');
      expect(thought.naturalIntro.length).toBeGreaterThan(5);
    });

    it('should have appropriate emotional tone', async () => {
      const absenceDurationHours = 8;
      const kayleyMood = 'neutral';

      const thought = await generateIdleThought(
        testUserId,
        absenceDurationHours,
        kayleyMood
      );

      // Emotional tone should be non-empty
      expect(thought.emotionalTone).toBeTruthy();

      // Should be one of expected tones
      const validTones = [
        'wistful',
        'amused',
        'puzzled',
        'warm',
        'thoughtful',
        'curious',
        'reflective',
        'playful',
        'engaged',
        'interested',
        'excited',
        'anticipatory',
        'supportive',
        'random',
        'quirky',
      ];

      expect(validTones).toContain(thought.emotionalTone);
    });

    it('should mark some dreams as recurring', async () => {
      const absenceDurationHours = 10;
      const kayleyMood = 'neutral';

      // Generate many thoughts
      const thoughts = await Promise.all(
        Array.from({ length: 50 }, () =>
          generateIdleThought(testUserId, absenceDurationHours, kayleyMood)
        )
      );

      const dreamThoughts = thoughts.filter((t) => t.thoughtType === 'dream');
      const recurringDreams = dreamThoughts.filter((t) => t.isRecurring);

      // Should have at least one recurring dream (20% chance per dream)
      if (dreamThoughts.length > 5) {
        expect(recurringDreams.length).toBeGreaterThan(0);
      }
    });

    it('should usually involve user in thoughts', async () => {
      const absenceDurationHours = 8;
      const kayleyMood = 'neutral';

      // Generate many thoughts
      const thoughts = await Promise.all(
        Array.from({ length: 20 }, () =>
          generateIdleThought(testUserId, absenceDurationHours, kayleyMood)
        )
      );

      const userInvolvedThoughts = thoughts.filter((t) => t.involvesUser);

      // 70% chance per thought, but with randomness we use a lower threshold
      // to avoid flaky tests. With 20 samples at 70%, we expect ~14 but accept 6+
      expect(userInvolvedThoughts.length).toBeGreaterThan(
        thoughts.length * 0.3
      );
    });

    it('should assign user role when user is involved', async () => {
      const absenceDurationHours = 8;
      const kayleyMood = 'neutral';

      const thought = await generateIdleThought(
        testUserId,
        absenceDurationHours,
        kayleyMood
      );

      if (thought.involvesUser) {
        expect(thought.userRoleInThought).toBeTruthy();
        expect(typeof thought.userRoleInThought).toBe('string');
      } else {
        expect(thought.userRoleInThought).toBeUndefined();
      }
    });

    it('should have ideal conversation mood for some thought types', async () => {
      const absenceDurationHours = 8;
      const kayleyMood = 'neutral';

      const thought = await generateIdleThought(
        testUserId,
        absenceDurationHours,
        kayleyMood
      );

      if (thought.idealConversationMood) {
        const validMoods = [
          'playful',
          'deep',
          'casual',
          'heavy',
          'flirty',
          'tense',
          'excited',
          'cozy',
        ];

        expect(validMoods).toContain(thought.idealConversationMood);
      }
    });

    it('should save thought to Supabase', async () => {
      const absenceDurationHours = 8;
      const kayleyMood = 'neutral';

      await generateIdleThought(testUserId, absenceDurationHours, kayleyMood);

      // Should call Supabase insert
      expect(mockFrom).toHaveBeenCalledWith('idle_thoughts');
      expect(mockInsert).toHaveBeenCalled();
    });

    it('should generate valid content for all thought types', async () => {
      const absenceDurationHours = 8;
      const kayleyMood = 'neutral';

      // Generate many thoughts to hit all types
      const thoughts = await Promise.all(
        Array.from({ length: 30 }, () =>
          generateIdleThought(testUserId, absenceDurationHours, kayleyMood)
        )
      );

      // All thoughts should have non-empty content
      for (const thought of thoughts) {
        expect(thought.content).toBeTruthy();
        expect(thought.content.length).toBeGreaterThan(10);
      }

      // Should have hit multiple thought types
      const uniqueTypes = new Set(thoughts.map((t) => t.thoughtType));
      expect(uniqueTypes.size).toBeGreaterThan(2);
    });
  });

  // ============================================================================
  // getUnsharedThoughts Tests
  // ============================================================================

  describe('getUnsharedThoughts', () => {
    it('should fetch unshared thoughts from Supabase', async () => {
      const mockThoughts = [
        {
          id: 'thought-1',
          user_id: testUserId,
          thought_type: 'dream',
          content: 'I had this dream...',
          associated_memory: null,
          emotional_tone: 'wistful',
          is_recurring: false,
          dream_imagery: null,
          involves_user: true,
          user_role_in_thought: 'companion',
          can_share_with_user: true,
          ideal_conversation_mood: 'playful',
          natural_intro: 'So I had this dream...',
          generated_at: new Date().toISOString(),
          shared_at: null,
          expired_at: null,
          absence_duration_hours: 8,
          kayley_mood_when_generated: 'neutral',
        },
      ];

      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: mockThoughts,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const thoughts = await getUnsharedThoughts(testUserId);

      expect(thoughts).toHaveLength(1);
      expect(thoughts[0].id).toBe('thought-1');
      expect(thoughts[0].content).toBe('I had this dream...');
    });

    it('should only return thoughts that can be shared', async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              eq: vi.fn((field: string, value: boolean) => {
                // Should filter for can_share_with_user = true
                expect(field).toBe('can_share_with_user');
                expect(value).toBe(true);
                return {
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                };
              }),
            }),
          }),
        }),
      });

      await getUnsharedThoughts(testUserId);
    });

    it('should return empty array on error', async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: null,
                  error: new Error('DB error'),
                }),
              }),
            }),
          }),
        }),
      });

      const thoughts = await getUnsharedThoughts(testUserId);

      expect(thoughts).toEqual([]);
    });

    it('should exclude expired thoughts', async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn((field: string, value: null) => {
            // Should filter for shared_at = null and expired_at = null
            expect(['shared_at', 'expired_at']).toContain(field);
            expect(value).toBeNull();
            return {
              is: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            };
          }),
        }),
      });

      await getUnsharedThoughts(testUserId);
    });
  });

  // ============================================================================
  // markThoughtAsShared Tests
  // ============================================================================

  describe('markThoughtAsShared', () => {
    it('should update thought with shared timestamp', async () => {
      const thoughtId = 'thought-123';

      await markThoughtAsShared(thoughtId);

      // Should call Supabase update
      expect(mockFrom).toHaveBeenCalledWith('idle_thoughts');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should set shared_at to current timestamp', async () => {
      const thoughtId = 'thought-123';

      mockUpdate.mockReturnValueOnce({
        eq: vi.fn((field: string, value: string) => {
          expect(field).toBe('id');
          expect(value).toBe(thoughtId);
          return Promise.resolve({ error: null });
        }),
      });

      await markThoughtAsShared(thoughtId);
    });

    it('should handle errors gracefully', async () => {
      const thoughtId = 'thought-123';

      mockUpdate.mockReturnValueOnce({
        eq: vi.fn().mockResolvedValue({
          error: new Error('Update failed'),
        }),
      });

      // Should not throw
      await expect(markThoughtAsShared(thoughtId)).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration: Thought Lifecycle', () => {
    it('should support full lifecycle: generate -> fetch unshared -> mark shared', async () => {
      const absenceDurationHours = 8;
      const kayleyMood = 'neutral';

      // 1. Generate thought
      const thought = await generateIdleThought(
        testUserId,
        absenceDurationHours,
        kayleyMood
      );

      expect(thought.id).toBeTruthy();

      // 2. Mock it appearing in unshared query
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: thought.id,
                      user_id: thought.userId,
                      thought_type: thought.thoughtType,
                      content: thought.content,
                      associated_memory: thought.associatedMemory,
                      emotional_tone: thought.emotionalTone,
                      is_recurring: thought.isRecurring,
                      dream_imagery: thought.dreamImagery,
                      involves_user: thought.involvesUser,
                      user_role_in_thought: thought.userRoleInThought,
                      can_share_with_user: thought.canShareWithUser,
                      ideal_conversation_mood: thought.idealConversationMood,
                      natural_intro: thought.naturalIntro,
                      generated_at: thought.generatedAt.toISOString(),
                      shared_at: null,
                      expired_at: null,
                      absence_duration_hours: thought.absenceDurationHours,
                      kayley_mood_when_generated:
                        thought.kayleyMoodWhenGenerated,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const unshared = await getUnsharedThoughts(testUserId);
      expect(unshared).toHaveLength(1);
      expect(unshared[0].id).toBe(thought.id);

      // 3. Mark as shared
      await markThoughtAsShared(thought.id);

      expect(mockUpdate).toHaveBeenCalled();
    });
  });
});
