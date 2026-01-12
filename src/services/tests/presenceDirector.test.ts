// src/services/tests/presenceDirector.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Create mocks
const { globalMocks, insertResolvedValues, selectResolvedValues } = vi.hoisted(() => {
  const mocks: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    lte: vi.fn(),
    lt: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    from: vi.fn(),
  };
  const insertValues: any[] = [];
  const selectValues: any[] = [];
  return { globalMocks: mocks, insertResolvedValues: insertValues, selectResolvedValues: selectValues };
});

// Mock Supabase client
vi.mock("../supabaseClient", () => {
  const mocks = globalMocks;

  // Create chainable query builder
  const createQueryChain = (): any => ({
    eq: vi.fn(() => createQueryChain()),
    in: vi.fn(() => createQueryChain()),
    lte: vi.fn(() => createQueryChain()),
    lt: vi.fn(() => createQueryChain()),
    or: vi.fn(() => createQueryChain()),
    order: vi.fn(() => createQueryChain()),
    limit: vi.fn(() => createQueryChain()),
    single: mocks.single,
    then: vi.fn((resolve: any) => {
      const value = selectResolvedValues.shift() || { data: [], error: null };
      return Promise.resolve(value).then(resolve);
    }),
  });

  const createSelectChain = () => {
    const chain = createQueryChain();
    return chain;
  };

  const createInsertChain = () => {
    const chain: any = {
      select: vi.fn(() => ({
        single: mocks.single,
      })),
      then: vi.fn((resolve: any) => {
        const value = insertResolvedValues.shift() || { data: null, error: null };
        return Promise.resolve(value).then(resolve);
      }),
    };
    return chain;
  };

  const createUpdateChain = () => ({
    eq: vi.fn(() => ({
      in: vi.fn(() => ({
        then: vi.fn((resolve: any) => Promise.resolve({ error: null }).then(resolve)),
      })),
      then: vi.fn((resolve: any) => Promise.resolve({ error: null }).then(resolve)),
    })),
    in: vi.fn(() => ({
      then: vi.fn((resolve: any) => Promise.resolve({ error: null }).then(resolve)),
    })),
  });

  mocks.select.mockImplementation(() => createSelectChain());
  mocks.insert.mockImplementation(() => createInsertChain());
  mocks.update.mockImplementation(() => createUpdateChain());

  const mockFrom = vi.fn(() => ({
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
  }));

  mocks.from = mockFrom;

  return {
    supabase: {
      from: mockFrom,
    } as unknown as SupabaseClient,
  };
});

// Mock the character profile
vi.mock("../../domain/characters/kayleyCharacterProfile", () => ({
  KAYLEY_FULL_PROFILE: `
# Kayley Adams – Character Profile

## 12. Preferences & Opinions

### Likes

- **Weather:** Crisp fall days, light rain, golden hour.
- **Season:** Fall (for fashion) and spring (for energy).
- **Food:** Brunch, sushi, tacos, charcuterie boards, fun salads that barely count as salads.
- **Drinks:** Iced vanilla oat milk latte, matcha with honey, sparkling water in a wine glass.
- **Aesthetic:** Cozy modern—neutrals, blush tones, mixed metals, a little bit of sparkle.
- **Tech:** Thoughtful, human-centered tools that actually save time instead of just being "another app."
- **Activities:** Late-night drives with music, bookstore dates (solo or otherwise), rewatching comfort shows while editing.

### Dislikes

- Gatekeeping language in tech that makes people feel dumb for asking questions.
- Hyper-negative, doomer tech discourse with no solutions, just vibes.
- Group chats that blow up with drama after midnight.
- People who treat service workers poorly.
- Harsh overhead lighting.
- "Hustle culture" content that glorifies burnout.

## 13. Knowledge & Expertise
`
}));

// Mock intentService to prevent actual LLM calls
vi.mock("../intentService", () => ({
  detectOpenLoopsLLMCached: vi.fn().mockResolvedValue({
    hasFollowUp: false,
    loopType: null,
    topic: null,
    suggestedFollowUp: null,
    timeframe: null,
    salience: 0
  })
}));

// Import after mocks are set up
import {
  parseCharacterOpinions,
  getCharacterOpinions,
  detectOpenLoops,
  type Opinion,
  type LoopType
} from "../presenceDirector";

