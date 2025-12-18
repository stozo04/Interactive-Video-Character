// src/services/tests/loopDeduplication.test.ts
/**
 * Tests for Loop Deduplication and Contradiction Detection
 * 
 * Tests the fixes for:
 * 1. Duplicate loops - preventing creation of similar loops
 * 2. Contradiction handling - dismissing loops when user denies something
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Create mocks
const { globalMocks, insertResolvedValues, selectResolvedValues } = vi.hoisted(() => {
  const mocks: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
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
        single: vi.fn(() => ({
          then: vi.fn((resolve: any) => {
            const value = insertResolvedValues.shift() || { data: null, error: null };
            return Promise.resolve(value).then(resolve);
          })
        })),
        then: vi.fn((resolve: any) => {
          const value = insertResolvedValues.shift() || { data: null, error: null };
          return Promise.resolve(value).then(resolve);
        })
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

// Mock intentService
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

// Import after mocks
import {
  createOpenLoop,
  dismissLoopsByTopic,
  type OpenLoop,
  type LoopType
} from "../presenceDirector";

describe("Loop Deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertResolvedValues.length = 0;
    selectResolvedValues.length = 0;
  });

  describe("createOpenLoop - deduplication", () => {
    it("should return existing loop when similar topic exists", async () => {
      const existingLoop: OpenLoop = {
        id: 'existing-loop-1',
        userId: 'user-123',
        loopType: 'pending_event',
        topic: 'Holiday Party',
        status: 'active',
        salience: 0.6,
        createdAt: new Date(),
        surfaceCount: 0,
        maxSurfaces: 2
      };

      // Mock: findSimilarLoop should return existing loop
      selectResolvedValues.push({
        data: [{
          id: 'existing-loop-1',
          user_id: 'user-123',
          loop_type: 'pending_event',
          topic: 'Holiday Party',
          status: 'active',
          salience: 0.6,
          created_at: new Date().toISOString(),
          surface_count: 0,
          max_surfaces: 2
        }],
        error: null
      });

      // Try to create a similar loop
      const result = await createOpenLoop(
        'user-123',
        'pending_event',
        'holiday party', // Similar but different case
        { salience: 0.7 }
      );

      // Should return existing loop, not create new one
      expect(result).not.toBeNull();
      expect(result?.id).toBe('existing-loop-1');
      // Should not call insert
      expect(globalMocks.insert).not.toHaveBeenCalled();
    });

    it("should update salience if new one is higher", async () => {
      const existingLoop: OpenLoop = {
        id: 'existing-loop-1',
        userId: 'user-123',
        loopType: 'pending_event',
        topic: 'meeting',
        status: 'active',
        salience: 0.5,
        createdAt: new Date(),
        surfaceCount: 0,
        maxSurfaces: 2
      };

      // Mock: find similar loop
      selectResolvedValues.push({
        data: [{
          id: 'existing-loop-1',
          user_id: 'user-123',
          loop_type: 'pending_event',
          topic: 'meeting',
          status: 'active',
          salience: 0.5,
          created_at: new Date().toISOString(),
          surface_count: 0,
          max_surfaces: 2
        }],
        error: null
      });

      // Try to create with higher salience
      const result = await createOpenLoop(
        'user-123',
        'pending_event',
        'meeting tomorrow',
        { salience: 0.8 }
      );

      // Should update salience
      expect(globalMocks.update).toHaveBeenCalled();
      expect(result?.salience).toBeGreaterThanOrEqual(0.8);
    });

    it("should create new loop when no similar topic exists", async () => {
      // Mock: no similar loops found
      selectResolvedValues.push({
        data: [],
        error: null
      });

      // Mock: successful insert
      insertResolvedValues.push({
        data: {
          id: 'new-loop-1',
          user_id: 'user-123',
          loop_type: 'pending_event',
          topic: 'interview',
          status: 'active',
          salience: 0.7,
          created_at: new Date().toISOString(),
          surface_count: 0,
          max_surfaces: 2
        },
        error: null
      });

      const result = await createOpenLoop(
        'user-123',
        'pending_event',
        'interview',
        { salience: 0.7 }
      );

      expect(result).not.toBeNull();
      expect(result?.topic).toBe('interview');
      expect(globalMocks.insert).toHaveBeenCalled();
    });

    it("should handle topic variations (parties vs party)", async () => {
      // Mock: existing loop with "Holiday Parties"
      selectResolvedValues.push({
        data: [{
          id: 'existing-loop-1',
          user_id: 'user-123',
          loop_type: 'pending_event',
          topic: 'Holiday Parties',
          status: 'active',
          salience: 0.6,
          created_at: new Date().toISOString(),
          surface_count: 0,
          max_surfaces: 2
        }],
        error: null
      });

      // Try to create "Holiday Party" (singular)
      const result = await createOpenLoop(
        'user-123',
        'pending_event',
        'Holiday Party',
        { salience: 0.5 }
      );

      // Should return existing loop (topics are similar)
      expect(result).not.toBeNull();
      expect(result?.id).toBe('existing-loop-1');
      expect(globalMocks.insert).not.toHaveBeenCalled();
    });

    it("should handle word overlap matching", async () => {
      // Mock: existing loop with "party tonight"
      selectResolvedValues.push({
        data: [{
          id: 'existing-loop-1',
          user_id: 'user-123',
          loop_type: 'pending_event',
          topic: 'party tonight',
          status: 'active',
          salience: 0.6,
          created_at: new Date().toISOString(),
          surface_count: 0,
          max_surfaces: 2
        }],
        error: null
      });

      // Try to create "Holiday Party" (has word overlap: "party")
      const result = await createOpenLoop(
        'user-123',
        'pending_event',
        'Holiday Party',
        { salience: 0.5 }
      );

      // Should match based on word overlap
      expect(result).not.toBeNull();
      expect(result?.id).toBe('existing-loop-1');
    });
  });

  describe("dismissLoopsByTopic", () => {
    it("should dismiss all loops matching a topic", async () => {
      // Mock: find loops matching "party"
      selectResolvedValues.push({
        data: [
          {
            id: 'loop-1',
            user_id: 'user-123',
            loop_type: 'pending_event',
            topic: 'Holiday Party',
            status: 'active',
            salience: 0.6,
            created_at: new Date().toISOString(),
            surface_count: 0,
            max_surfaces: 2
          },
          {
            id: 'loop-2',
            user_id: 'user-123',
            loop_type: 'pending_event',
            topic: 'party tonight',
            status: 'active',
            salience: 0.5,
            created_at: new Date().toISOString(),
            surface_count: 0,
            max_surfaces: 2
          }
        ],
        error: null
      });

      const dismissedCount = await dismissLoopsByTopic('user-123', 'party');

      expect(dismissedCount).toBe(2);
      expect(globalMocks.update).toHaveBeenCalled();
    });

    it("should return 0 when no matching loops found", async () => {
      // Mock: no matching loops
      selectResolvedValues.push({
        data: [],
        error: null
      });

      const dismissedCount = await dismissLoopsByTopic('user-123', 'nonexistent topic');

      expect(dismissedCount).toBe(0);
      expect(globalMocks.update).not.toHaveBeenCalled();
    });

    it("should handle fuzzy topic matching", async () => {
      // Mock: loop with "Holiday Parties"
      selectResolvedValues.push({
        data: [{
          id: 'loop-1',
          user_id: 'user-123',
          loop_type: 'pending_event',
          topic: 'Holiday Parties',
          status: 'active',
          salience: 0.6,
          created_at: new Date().toISOString(),
          surface_count: 0,
          max_surfaces: 2
        }],
        error: null
      });

      // Dismiss with "party" (singular)
      const dismissedCount = await dismissLoopsByTopic('user-123', 'party');

      expect(dismissedCount).toBe(1);
      expect(globalMocks.update).toHaveBeenCalled();
    });

    it("should only dismiss active and surfaced loops", async () => {
      // Mock: mix of active, surfaced, and resolved loops
      selectResolvedValues.push({
        data: [
          {
            id: 'loop-1',
            user_id: 'user-123',
            loop_type: 'pending_event',
            topic: 'party',
            status: 'active',
            salience: 0.6,
            created_at: new Date().toISOString(),
            surface_count: 0,
            max_surfaces: 2
          },
          {
            id: 'loop-2',
            user_id: 'user-123',
            loop_type: 'pending_event',
            topic: 'party',
            status: 'surfaced',
            salience: 0.5,
            created_at: new Date().toISOString(),
            surface_count: 1,
            max_surfaces: 2
          },
          {
            id: 'loop-3',
            user_id: 'user-123',
            loop_type: 'pending_event',
            topic: 'party',
            status: 'resolved', // Should not be dismissed
            salience: 0.4,
            created_at: new Date().toISOString(),
            surface_count: 2,
            max_surfaces: 2
          }
        ],
        error: null
      });

      const dismissedCount = await dismissLoopsByTopic('user-123', 'party');

      // Should dismiss 2 (active + surfaced), not the resolved one
      expect(dismissedCount).toBe(2);
    });
  });
});

