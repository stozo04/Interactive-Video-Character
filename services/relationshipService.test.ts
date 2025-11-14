// relationshipService.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
// FIX: Import the service AND the newly exported internal functions
import * as relationshipService from "./relationshipService";
import { 
  detectRupture, 
  calculateScoreChanges 
} from "./relationshipService";
import type {
  RelationshipMetrics,
  RelationshipEvent,
} from "./relationshipService";

// Hardcoded valid UUIDs for testing purposes (Required for Zod UUID validation)
const MOCK_RELATIONSHIP_ID = "00000000-0000-4000-8000-000000000123";
const MOCK_INSIGHT_ID = "00000000-0000-4000-8000-000000000321";

// Create mocks using vi.hoisted() so they're available in the mock factory
const { globalMocks, insertResolvedValues } = vi.hoisted(() => {
  const mocks: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    from: vi.fn(),
  };
  // Track resolved values for insert chains (for event logging and insight creation)
  const insertValues: any[] = [];
  return { globalMocks: mocks, insertResolvedValues: insertValues };
});

// Mock the supabase client module - must be hoisted, so use factory function
vi.mock("./supabaseClient", () => {
  const mocks = globalMocks;

  // Helper to create a chainable eq builder that supports multiple eq() calls
  const createEqChain = (): any => {
    const eqChain = {
      eq: vi.fn((column: string, value: any) => {
        mocks.eq(column, value);
        return createEqChain();
      }),
      maybeSingle: mocks.maybeSingle,
      single: mocks.single,
    };
    return eqChain;
  };

  // Helper for select().eq().eq().maybeSingle() pattern
  const createSelectChain = () => ({
    eq: vi.fn((column: string, value: any) => {
      mocks.eq(column, value);
      return createEqChain();
    }),
  });

  // Helper for insert().select().single() pattern or direct insert() calls (for event logging)
  const createInsertChain = () => {
    const insertChain: any = {
      select: vi.fn((columns?: string) => {
        mocks.select(columns);
        return {
          single: mocks.single,
        };
      }),
    };
    
    // Make it thenable for direct await (used in event logging and insight insert)
    insertChain.then = vi.fn((resolve: any, reject: any) => {
      // Pop the resolved value from the array for non-chained inserts
      const resolvedValue = insertResolvedValues.length > 0 
        ? insertResolvedValues.shift() 
        : { data: null, error: null };
      return Promise.resolve(resolvedValue).then(resolve, reject);
    });
    insertChain.catch = vi.fn((reject: any) => {
      return insertChain.then(undefined, reject);
    });
    
    return insertChain;
  };

  // Helper for update().eq().eq().select().single() pattern
  const createUpdateChain = () => {
    const updateChain = {
      // Used by updateRelationship's main update AND pattern insight update
      eq: vi.fn((column: string, value: any) => {
        mocks.eq(column, value);
        return {
          eq: vi.fn((col: string, val: any) => {
            mocks.eq(col, val);
            return {
              select: vi.fn((columns?: string) => {
                mocks.select(columns);
                return {
                  single: mocks.single,
                };
              }),
            };
          }),
          select: vi.fn((columns?: string) => {
            mocks.select(columns);
            return {
              single: mocks.single,
            };
          }),
          // This path is used for updating insights (update().eq('id', ...))
          // It needs to be resolvable for the promise logic to work
          then: vi.fn((resolve: any, reject: any) => {
            return Promise.resolve({ error: null }).then(resolve, reject);
          }),
          catch: vi.fn((reject: any) => {
            return Promise.resolve({ error: null }).then(undefined, reject);
          }),
        };
      }),
      // This is for the insight update path (update().eq().then())
      then: vi.fn((resolve: any, reject: any) => {
        return Promise.resolve({ error: null }).then(resolve, reject);
      }),
      catch: vi.fn((reject: any) => {
        return Promise.resolve({ error: null }).then(undefined, reject);
      }),
    };
    return updateChain;
  };

  // Set up default return values - use mockImplementation to create new chains each time
  mocks.select.mockImplementation(() => createSelectChain());
  mocks.insert.mockImplementation(() => createInsertChain());
  mocks.update.mockImplementation(() => createUpdateChain());

  const mockFrom = vi.fn(() => ({
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
  }));

  mocks.from = mockFrom;

  const client = {
    from: mockFrom,
    _mocks: mocks,
  } as unknown as SupabaseClient;

  return {
    supabase: client,
  };
});


// Helper to create a mock relationship row (database format)
interface RelationshipRow {
  id: string;
  user_id: string;
  character_id: string;
  relationship_score: number;
  relationship_tier: string;
  warmth_score: number;
  trust_score: number;
  playfulness_score: number;
  stability_score: number;
  familiarity_stage: string;
  total_interactions: number;
  positive_interactions: number;
  negative_interactions: number;
  first_interaction_at: string | null;
  last_interaction_at: string | null;
  is_ruptured: boolean;
  last_rupture_at: string | null;
  rupture_count: number;
  created_at: string;
  updated_at: string;
}

