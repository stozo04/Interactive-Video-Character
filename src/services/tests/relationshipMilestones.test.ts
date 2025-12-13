// src/services/tests/relationshipMilestones.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Create mocks
const { globalMocks, insertResolvedValues, selectResolvedValues, updateResolvedValues } = vi.hoisted(() => {
  const mocks: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    from: vi.fn(),
  };
  const insertValues: any[] = [];
  const selectValues: any[] = [];
  const updateValues: any[] = [];
  return { 
    globalMocks: mocks, 
    insertResolvedValues: insertValues, 
    selectResolvedValues: selectValues,
    updateResolvedValues: updateValues 
  };
});

// Mock Supabase client
vi.mock("../supabaseClient", () => {
  const mocks = globalMocks;

  // Create chainable query builder
  const createQueryChain = (): any => ({
    eq: vi.fn(() => createQueryChain()),
    lt: vi.fn(() => createQueryChain()),
    order: vi.fn(() => createQueryChain()),
    limit: vi.fn(() => createQueryChain()),
    single: mocks.single,
    maybeSingle: mocks.maybeSingle,
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
      then: vi.fn((resolve: any) => {
        const value = updateResolvedValues.shift() || { error: null };
        return Promise.resolve(value).then(resolve);
      }),
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
      rpc: vi.fn(() => Promise.resolve({ data: 1, error: null })),
    } as unknown as SupabaseClient,
  };
});

// Import after mocks are set up
import {
  recordMilestone,
  getMilestones,
  getMilestoneForCallback,
  detectMilestoneInMessage,
  checkAnniversaryMilestones,
  detectReturnAfterBreak,
  generateMilestoneCallbackPrompt,
  getMilestoneStats,
  type MilestoneType,
  type RelationshipMilestone,
} from "../relationshipMilestones";