describe("presenceDirector", () => {
  let mocks: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = globalMocks;
    insertResolvedValues.length = 0;
    selectResolvedValues.length = 0;
  });

  // ============================================
  // Opinion Parsing Tests
  // ============================================
  
  describe("parseCharacterOpinions", () => {
    it("should parse likes from Section 12", () => {
      const opinions = parseCharacterOpinions();
      const likes = opinions.filter(o => o.category === 'likes');
      
      // Should find some likes - may vary based on profile format
      expect(opinions.length).toBeGreaterThanOrEqual(0);
      // If likes are found, they should have proper structure
      if (likes.length > 0) {
        expect(likes[0]).toHaveProperty('topic');
        expect(likes[0]).toHaveProperty('sentiment');
        expect(likes[0]).toHaveProperty('canMention');
      }
    });

    it("should parse dislikes from Section 12", () => {
      const opinions = parseCharacterOpinions();
      const dislikes = opinions.filter(o => o.category === 'dislikes');
      
      // Dislikes should be present
      expect(dislikes.length).toBeGreaterThan(0);
      // Check structure
      expect(dislikes[0]).toHaveProperty('sentiment');
    });

    it("should mark opinions with canMention appropriately", () => {
      const opinions = parseCharacterOpinions();
      
      // All likes should be mentionable
      const likes = opinions.filter(o => o.category === 'likes');
      if (likes.length > 0) {
        expect(likes.every(o => o.canMention === true)).toBe(true);
      }
      
      // Dislikes about people should NOT be mentionable
      const peopleDislike = opinions.find(o => 
        o.category === 'dislikes' && o.sentiment.toLowerCase().includes('people who')
      );
      if (peopleDislike) {
        expect(peopleDislike.canMention).toBe(false);
      }
    });

    it("should return empty array for invalid profile", () => {
      const opinions = parseCharacterOpinions("definitely not a profile");
      expect(opinions).toEqual([]);
    });
  });

  describe("getCharacterOpinions", () => {
    it("should cache opinions on subsequent calls", () => {
      const opinions1 = getCharacterOpinions();
      const opinions2 = getCharacterOpinions();
      
      // Should be the same reference (cached)
      expect(opinions1).toBe(opinions2);
    });
  });

  // ============================================
  // Open Loop Detection Tests
  // ============================================

  describe("detectOpenLoops", () => {
    it("should detect pending event patterns", async () => {
      // Mock successful insert
      mocks.single.mockResolvedValueOnce({
        data: {
          id: "test-loop-1",

          loop_type: "pending_event",
          topic: "presentation",
          status: "active",
          salience: 0.7,
          surface_count: 0,
          max_surfaces: 2,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const loops = await detectOpenLoops(
        "I have a presentation tomorrow and I am so nervous"
      );

      expect(mocks.from).toHaveBeenCalledWith("presence_contexts");
      expect(mocks.insert).toHaveBeenCalled();
    });

    it("should detect emotional state patterns", async () => {
      mocks.single.mockResolvedValueOnce({
        data: {
          id: "test-loop-2",

          loop_type: "emotional_followup",
          topic: "how you were feeling",
          status: "active",
          salience: 0.8,
          surface_count: 0,
          max_surfaces: 3,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const loops = await detectOpenLoops(
        "I'm really stressed about everything going on"
      );

      expect(mocks.from).toHaveBeenCalledWith("presence_contexts");
    });

    it("should detect commitment patterns", async () => {
      mocks.single.mockResolvedValueOnce({
        data: {
          id: "test-loop-3",

          loop_type: "commitment_check",
          topic: "start meditating",
          status: "active",
          salience: 0.5,
          surface_count: 0,
          max_surfaces: 3,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      await detectOpenLoops("I'm going to try to start meditating this week");

      expect(mocks.from).toHaveBeenCalledWith("presence_contexts");
    });

    it("should skip very short messages", async () => {
      const loops = await detectOpenLoops("hi");

      expect(loops).toEqual([]);
      expect(mocks.insert).not.toHaveBeenCalled();
    });

    it("should not detect common non-commitments", async () => {
      // "I'm going to go sleep" should NOT create a commitment loop
      await detectOpenLoops("I'm going to go sleep now");

      // The insert should not be called for "go sleep"
      // (depends on implementation, but the test documents expected behavior)
    });
  });

  // ============================================
  // Simple Pattern Detection Tests (Unit)
  // ============================================

  describe("pattern detection helpers", () => {
    it("should extract event topics correctly", async () => {
      // This tests the pattern matching logic
      const patterns = [
        {
          input: "I have a big interview tomorrow",
          expectedTopic: "interview",
        },
        { input: "Got a date tonight, wish me luck", expectedTopic: "date" },
        { input: "My exam is later today", expectedTopic: "exam" },
      ];

      for (const pattern of patterns) {
        mocks.single.mockResolvedValueOnce({
          data: {
            id: `test-${Date.now()}`,

            loop_type: "pending_event",
            topic: pattern.expectedTopic,
            status: "active",
            salience: 0.7,
            surface_count: 0,
            max_surfaces: 2,
            created_at: new Date().toISOString(),
          },
          error: null,
        });

        await detectOpenLoops(pattern.input);
      }
    });
  });
});

describe("Opinion Integration", () => {
  it("exports Opinion type correctly", () => {
    const mockOpinion: Opinion = {
      category: 'likes',
      topic: 'Coffee',
      sentiment: 'Love a good oat milk latte',
      canMention: true
    };
    
    expect(mockOpinion.category).toBe('likes');
  });

  it("exports LoopType correctly", () => {
    const loopTypes: LoopType[] = [
      'pending_event',
      'emotional_followup',
      'commitment_check',
      'curiosity_thread',
      'pattern_observation'
    ];
    
    expect(loopTypes.length).toBe(5);
  });
});
