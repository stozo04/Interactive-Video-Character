// src/services/tests/lifeEventService.test.ts
/**
 * Life Event Service Tests
 *
 * Tests CRUD operations for life events:
 * - Recording events with validation
 * - Retrieving recent events with limits
 * - Error handling (database failures)
 * - Date filtering and ordering
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Supabase client BEFORE importing the service
const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockInsert = vi.fn();
const mockSingle = vi.fn();

vi.mock("../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert
    }))
  }
}));

// Import after mocking
import { getRecentLifeEvents, recordLifeEvent } from "../lifeEventService";

describe("Life Event Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock chain for successful queries
    mockSelect.mockReturnValue({
      order: mockOrder
    });
    mockOrder.mockReturnValue({
      limit: mockLimit
    });
    mockLimit.mockResolvedValue({
      data: [],
      error: null
    });

    mockInsert.mockReturnValue({
      select: () => ({
        single: mockSingle
      })
    });
    mockSingle.mockResolvedValue({
      data: null,
      error: null
    });
  });

  describe("getRecentLifeEvents", () => {
    it("should retrieve events with default limit of 5", async () => {
      const mockEvents = [
        {
          id: "event1",
          description: "Started video project",
          category: "personal",
          intensity: 0.6,
          created_at: new Date().toISOString()
        },
        {
          id: "event2",
          description: "Had a good call with mom",
          category: "family",
          intensity: 0.5,
          created_at: new Date().toISOString()
        }
      ];

      mockLimit.mockResolvedValue({
        data: mockEvents,
        error: null
      });

      const result = await getRecentLifeEvents();

      expect(result).toHaveLength(2);
      expect(result[0].description).toBe("Started video project");
      expect(result[1].description).toBe("Had a good call with mom");
      expect(mockLimit).toHaveBeenCalledWith(5);
    });

    it("should retrieve events with custom limit", async () => {
      mockLimit.mockResolvedValue({
        data: [],
        error: null
      });

      await getRecentLifeEvents(10);

      expect(mockLimit).toHaveBeenCalledWith(10);
    });

    it("should order events by created_at descending", async () => {
      mockLimit.mockResolvedValue({
        data: [],
        error: null
      });

      await getRecentLifeEvents();

      expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    });

    it("should convert created_at string to Date object", async () => {
      const isoDate = "2026-01-12T10:30:00Z";
      mockLimit.mockResolvedValue({
        data: [
          {
            id: "event1",
            description: "Test event",
            category: "personal",
            intensity: 0.5,
            created_at: isoDate
          }
        ],
        error: null
      });

      const result = await getRecentLifeEvents();

      expect(result[0].createdAt).toBeInstanceOf(Date);
      expect(result[0].createdAt.toISOString()).toBe(isoDate);
    });

    it("should return empty array on error", async () => {
      mockLimit.mockResolvedValue({
        data: null,
        error: { message: "Database error" }
      });

      const result = await getRecentLifeEvents();

      expect(result).toEqual([]);
    });

    it("should return empty array on exception", async () => {
      mockLimit.mockRejectedValue(new Error("Network error"));

      const result = await getRecentLifeEvents();

      expect(result).toEqual([]);
    });

    it("should handle null data gracefully", async () => {
      mockLimit.mockResolvedValue({
        data: null,
        error: null
      });

      const result = await getRecentLifeEvents();

      expect(result).toEqual([]);
    });
  });

  describe("recordLifeEvent", () => {
    it("should record event with all parameters", async () => {
      const mockEvent = {
        id: "event1",
        description: "Started new project",
        category: "personal",
        intensity: 0.7,
        created_at: new Date().toISOString()
      };

      mockSingle.mockResolvedValue({
        data: mockEvent,
        error: null
      });

      const result = await recordLifeEvent(
        "Started new project",
        "personal",
        0.7
      );

      expect(result).not.toBeNull();
      expect(result?.description).toBe("Started new project");
      expect(result?.category).toBe("personal");
      expect(result?.intensity).toBe(0.7);
      expect(mockInsert).toHaveBeenCalledWith({
        description: "Started new project",
        category: "personal",
        intensity: 0.7
      });
    });

    it("should use default intensity of 0.5 if not provided", async () => {
      const mockEvent = {
        id: "event1",
        description: "Test event",
        category: "family",
        intensity: 0.5,
        created_at: new Date().toISOString()
      };

      mockSingle.mockResolvedValue({
        data: mockEvent,
        error: null
      });

      await recordLifeEvent("Test event", "family");

      expect(mockInsert).toHaveBeenCalledWith({
        description: "Test event",
        category: "family",
        intensity: 0.5
      });
    });

    it("should convert created_at string to Date object", async () => {
      const isoDate = "2026-01-12T10:30:00Z";
      mockSingle.mockResolvedValue({
        data: {
          id: "event1",
          description: "Test event",
          category: "personal",
          intensity: 0.5,
          created_at: isoDate
        },
        error: null
      });

      const result = await recordLifeEvent("Test event", "personal");

      expect(result?.createdAt).toBeInstanceOf(Date);
      expect(result?.createdAt.toISOString()).toBe(isoDate);
    });

    it("should return null on database error", async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { message: "Database error" }
      });

      const result = await recordLifeEvent("Test event", "personal");

      expect(result).toBeNull();
    });

    it("should return null when data is null", async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: null
      });

      const result = await recordLifeEvent("Test event", "personal");

      expect(result).toBeNull();
    });

    it("should return null on exception", async () => {
      mockSingle.mockRejectedValue(new Error("Network error"));

      const result = await recordLifeEvent("Test event", "personal");

      expect(result).toBeNull();
    });

    it("should accept all valid categories", async () => {
      const categories = ["personal", "family", "social", "work"];

      for (const category of categories) {
        mockSingle.mockResolvedValue({
          data: {
            id: "event1",
            description: "Test",
            category,
            intensity: 0.5,
            created_at: new Date().toISOString()
          },
          error: null
        });

        const result = await recordLifeEvent("Test", category);
        expect(result?.category).toBe(category);
      }
    });

    it("should handle intensity boundaries", async () => {
      // Test minimum intensity
      mockSingle.mockResolvedValue({
        data: {
          id: "event1",
          description: "Test",
          category: "personal",
          intensity: 0.0,
          created_at: new Date().toISOString()
        },
        error: null
      });

      let result = await recordLifeEvent("Test", "personal", 0.0);
      expect(result?.intensity).toBe(0.0);

      // Test maximum intensity
      mockSingle.mockResolvedValue({
        data: {
          id: "event2",
          description: "Test",
          category: "personal",
          intensity: 1.0,
          created_at: new Date().toISOString()
        },
        error: null
      });

      result = await recordLifeEvent("Test", "personal", 1.0);
      expect(result?.intensity).toBe(1.0);
    });
  });

  describe("integration scenarios", () => {
    it("should support recording then retrieving events", async () => {
      // Record an event
      const recordedEvent = {
        id: "event1",
        description: "New video project started",
        category: "personal",
        intensity: 0.6,
        created_at: new Date().toISOString()
      };

      mockSingle.mockResolvedValue({
        data: recordedEvent,
        error: null
      });

      const recorded = await recordLifeEvent(
        "New video project started",
        "personal",
        0.6
      );

      expect(recorded).not.toBeNull();

      // Then retrieve it
      mockLimit.mockResolvedValue({
        data: [recordedEvent],
        error: null
      });

      const retrieved = await getRecentLifeEvents();
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].description).toBe("New video project started");
    });

    it("should handle multiple events with different intensities", async () => {
      const events = [
        {
          id: "event1",
          description: "Big achievement",
          category: "personal",
          intensity: 0.9,
          created_at: "2026-01-12T12:00:00Z"
        },
        {
          id: "event2",
          description: "Minor event",
          category: "social",
          intensity: 0.3,
          created_at: "2026-01-12T11:00:00Z"
        },
        {
          id: "event3",
          description: "Moderate event",
          category: "family",
          intensity: 0.5,
          created_at: "2026-01-12T10:00:00Z"
        }
      ];

      mockLimit.mockResolvedValue({
        data: events,
        error: null
      });

      const result = await getRecentLifeEvents();

      expect(result).toHaveLength(3);
      // Should be ordered by created_at desc (newest first)
      expect(result[0].intensity).toBe(0.9);
      expect(result[1].intensity).toBe(0.3);
      expect(result[2].intensity).toBe(0.5);
    });

    it("should handle events across all categories", async () => {
      const events = [
        {
          id: "event1",
          description: "Video project",
          category: "personal",
          intensity: 0.6,
          created_at: new Date().toISOString()
        },
        {
          id: "event2",
          description: "Mom called",
          category: "family",
          intensity: 0.5,
          created_at: new Date().toISOString()
        },
        {
          id: "event3",
          description: "Group chat active",
          category: "social",
          intensity: 0.4,
          created_at: new Date().toISOString()
        },
        {
          id: "event4",
          description: "Client project",
          category: "work",
          intensity: 0.7,
          created_at: new Date().toISOString()
        }
      ];

      mockLimit.mockResolvedValue({
        data: events,
        error: null
      });

      const result = await getRecentLifeEvents();

      const categories = result.map(e => e.category);
      expect(categories).toContain("personal");
      expect(categories).toContain("family");
      expect(categories).toContain("social");
      expect(categories).toContain("work");
    });
  });
});