describe("relationshipMilestones", () => {
  let mocks: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = globalMocks;
    insertResolvedValues.length = 0;
    selectResolvedValues.length = 0;
    updateResolvedValues.length = 0;
  });

  // ============================================
  // recordMilestone Tests
  // ============================================

  describe("recordMilestone", () => {
    it("should create a new milestone when it doesn't exist", async () => {
      // Mock: no existing milestone
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      
      // Mock: successful insert
      mocks.single.mockResolvedValueOnce({
        data: {
          id: 'test-milestone-1',
          user_id: 'user-123',
          milestone_type: 'first_vulnerability',
          description: 'First time opening up',
          occurred_at: new Date().toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await recordMilestone(
        'user-123',
        'first_vulnerability',
        'First time opening up',
        'I never told anyone...'
      );

      expect(mocks.from).toHaveBeenCalledWith('relationship_milestones');
      expect(mocks.insert).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.milestoneType).toBe('first_vulnerability');
    });

    it("should not create duplicate milestones", async () => {
      // Mock: milestone already exists
      mocks.maybeSingle.mockResolvedValueOnce({
        data: { id: 'existing-milestone' },
        error: null,
      });

      const result = await recordMilestone(
        'user-123',
        'first_vulnerability',
        'Second vulnerability'
      );

      expect(result).toBeNull();
      expect(mocks.insert).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      // Mock: database error
      mocks.maybeSingle.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST000', message: 'Database error' },
      });

      const result = await recordMilestone(
        'user-123',
        'first_joke',
        'Funny moment'
      );

      expect(result).toBeNull();
    });
  });

  // ============================================
  // getMilestones Tests
  // ============================================

  describe("getMilestones", () => {
    it("should return all milestones for a user", async () => {
      const mockMilestones = [
        {
          id: 'ms-1',
          user_id: 'user-123',
          milestone_type: 'first_vulnerability',
          description: 'Opened up',
          occurred_at: new Date().toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: new Date().toISOString(),
        },
        {
          id: 'ms-2',
          user_id: 'user-123',
          milestone_type: 'first_joke',
          description: 'First laugh',
          occurred_at: new Date().toISOString(),
          has_been_referenced: true,
          reference_count: 1,
          last_referenced_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ];

      selectResolvedValues.push({ data: mockMilestones, error: null });

      const result = await getMilestones('user-123');

      expect(mocks.from).toHaveBeenCalledWith('relationship_milestones');
      expect(result.length).toBe(2);
      expect(result[0].milestoneType).toBe('first_vulnerability');
      expect(result[1].hasBeenReferenced).toBe(true);
    });

    it("should return empty array when no milestones exist", async () => {
      selectResolvedValues.push({ data: [], error: null });

      const result = await getMilestones('user-123');

      expect(result).toEqual([]);
    });
  });

  // ============================================
  // getMilestoneForCallback Tests
  // ============================================

  describe("getMilestoneForCallback", () => {
    it("should return null when totalInteractions < 50", async () => {
      const result = await getMilestoneForCallback('user-123', 30);

      expect(result).toBeNull();
      expect(mocks.from).not.toHaveBeenCalled();
    });

    it("should return eligible milestone when interactions >= 50", async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
      
      selectResolvedValues.push({
        data: [{
          id: 'ms-1',
          user_id: 'user-123',
          milestone_type: 'first_vulnerability',
          description: 'Opened up',
          occurred_at: oldDate.toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: oldDate.toISOString(),
        }],
        error: null,
      });

      const result = await getMilestoneForCallback('user-123', 55);

      expect(mocks.from).toHaveBeenCalledWith('relationship_milestones');
      expect(result).not.toBeNull();
      expect(result?.milestoneType).toBe('first_vulnerability');
    });

    it("should filter out recently referenced milestones", async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const recentRef = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago (< 72 hours min)
      
      selectResolvedValues.push({
        data: [{
          id: 'ms-1',
          user_id: 'user-123',
          milestone_type: 'first_vulnerability',
          description: 'Opened up',
          occurred_at: oldDate.toISOString(),
          has_been_referenced: true,
          reference_count: 1,
          last_referenced_at: recentRef.toISOString(),
          created_at: oldDate.toISOString(),
        }],
        error: null,
      });

      const result = await getMilestoneForCallback('user-123', 60);

      expect(result).toBeNull();
    });
  });

  // ============================================
  // detectMilestoneInMessage Tests
  // ============================================

  describe("detectMilestoneInMessage", () => {
    it("should detect vulnerability patterns", async () => {
      // Mock: no existing milestone + successful insert
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mocks.single.mockResolvedValueOnce({
        data: {
          id: 'test-ms',
          user_id: 'user-123',
          milestone_type: 'first_vulnerability',
          description: 'First time opening up emotionally',
          occurred_at: new Date().toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await detectMilestoneInMessage(
        'user-123',
        "I've never told anyone this, but...",
        10
      );

      expect(result).not.toBeNull();
      expect(result?.milestoneType).toBe('first_vulnerability');
    });

    it("should detect joke/humor patterns", async () => {
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mocks.single.mockResolvedValueOnce({
        data: {
          id: 'test-ms',
          user_id: 'user-123',
          milestone_type: 'first_joke',
          description: 'First shared laugh together',
          occurred_at: new Date().toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await detectMilestoneInMessage(
        'user-123',
        "Hahaha that's so funny, you crack me up!",
        15
      );

      expect(result?.milestoneType).toBe('first_joke');
    });

    it("should detect support seeking patterns", async () => {
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mocks.single.mockResolvedValueOnce({
        data: {
          id: 'test-ms',
          user_id: 'user-123',
          milestone_type: 'first_support',
          description: 'First time seeking support or advice',
          occurred_at: new Date().toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await detectMilestoneInMessage(
        'user-123',
        "I need help with something, can you listen?",
        20
      );

      expect(result?.milestoneType).toBe('first_support');
    });

    it("should detect interaction count milestones", async () => {
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mocks.single.mockResolvedValueOnce({
        data: {
          id: 'test-ms',
          user_id: 'user-123',
          milestone_type: 'interaction_50',
          description: 'Reached 50 conversations together',
          occurred_at: new Date().toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await detectMilestoneInMessage(
        'user-123',
        "Hey there!",
        50
      );

      expect(result?.milestoneType).toBe('interaction_50');
    });

    it("should not detect anything for normal messages", async () => {
      const result = await detectMilestoneInMessage(
        'user-123',
        "The weather is nice today",
        25
      );

      expect(result).toBeNull();
    });
  });

  // ============================================
  // checkAnniversaryMilestones Tests
  // ============================================

  describe("checkAnniversaryMilestones", () => {
    it("should detect 1-week anniversary", async () => {
      const firstInteraction = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
      
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mocks.single.mockResolvedValueOnce({
        data: {
          id: 'test-ms',
          user_id: 'user-123',
          milestone_type: 'anniversary_week',
          description: "It's been a week since we first talked",
          occurred_at: new Date().toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await checkAnniversaryMilestones('user-123', firstInteraction);

      expect(result?.milestoneType).toBe('anniversary_week');
    });

    it("should detect 1-month anniversary", async () => {
      const firstInteraction = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
      
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mocks.single.mockResolvedValueOnce({
        data: {
          id: 'test-ms',
          user_id: 'user-123',
          milestone_type: 'anniversary_month',
          description: "It's been a month since we first met",
          occurred_at: new Date().toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await checkAnniversaryMilestones('user-123', firstInteraction);

      expect(result?.milestoneType).toBe('anniversary_month');
    });

    it("should return null for recent relationships", async () => {
      const firstInteraction = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

      const result = await checkAnniversaryMilestones('user-123', firstInteraction);

      expect(result).toBeNull();
    });
  });

  // ============================================
  // detectReturnAfterBreak Tests
  // ============================================

  describe("detectReturnAfterBreak", () => {
    it("should detect return after 3+ days", async () => {
      const lastInteraction = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      
      mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
      mocks.single.mockResolvedValueOnce({
        data: {
          id: 'test-ms',
          user_id: 'user-123',
          milestone_type: 'first_return',
          description: 'Came back after 5 days',
          occurred_at: new Date().toISOString(),
          has_been_referenced: false,
          reference_count: 0,
          created_at: new Date().toISOString(),
        },
        error: null,
      });

      const result = await detectReturnAfterBreak('user-123', lastInteraction);

      expect(result?.milestoneType).toBe('first_return');
    });

    it("should not detect for recent interactions", async () => {
      const lastInteraction = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

      const result = await detectReturnAfterBreak('user-123', lastInteraction);

      expect(result).toBeNull();
    });
  });

  // ============================================
  // generateMilestoneCallbackPrompt Tests
  // ============================================

  describe("generateMilestoneCallbackPrompt", () => {
    it("should generate prompt for vulnerability milestone", () => {
      const milestone: RelationshipMilestone = {
        id: 'ms-1',
        userId: 'user-123',
        milestoneType: 'first_vulnerability',
        description: 'First time opening up emotionally',
        occurredAt: new Date(Date.now() - 72 * 60 * 60 * 1000), // 3 days ago
        hasBeenReferenced: false,
        referenceCount: 0,
      };

      const prompt = generateMilestoneCallbackPrompt(milestone);

      expect(prompt).toContain('REMEMBER WHEN');
      expect(prompt).toContain('First time opening up emotionally');
      expect(prompt).toContain('CRITICAL');
      // Template is randomly selected, so check for any valid content
      expect(prompt.toLowerCase()).toMatch(/(vulnerability|trust|opened up|personal)/i);
    });

    it("should generate prompt for joke milestone", () => {
      const milestone: RelationshipMilestone = {
        id: 'ms-2',
        userId: 'user-123',
        milestoneType: 'first_joke',
        description: 'First shared laugh together',
        occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        hasBeenReferenced: false,
        referenceCount: 0,
      };

      const prompt = generateMilestoneCallbackPrompt(milestone);

      expect(prompt).toContain('First shared laugh');
      expect(prompt).toMatch(/(laugh|joke|funny)/i);
    });

    it("should include correct time description", () => {
      const recentMilestone: RelationshipMilestone = {
        id: 'ms-3',
        userId: 'user-123',
        milestoneType: 'first_support',
        description: 'Asked for help',
        occurredAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
        hasBeenReferenced: false,
        referenceCount: 0,
      };

      const prompt = generateMilestoneCallbackPrompt(recentMilestone);

      expect(prompt).toContain('earlier');
    });
  });

  // ============================================
  // getMilestoneStats Tests
  // ============================================

  describe("getMilestoneStats", () => {
    it("should return correct statistics", async () => {
      selectResolvedValues.push({
        data: [
          {
            id: 'ms-1',
            user_id: 'user-123',
            milestone_type: 'first_vulnerability',
            description: 'Test',
            occurred_at: new Date().toISOString(),
            has_been_referenced: true,
            reference_count: 1,
            created_at: new Date().toISOString(),
          },
          {
            id: 'ms-2',
            user_id: 'user-123',
            milestone_type: 'first_joke',
            description: 'Test',
            occurred_at: new Date().toISOString(),
            has_been_referenced: false,
            reference_count: 0,
            created_at: new Date().toISOString(),
          },
        ],
        error: null,
      });

      const stats = await getMilestoneStats('user-123');

      expect(stats.totalMilestones).toBe(2);
      expect(stats.referencedCount).toBe(1);
      expect(stats.milestoneTypes).toContain('first_vulnerability');
      expect(stats.milestoneTypes).toContain('first_joke');
    });
  });

  // ============================================
  // Type Export Tests
  // ============================================

  describe("Type Exports", () => {
    it("exports MilestoneType correctly", () => {
      const types: MilestoneType[] = [
        'first_vulnerability',
        'first_joke',
        'first_support',
        'first_deep_talk',
        'first_return',
        'breakthrough_moment',
        'anniversary_week',
        'anniversary_month',
        'interaction_50',
        'interaction_100',
      ];

      expect(types.length).toBe(10);
    });

    it("exports RelationshipMilestone type correctly", () => {
      const mockMilestone: RelationshipMilestone = {
        id: 'test-id',
        userId: 'user-id',
        milestoneType: 'first_vulnerability',
        description: 'Test description',
        occurredAt: new Date(),
        hasBeenReferenced: false,
        referenceCount: 0,
      };

      expect(mockMilestone.id).toBe('test-id');
      expect(mockMilestone.milestoneType).toBe('first_vulnerability');
    });
  });
});

describe("callbackDirector milestone integration", () => {
  // These tests verify the callback director correctly integrates milestones
  
  describe("getMilestoneCallback", () => {
    it("should be exported from callbackDirector", async () => {
      // Just verify the function exists and is callable
      const { getMilestoneCallback } = await import("../callbackDirector");
      
      expect(typeof getMilestoneCallback).toBe('function');
    });
  });

  describe("getEnhancedCallbackPrompt", () => {
    it("should be exported from callbackDirector", async () => {
      const { getEnhancedCallbackPrompt } = await import("../callbackDirector");
      
      expect(typeof getEnhancedCallbackPrompt).toBe('function');
    });
  });

  describe("markMilestoneCallbackUsed", () => {
    it("should be exported from callbackDirector", async () => {
      const { markMilestoneCallbackUsed } = await import("../callbackDirector");
      
      expect(typeof markMilestoneCallbackUsed).toBe('function');
    });
  });

  describe("resetMilestoneSession", () => {
    it("should be exported from callbackDirector", async () => {
      const { resetMilestoneSession } = await import("../callbackDirector");
      
      expect(typeof resetMilestoneSession).toBe('function');
    });
  });
});