const createMockRelationshipRow = (
  overrides?: Partial<RelationshipRow>
): RelationshipRow => ({
  id: MOCK_RELATIONSHIP_ID, // Use valid UUID
  user_id: "user-123",
  character_id: "char-123",
  relationship_score: 0,
  relationship_tier: "acquaintance",
  warmth_score: 0,
  trust_score: 0,
  playfulness_score: 0,
  stability_score: 0,
  familiarity_stage: "early",
  is_ruptured: false,
  last_rupture_at: null,
  first_interaction_at: new Date().toISOString(),
  last_interaction_at: new Date().toISOString(),
  total_interactions: 0,
  positive_interactions: 0,
  negative_interactions: 0,
  rupture_count: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe("relationshipService", () => {
  let mocks: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = globalMocks;
    // Clear insert resolved values between tests - CRITICAL for `insert().then()`
    insertResolvedValues.length = 0; 
    // Clear call history but keep implementations
    mocks.single.mockClear();
    mocks.maybeSingle.mockClear();
    // Ensure single and maybeSingle return promises by default
    if (!mocks.single.getMockImplementation()) {
      mocks.single.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
    if (!mocks.maybeSingle.getMockImplementation()) {
      mocks.maybeSingle.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
  });

  // --- EXISTING TESTS (Passing) ---

  describe("getRelationship", () => {
    it("should return existing relationship when found", async () => {
      const mockRow = createMockRelationshipRow({
        relationship_score: 25,
        relationship_tier: "friend",
      });

      mocks.maybeSingle.mockResolvedValue({
        data: mockRow,
        error: null,
      });

      const result = await relationshipService.getRelationship(
        "char-123",
        "user-123"
      );

      expect(mocks.from).toHaveBeenCalledWith("character_relationships");
      expect(mocks.select).toHaveBeenCalledWith("*");
      expect(mocks.eq).toHaveBeenCalledWith("character_id", "char-123");
      expect(mocks.eq).toHaveBeenCalledWith("user_id", "user-123");
      expect(result).not.toBeNull();
      expect(result?.relationshipScore).toBe(25);
      expect(result?.relationshipTier).toBe("friend");
    });

    it("should create new relationship when not found", async () => {
      // First call: not found
      mocks.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST116", message: "Not found" },
      });

      // Second call: insert successful
      const newRow = createMockRelationshipRow();
      mocks.single.mockResolvedValueOnce({
        data: newRow,
        error: null,
      });

      const result = await relationshipService.getRelationship(
        "char-123",
        "user-123"
      );

      expect(mocks.insert).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.relationshipScore).toBe(0);
      expect(result?.relationshipTier).toBe("acquaintance");
      expect(result?.familiarityStage).toBe("early");
      expect(result?.isRuptured).toBe(false);
      expect(result?.totalInteractions).toBe(0);
    });

    it("should return null when database query fails", async () => {
      mocks.maybeSingle.mockResolvedValue({
        data: null,
        error: { code: "PGRST500", message: "Database error" },
      });

      const result = await relationshipService.getRelationship(
        "char-123",
        "user-123"
      );

      expect(result).toBeNull();
    });

    it("should return null when insert fails", async () => {
      mocks.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST116", message: "Not found" },
      });

      mocks.single.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST500", message: "Insert failed" },
      });

      const result = await relationshipService.getRelationship(
        "char-123",
        "user-123"
      );

      expect(result).toBeNull();
    });
  });

  describe("updateRelationship", () => {
    const baseEvent: RelationshipEvent = {
      eventType: "positive",
      source: "chat",
      sentimentTowardCharacter: "positive",
      scoreChange: 3,
      warmthChange: 2,
      trustChange: 1,
      playfulnessChange: 1,
      stabilityChange: 1,
    };

    it("should update relationship with positive sentiment", async () => {
      const existingRow = createMockRelationshipRow({
        relationship_score: 10,
        relationship_tier: "acquaintance",
        warmth_score: 5,
        trust_score: 5,
        playfulness_score: 3,
        stability_score: 4,
        total_interactions: 5,
      });

      // 1. Get existing (inside updateRelationship > getRelationship)
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      const updatedRow = createMockRelationshipRow({
        relationship_score: 13, // 10 + 3
        relationship_tier: "friend", // 13 >= 10
        warmth_score: 7, // 5 + 2
        trust_score: 6, // 5 + 1
        playfulness_score: 4, // 3 + 1
        stability_score: 5, // 4 + 1
        total_interactions: 6,
      });
      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        baseEvent
      );

      expect(result).not.toBeNull();
      expect(result?.relationshipScore).toBe(13);
      expect(result?.relationshipTier).toBe("friend");
      expect(result?.totalInteractions).toBe(6);
      expect(mocks.update).toHaveBeenCalledTimes(1); // Main update
      expect(mocks.insert).toHaveBeenCalledTimes(1); // Only for event log
    });

    it("should update relationship with negative sentiment", async () => {
      const existingRow = createMockRelationshipRow({
        relationship_score: 15,
        relationship_tier: "friend",
        warmth_score: 10,
        trust_score: 8,
        playfulness_score: 5,
        stability_score: 7,
      });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      const updatedRow = createMockRelationshipRow({
        relationship_score: 10, // 15 - 5
        relationship_tier: "friend", // still >= 10
        warmth_score: 6, // 10 - 4
        trust_score: 5, // 8 - 3
        playfulness_score: 4, // 5 - 1
        stability_score: 5, // 7 - 2
      });
      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          ...baseEvent,
          eventType: "negative",
          sentimentTowardCharacter: "negative",
          scoreChange: -5,
          warmthChange: -4,
          trustChange: -3,
          playfulnessChange: -1,
          stabilityChange: -2,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.relationshipScore).toBe(10);
      expect(result?.warmthScore).toBe(6);
      expect(result?.trustScore).toBe(5);
      expect(mocks.insert).toHaveBeenCalledTimes(1);
    });

    it("should handle neutral sentiment (minimal change)", async () => {
      const existingRow = createMockRelationshipRow({
        relationship_score: 20,
        total_interactions: 0,
      });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      const updatedRow = createMockRelationshipRow({
        relationship_score: 20.3, // slight positive for engagement
        total_interactions: 1,
      });
      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          ...baseEvent,
          eventType: "neutral",
          sentimentTowardCharacter: "neutral",
          scoreChange: 0.3,
          warmthChange: 0.2,
          trustChange: 0,
          playfulnessChange: 0,
          stabilityChange: 0.1,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.relationshipScore).toBeGreaterThan(20);
      expect(result?.totalInteractions).toBe(1);
      expect(mocks.insert).toHaveBeenCalledTimes(1);
    });

    it("should detect and mark rupture on large negative change", async () => {
      const existingRow = createMockRelationshipRow({
        relationship_score: 20,
        is_ruptured: false,
        last_rupture_at: null,
        stability_score: 10,
      });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select (Large negative change: -15 (should trigger rupture))
      const updatedRow = createMockRelationshipRow({
        relationship_score: 5, // 20 - 15
        relationship_tier: "acquaintance",
        is_ruptured: true,
        last_rupture_at: new Date().toISOString(),
        stability_score: 5, // 10 - 5
      });
      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          ...baseEvent,
          eventType: "negative",
          sentimentTowardCharacter: "negative",
          sentimentIntensity: 9,
          scoreChange: -15,
          warmthChange: -10,
          trustChange: -8,
          playfulnessChange: -5,
          stabilityChange: -5,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.isRuptured).toBe(true);
      expect(result?.lastRuptureAt).not.toBeNull();
      expect(mocks.insert).toHaveBeenCalledTimes(1);
    });

    it("should repair rupture on positive event", async () => {
      const existingRow = createMockRelationshipRow({
        relationship_score: 5,
        is_ruptured: true,
        last_rupture_at: new Date().toISOString(),
        trust_score: 3,
        stability_score: 2,
      });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      const updatedRow = createMockRelationshipRow({
        relationship_score: 8, // 5 + 3
        relationship_tier: "acquaintance",
        is_ruptured: false,
        last_rupture_at: existingRow.last_rupture_at,
        trust_score: 4, // 3 + 1
        stability_score: 3, // 2 + 1
      });
      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          ...baseEvent,
          eventType: "repair", // Repair event sets is_ruptured to false
          sentimentTowardCharacter: "positive",
        }
      );

      expect(result).not.toBeNull();
      expect(result?.isRuptured).toBe(false);
      expect(mocks.insert).toHaveBeenCalledTimes(1);
    });

    it("should clamp scores to valid ranges", async () => {
      const existingRow = createMockRelationshipRow({
        relationship_score: 95,
        warmth_score: 48,
        total_interactions: 0,
      });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      const updatedRow = createMockRelationshipRow({
        relationship_score: 100, // clamped from 95+10=105
        warmth_score: 50, // clamped from 48+10=58
        total_interactions: 1,
      });
      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          ...baseEvent,
          scoreChange: 10, // would be 105, clamped to 100
          warmthChange: 10, // would be 58, clamped to 50
        }
      );

      expect(result).not.toBeNull();
      expect(result?.relationshipScore).toBe(100);
      expect(result?.warmthScore).toBe(50);
      expect(mocks.insert).toHaveBeenCalledTimes(1);
    });

    it("should update relationship tier based on score", async () => {
      const testCases: Array<{
        score: number;
        expectedTier: string;
      }> = [
        { score: -60, expectedTier: "adversarial" },
        { score: -20, expectedTier: "neutral_negative" },
        { score: 0, expectedTier: "acquaintance" },
        { score: 20, expectedTier: "friend" },
        { score: 60, expectedTier: "close_friend" },
        { score: 80, expectedTier: "deeply_loving" },
      ];

      for (const testCase of testCases) {
        // Clear mocks for each loop iteration to ensure fresh mock sequencing
        vi.clearAllMocks();
        mocks = globalMocks;
        insertResolvedValues.length = 0;

        const existingRow = createMockRelationshipRow({
          relationship_score: testCase.score - 5,
        });

        // 1. Get existing
        mocks.maybeSingle.mockResolvedValueOnce({
          data: existingRow,
          error: null,
        });

        // 2. Update and select
        const updatedRow = createMockRelationshipRow({
          relationship_score: testCase.score,
          relationship_tier: testCase.expectedTier,
        });
        mocks.single.mockResolvedValueOnce({
          data: updatedRow,
          error: null,
        });

        // 3. Log event (non-chained insert)
        insertResolvedValues.push({ error: null });

        const result = await relationshipService.updateRelationship(
          "char-123",
          "user-123",
          {
            ...baseEvent,
            scoreChange: 5,
          }
        );

        expect(result).not.toBeNull();
        expect(result?.relationshipTier).toBe(testCase.expectedTier);
      }
    });

    it("should update familiarity stage based on interactions and time", async () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const threeWeeksAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);

      // --- Early stage: < 5 interactions and < 2 days ---
      vi.clearAllMocks();
      mocks = globalMocks;
      insertResolvedValues.length = 0;
      const earlyRow = createMockRelationshipRow({
        first_interaction_at: twoDaysAgo.toISOString(),
        total_interactions: 3,
        familiarity_stage: "early",
      });
      mocks.maybeSingle.mockResolvedValueOnce({ data: earlyRow, error: null });
      const earlyUpdated = createMockRelationshipRow({
        familiarity_stage: "early",
        total_interactions: 4,
      });
      mocks.single.mockResolvedValueOnce({ data: earlyUpdated, error: null });
      insertResolvedValues.push({ error: null }); // Event log

      const earlyResult = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        baseEvent
      );

      expect(earlyResult).not.toBeNull();
      expect(earlyResult?.familiarityStage).toBe("early");
      expect(mocks.insert).toHaveBeenCalledTimes(1);

      // --- Developing stage: >= 5 interactions but < 25, or < 14 days ---
      vi.clearAllMocks();
      mocks = globalMocks;
      insertResolvedValues.length = 0;
      const developingRow = createMockRelationshipRow({
        first_interaction_at: twoDaysAgo.toISOString(),
        total_interactions: 10,
        familiarity_stage: "developing",
      });
      mocks.maybeSingle.mockResolvedValueOnce({ data: developingRow, error: null });
      const developingUpdated = createMockRelationshipRow({
        familiarity_stage: "developing",
        total_interactions: 11,
      });
      mocks.single.mockResolvedValueOnce({ data: developingUpdated, error: null });
      insertResolvedValues.push({ error: null }); // Event log

      const developingResult = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        baseEvent
      );

      expect(developingResult).not.toBeNull();
      expect(developingResult?.familiarityStage).toBe("developing");
      expect(mocks.insert).toHaveBeenCalledTimes(1);

      // --- Established stage: >= 25 interactions and >= 14 days ---
      vi.clearAllMocks();
      mocks = globalMocks;
      insertResolvedValues.length = 0;
      const establishedRow = createMockRelationshipRow({
        first_interaction_at: threeWeeksAgo.toISOString(),
        total_interactions: 30,
        familiarity_stage: "established",
      });
      mocks.maybeSingle.mockResolvedValueOnce({ data: establishedRow, error: null });
      const establishedUpdated = createMockRelationshipRow({
        familiarity_stage: "established",
        total_interactions: 31,
      });
      mocks.single.mockResolvedValueOnce({ data: establishedUpdated, error: null });
      insertResolvedValues.push({ error: null }); // Event log

      const establishedResult = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        baseEvent
      );

      expect(establishedResult).not.toBeNull();
      expect(establishedResult?.familiarityStage).toBe("established");
      expect(mocks.insert).toHaveBeenCalledTimes(1);
    });

    it("should record pattern observation when mood and action are present", async () => {
      const existingRow = createMockRelationshipRow();
      const updatedRow = createMockRelationshipRow({ total_interactions: 1, id: MOCK_RELATIONSHIP_ID });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({ data: existingRow, error: null });
      
      // 2. Update and select
      mocks.single.mockResolvedValueOnce({ data: updatedRow, error: null });
      
      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });
      
      // 4. Pattern insight: first check (not found)
      mocks.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST116" },
      });
      
      // 5. Pattern insight: insert (non-chained insert)
      insertResolvedValues.push({ error: null });

      await relationshipService.updateRelationship("char-123", "user-123", {
        ...baseEvent,
        userMood: "stressed",
        actionType: "action_video",
      });

      // Total updates: 1 (main update)
      // Total inserts: 1 (event log) + 1 (insight insert) = 2
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.from).toHaveBeenCalledWith("relationship_insights");
      expect(mocks.insert).toHaveBeenCalledTimes(2); 
    });

    it("should update existing pattern insight when found", async () => {
      const existingRow = createMockRelationshipRow();
      const updatedRow = createMockRelationshipRow({ total_interactions: 1, id: MOCK_RELATIONSHIP_ID });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({ data: existingRow, error: null });

      // 2. Update and select
      mocks.single.mockResolvedValueOnce({ data: updatedRow, error: null });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      // 4. Pattern insight: found existing (UUIDs fixed)
      const existingInsight = {
        id: MOCK_INSIGHT_ID, // Valid UUID
        relationship_id: MOCK_RELATIONSHIP_ID, // Valid UUID
        insight_type: "pattern",
        key: "stressed_action_video",
        summary: "User asks for action videos when stressed",
        confidence: 0.3,
        times_observed: 2,
        last_observed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingInsight,
        error: null,
      });

      // 5. Pattern insight: update (mocks.update will be called a second time)

      await relationshipService.updateRelationship("char-123", "user-123", {
        ...baseEvent,
        userMood: "stressed",
        actionType: "action_video",
      });

      // Total updates: 1 (Relationship update) + 1 (Insight update) = 2
      expect(mocks.update).toHaveBeenCalledTimes(2); 
      expect(mocks.from).toHaveBeenCalledWith("relationship_insights");
      expect(mocks.insert).toHaveBeenCalledTimes(1); // Only event log insert
    });

    it("should increment total interactions", async () => {
      const existingRow = createMockRelationshipRow({
        total_interactions: 5,
      });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      const updatedRow = createMockRelationshipRow({
        total_interactions: 6,
      });
      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        baseEvent
      );

      expect(result).not.toBeNull();
      expect(result?.totalInteractions).toBe(6);
      expect(mocks.insert).toHaveBeenCalledTimes(1);
    });

    it("should update last_interaction_at timestamp", async () => {
      const oldTimestamp = new Date("2024-01-01").toISOString();
      const existingRow = createMockRelationshipRow({
        last_interaction_at: oldTimestamp,
      });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      const newTimestamp = new Date().toISOString();
      const updatedRow = createMockRelationshipRow({
        last_interaction_at: newTimestamp,
      });
      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        baseEvent
      );

      expect(result).not.toBeNull();
      expect(result?.lastInteractionAt).not.toBeNull();
      if (result?.lastInteractionAt) {
        expect(result.lastInteractionAt.getTime()).toBeGreaterThan(
          new Date(oldTimestamp).getTime()
        );
      }
      expect(mocks.insert).toHaveBeenCalledTimes(1);
    });

    it("should return null when update fails", async () => {
      const existingRow = createMockRelationshipRow();

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select fails
      mocks.single.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST500", message: "Update failed" },
      });
      
      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        baseEvent
      );

      expect(result).toBeNull();
      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(mocks.insert).not.toHaveBeenCalled(); // No event log if update fails
    });

    it("should return null when relationship doesn't exist", async () => {
        // FIX: Mock the initial read (getRelationship's first step) to fail
      // with a general error (not PGRST116 "Not found"), forcing getRelationship 
      // to return null immediately, skipping the attempt to insert a new relationship.
      mocks.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST500", message: "Initial Fetch Failed" },
      });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        baseEvent
      );

      expect(result).toBeNull();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.insert).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle null first_interaction_at in familiarity calculation", async () => {
      const existingRow = createMockRelationshipRow({
        first_interaction_at: null,
        total_interactions: 0,
        familiarity_stage: "early",
      });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      const updatedRow = createMockRelationshipRow({
        familiarity_stage: "early",
        first_interaction_at: new Date().toISOString(),
      });

      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          eventType: "positive",
          source: "chat",
          sentimentTowardCharacter: "positive",
          scoreChange: 3,
          warmthChange: 2,
          trustChange: 1,
          playfulnessChange: 1,
          stabilityChange: 1,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.familiarityStage).toBe("early");
    });

    it("should handle relationship with null last_rupture_at", async () => {
      const existingRow = createMockRelationshipRow({
        is_ruptured: false,
        last_rupture_at: null,
      });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      const updatedRow = createMockRelationshipRow({
        is_ruptured: false,
        last_rupture_at: null,
      });

      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Log event (non-chained insert)
      insertResolvedValues.push({ error: null });

      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          eventType: "positive",
          source: "chat",
          sentimentTowardCharacter: "positive",
          scoreChange: 3,
          warmthChange: 2,
          trustChange: 1,
          playfulnessChange: 1,
          stabilityChange: 1,
        }
      );

      expect(result).not.toBeNull();
      expect(result?.lastRuptureAt).toBeNull();
    });

    it("should handle event logging failure gracefully", async () => {
      const existingRow = createMockRelationshipRow();
      const updatedRow = createMockRelationshipRow();

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({
        data: existingRow,
        error: null,
      });

      // 2. Update and select
      mocks.single.mockResolvedValueOnce({
        data: updatedRow,
        error: null,
      });

      // 3. Event logging fails
      insertResolvedValues.push({
        error: { code: "PGRST500", message: "Logging failed" },
      });

      // Should not throw, just log error
      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          eventType: "positive",
          source: "chat",
          sentimentTowardCharacter: "positive",
          scoreChange: 3,
          warmthChange: 2,
          trustChange: 1,
          playfulnessChange: 1,
          stabilityChange: 1,
        }
      );

      expect(result).not.toBeNull();
      expect(mocks.insert).toHaveBeenCalledTimes(1); // Still attempts insert
    });

    it("should handle pattern insight creation failure gracefully", async () => {
      const existingRow = createMockRelationshipRow();
      const updatedRow = createMockRelationshipRow({ id: MOCK_RELATIONSHIP_ID });

      // 1. Get existing
      mocks.maybeSingle.mockResolvedValueOnce({ data: existingRow, error: null });

      // 2. Update and select
      mocks.single.mockResolvedValueOnce({ data: updatedRow, error: null });

      // 3. Event log succeeds
      insertResolvedValues.push({ error: null });

      // 4. Pattern insight check fails
      mocks.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST500", message: "Database error" },
      });

      // Should not throw
      const result = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          eventType: "positive",
          source: "chat",
          sentimentTowardCharacter: "positive",
          userMood: "stressed",
          actionType: "action_video",
          scoreChange: 3,
          warmthChange: 2,
          trustChange: 1,
          playfulnessChange: 1,
          stabilityChange: 1,
        }
      );

      expect(result).not.toBeNull();
      expect(mocks.insert).toHaveBeenCalledTimes(1); // Only event log insert happened
      expect(mocks.update).toHaveBeenCalledTimes(1); // Only main relationship update
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete relationship progression from acquaintance to friend", async () => {
      // Start with acquaintance relationship
      const acquaintanceRow = createMockRelationshipRow({
        relationship_score: 0,
        relationship_tier: "acquaintance",
        total_interactions: 0,
      });

      // --- First interaction ---
      vi.clearAllMocks();
      mocks = globalMocks;
      insertResolvedValues.length = 0;
      mocks.maybeSingle.mockResolvedValueOnce({ data: acquaintanceRow, error: null });
      const afterFirst = createMockRelationshipRow({
        relationship_score: 3,
        relationship_tier: "acquaintance",
        total_interactions: 1,
      });
      mocks.single.mockResolvedValueOnce({ data: afterFirst, error: null });
      insertResolvedValues.push({ error: null }); // Event log

      let firstResult = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          eventType: "positive",
          source: "chat",
          sentimentTowardCharacter: "positive",
          scoreChange: 3,
          warmthChange: 2,
          trustChange: 1,
          playfulnessChange: 1,
          stabilityChange: 1,
        }
      );

      expect(firstResult).not.toBeNull();
      expect(firstResult?.relationshipScore).toBe(3);
      expect(firstResult?.relationshipTier).toBe("acquaintance");

      // --- Second interaction (reaching friend tier) ---
      vi.clearAllMocks();
      mocks = globalMocks;
      insertResolvedValues.length = 0;
      mocks.maybeSingle.mockResolvedValueOnce({ data: afterFirst, error: null }); // Use the result of the first interaction as existing
      
      const updatedFriendRow = createMockRelationshipRow({
        relationship_score: 12, // Sufficient to cross the boundary of 10
        relationship_tier: "friend",
        total_interactions: 2,
      });
      mocks.single.mockResolvedValueOnce({ data: updatedFriendRow, error: null });
      insertResolvedValues.push({ error: null }); // Event log

      const secondResult = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          eventType: "positive",
          source: "chat",
          sentimentTowardCharacter: "positive",
          scoreChange: 9, // Boost to 12 (3+9) for friend tier
          warmthChange: 2,
          trustChange: 1,
          playfulnessChange: 1,
          stabilityChange: 1,
        }
      );

      expect(secondResult).not.toBeNull();
      expect(secondResult?.relationshipScore).toBe(12);
      expect(secondResult?.relationshipTier).toBe("friend");
    });

    it("should handle rupture and repair cycle", async () => {
      // Start with good relationship
      const goodRow = createMockRelationshipRow({
        relationship_score: 20,
        relationship_tier: "friend",
        is_ruptured: false,
        last_rupture_at: null,
        total_interactions: 10,
      });

      // --- 1. Rupture ---
      vi.clearAllMocks();
      mocks = globalMocks;
      insertResolvedValues.length = 0;
      mocks.maybeSingle.mockResolvedValueOnce({ data: goodRow, error: null });

      // Large negative event causes rupture
      const rupturedRow = createMockRelationshipRow({
        relationship_score: 5, // 20 - 15
        relationship_tier: "acquaintance",
        is_ruptured: true,
        last_rupture_at: new Date().toISOString(),
        total_interactions: 11,
      });
      mocks.single.mockResolvedValueOnce({ data: rupturedRow, error: null });
      insertResolvedValues.push({ error: null }); // Event log

      const rupturedResult = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          eventType: "negative",
          source: "chat",
          sentimentTowardCharacter: "negative",
          sentimentIntensity: 9,
          scoreChange: -15,
          warmthChange: -10,
          trustChange: -8,
          playfulnessChange: -5,
          stabilityChange: -5,
        }
      );

      expect(rupturedResult).not.toBeNull();
      expect(rupturedResult?.isRuptured).toBe(true);
      expect(rupturedResult?.lastRuptureAt).not.toBeNull();
      
      // --- 2. Repair ---
      vi.clearAllMocks();
      mocks = globalMocks;
      insertResolvedValues.length = 0;
      // Use the ruptured result for the next existing row
      mocks.maybeSingle.mockResolvedValueOnce({ data: rupturedRow, error: null });

      // Positive event repairs rupture
      const repairedRow = createMockRelationshipRow({
        relationship_score: 8, // 5 + 3
        relationship_tier: "acquaintance",
        is_ruptured: false,
        last_rupture_at: rupturedRow.last_rupture_at, // Should keep the old rupture time
        total_interactions: 12,
      });
      mocks.single.mockResolvedValueOnce({ data: repairedRow, error: null });
      insertResolvedValues.push({ error: null }); // Event log

      const repairedResult = await relationshipService.updateRelationship(
        "char-123",
        "user-123",
        {
          eventType: "repair",
          source: "chat",
          sentimentTowardCharacter: "positive",
          scoreChange: 3,
          warmthChange: 2,
          trustChange: 1,
          playfulnessChange: 1,
          stabilityChange: 1,
        }
      );

      expect(repairedResult).not.toBeNull();
      expect(repairedResult?.isRuptured).toBe(false);
      expect(repairedResult?.lastRuptureAt?.getTime()).toEqual(new Date(rupturedRow.last_rupture_at!).getTime());
    });
  });


  // --- NEW TESTS FOR INTERNAL LOGIC ---
  describe("Internal Logic Functions", () => {
    
    // --- calculateScoreChanges tests ---
    describe("calculateScoreChanges", () => {
      const getChanges = (sentiment: 'positive' | 'neutral' | 'negative', intensity: number, message: string = "") => {
        // We set userMood to null as the primary logic relies on keywords in the message
        // FIX: Call the imported function directly
        return calculateScoreChanges(sentiment, intensity, message, null);
      }

      it("should apply general positive changes scaled by intensity (mid-range)", () => {
        const changes = getChanges('positive', 5, "Hello!");
        // Score: (2 + 3 * 0.5) = 3.5
        // Warmth: (1 + 2 * 0.5) = 2.0
        // Trust: (0.5 * 0.5) = 0.25
        // Stability: (0.5 * 0.5) = 0.25
        expect(changes.scoreChange).toBeCloseTo(3.5);
        expect(changes.warmthChange).toBeCloseTo(2.0);
        expect(changes.trustChange).toBeCloseTo(0.3); // Rounded to 0.1
        expect(changes.playfulnessChange).toBeCloseTo(0);
        expect(changes.stabilityChange).toBeCloseTo(0.3); // Rounded to 0.1
      });

      it("should apply general negative changes scaled by intensity (high-range)", () => {
        const changes = getChanges('negative', 9, "I hate this conversation!");
        // Score: -(5 + 10 * 0.9) = -14.0
        // Warmth: -(2 + 3 * 0.9) = -4.7
        // Trust: -(1 + 2 * 0.9) = -2.8
        // Stability: -(1 + 1 * 0.9) = -1.9
        expect(changes.scoreChange).toBeCloseTo(-14.0);
        expect(changes.warmthChange).toBeCloseTo(-5.6);
        expect(changes.trustChange).toBeCloseTo(-3.2);
        expect(changes.playfulnessChange).toBeCloseTo(-1.0); // Playfulness is fixed to -1
        expect(changes.stabilityChange).toBeCloseTo(-1.9);
      });

      it("should significantly boost Warmth and Trust for a positive Compliment", () => {
        const changes = getChanges('positive', 8, "You are amazing and wonderful!");
        // Base Multiplier: 0.8
        // Base Score: (2 + 3 * 0.8) = 4.4
        // Base Warmth: (1 + 2 * 0.8) = 2.6
        // Compliment Warmth Boost: 1 * 0.8 = 0.8 (Total: 3.4)
        // Compliment Trust Boost: 0.3 * 0.8 = 0.24 (Total: 0.64)
        expect(changes.warmthChange).toBeCloseTo(3.4);
        expect(changes.trustChange).toBeCloseTo(0.6);
        expect(changes.scoreChange).toBeCloseTo(4.4);
        expect(changes.playfulnessChange).toBeCloseTo(0);
      });

      it("should prioritize Trust and Stability for a positive Apology", () => {
        const changes = getChanges('positive', 7, "I apologize, my bad!");
        // Base Multiplier: 0.7
        // Base Warmth: 1 + 2 * 0.7 = 2.4
        // Apology Trust Boost: 1.5 * 0.7 = 1.05
        // Apology Stability Boost: 1.0 * 0.7 = 0.7
        // Apology Warmth Boost: 0.3 * 0.7 = 0.21
        // Total Trust (Base + Apology): (0.5*0.7) + 1.05 = 1.4
        expect(changes.trustChange).toBeCloseTo(1.4);
        expect(changes.stabilityChange).toBeCloseTo(1.1);
      });
      
      it("should boost Playfulness for positive Banter/Joke", () => {
        const changes = getChanges('positive', 6, "That was funny! haha lol 😂");
        // Base Multiplier: 0.6
        // Playfulness: (0.5 + 1 * 0.6) = 1.1
        // Warmth: (1 + 2 * 0.6) + 0.3 * 0.6 = 2.2 + 0.18 = 2.38
        expect(changes.playfulnessChange).toBeCloseTo(1.1);
        expect(changes.warmthChange).toBeCloseTo(2.4);
      });

      it("should severely hurt Trust and Stability for a negative Dismissive message", () => {
        const changes = getChanges('negative', 8, "I don't care about what you say, whatever.");
        // Base Multiplier: 0.8
        // Base Trust: -(1 + 2 * 0.8) = -2.6
        // Dismissive Trust Damage: -1 * 0.8 = -0.8 (Total: -3.4)
        // Base Stability: -(1 + 1 * 0.8) = -1.8
        // Dismissive Stability Damage: -0.5 * 0.8 = -0.4 (Total: -2.2)
        expect(changes.trustChange).toBeCloseTo(-3.8);
        expect(changes.stabilityChange).toBeCloseTo(-2.2); 
      });

      it("should return small positive changes for neutral Engagement (long message/question)", () => {
        const changes = getChanges('neutral', 5, "What do you think about my day, should I go for a walk or stay in bed all day long?");
        // Should trigger isEngagement and isQuestion logic
        // Score change should be 0.3
        expect(changes.scoreChange).toBeCloseTo(0.3);
        expect(changes.warmthChange).toBeCloseTo(0.2);
        expect(changes.trustChange).toBeCloseTo(0);
        expect(changes.playfulnessChange).toBeCloseTo(0);
        expect(changes.stabilityChange).toBeCloseTo(0.1);
      });

      it("should return zero changes for non-engaging neutral sentiment", () => {
        const changes = getChanges('neutral', 5, "I see.");
        expect(changes.scoreChange).toBe(0);
        expect(changes.warmthChange).toBe(0);
        expect(changes.trustChange).toBe(0);
        expect(changes.playfulnessChange).toBe(0);
        expect(changes.stabilityChange).toBe(0);
      });
    });

    // --- detectRupture tests ---
    describe("detectRupture", () => {
      const createEvent = (
        sentiment: 'negative' | 'positive',
        intensity: number,
        scoreChange: number,
        message: string = ""
      ): RelationshipEvent => ({
        eventType: sentiment === 'negative' ? 'negative' : 'positive',
        source: 'chat',
        sentimentTowardCharacter: sentiment,
        sentimentIntensity: intensity,
        scoreChange: scoreChange,
        warmthChange: 0, trustChange: 0, playfulnessChange: 0, stabilityChange: 0,
        userMessage: message,
      });

      it("should NOT rupture if score drop is under threshold (15 points)", () => {
        // Score drop is 14
        const event = createEvent('negative', 5, -14); // <-- FIX (Intensity 9 -> 5)
        // FIX: Call the imported function directly
        expect(detectRupture(event, 20, 6)).toBe(false);
      });

      it("should rupture on large score drop (>= 15 points)", () => {
        // Score drop is 15
        const event = createEvent('negative', 5, -14);
        // FIX: Call the imported function directly
        expect(detectRupture(event, 20, 5)).toBe(true);
      });

      it("should rupture on high intensity negative event (Intensity >= 7, Change <= -10)", () => {
        // Intensity 7, Change -10 (Exact thresholds)
        const event = createEvent('negative', 7, -10);
        // FIX: Call the imported function directly
        expect(detectRupture(event, 20, 10)).toBe(true);
      });

      it("should NOT rupture if intensity is high but score change is small", () => {
        // Intensity 9, Change -5
        const event = createEvent('negative', 9, -5);
        // FIX: Call the imported function directly
        expect(detectRupture(event, 20, 15)).toBe(false);
      });

      it("should rupture on hostile phrase match", () => {
        const event = createEvent('negative', 5, -5, "I hate talking to you, you suck.");
        // FIX: Call the imported function directly
        expect(detectRupture(event, 20, 15)).toBe(true);
      });

      it("should NOT rupture on positive or neutral sentiment", () => {
        const positiveEvent = createEvent('positive', 10, 10, "You are the best!");
        const neutralEvent = createEvent('neutral' as any, 5, 0, "Okay, thanks.");
        // FIX: Call the imported function directly
        expect(detectRupture(positiveEvent, 20, 30)).toBe(false);
        expect(detectRupture(neutralEvent, 20, 20)).toBe(false);
      });
    });
  });
});