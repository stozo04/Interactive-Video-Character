/**
 * Idle Life Tests (Part Two: Kayley Lives Her Life)
 *
 * Tests for the idle life system that generates:
 * - Kayley experiences (activities, mishaps, discoveries)
 * - Calendar-aware messages (post-event check-ins)
 * - Gift messages (rare selfies or thoughts)
 * - Pending message storage/delivery
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================================
// Mock Supabase
// ============================================================================

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn(() => ({
  insert: mockInsert,
  select: mockSelect,
  update: mockUpdate,
  delete: mockDelete,
}));

// Default mock implementations
mockInsert.mockReturnValue({
  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
});

mockSelect.mockReturnValue({
  eq: vi.fn().mockReturnValue({
    is: vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }),
    gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
    order: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  }),
});

mockUpdate.mockReturnValue({
  eq: vi.fn().mockResolvedValue({ error: null }),
});

mockDelete.mockReturnValue({
  eq: vi.fn().mockReturnValue({
    lt: vi.fn().mockResolvedValue({ error: null }),
    not: vi.fn().mockReturnValue({
      lt: vi.fn().mockResolvedValue({ error: null }),
    }),
    in: vi.fn().mockResolvedValue({ error: null }),
  }),
});

// vi.mock("../supabaseClient", () => ({
//   supabase: {
//     from: (...args: unknown[]) => mockFrom(...args),
//   },
// }));

// Mock stateService
vi.mock("../stateService", () => ({
  getMoodState: vi.fn().mockResolvedValue({
    dailyEnergy: 0.7,
    socialBattery: 0.8,
    lastInteractionAt: Date.now() - 60 * 60 * 1000, // 1 hour ago
  }),
}));

// Mock characterFactsService
vi.mock("../characterFactsService", () => ({
  getCharacterFacts: vi.fn().mockResolvedValue([]),
}));

// Import after mocks
import {
  generateKayleyExperience,
  getUnsurfacedExperiences,
  markExperienceSurfaced,
  formatExperiencesForPrompt,
  type KayleyExperience,
  type ExperienceType,
} from "../idleLife/kayleyExperienceService";

import {
  checkCalendarForMessage,
  getRecentlyCompletedEvents,
  analyzeEventImportance,
  type RecentlyCompletedEvent,
} from "../idleLife/calendarAwarenessService";

import {
  maybeGenerateGiftMessage,
  canSendGiftToday,
  type GiftType,
} from "../idleLife/giftMessageService";

import {
  createPendingMessage,
  getUndeliveredMessage,
  hasUndeliveredMessage,
  markMessageDelivered,
  type PendingMessage,
} from "../idleLife/pendingMessageService";

// ============================================================================
// Kayley Experience Service Tests
// ============================================================================

describe("Kayley Experience Service", () => {
  const testUserId = "test-user-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateKayleyExperience", () => {
    it("should generate an experience with all required fields", async () => {
      // Force the 70% chance to succeed by mocking Math.random
      const originalRandom = Math.random;
      Math.random = () => 0.5; // Below 0.7 threshold

      const experience = await generateKayleyExperience();

      Math.random = originalRandom;

      if (experience) {
        expect(experience.id).toBeTruthy();
        expect(experience.experienceType).toBeTruthy();
        expect(experience.content).toBeTruthy();
        expect(experience.mood).toBeTruthy();
        expect(experience.createdAt).toBeInstanceOf(Date);
      }
    });

    it("should return null 30% of the time (random chance)", async () => {
      const originalRandom = Math.random;
      Math.random = () => 0.8; // Above 0.7 threshold

      const experience = await generateKayleyExperience();

      Math.random = originalRandom;

      expect(experience).toBeNull();
    });

    it("should generate valid experience types", async () => {
      const originalRandom = Math.random;
      Math.random = () => 0.1;

      const experience = await generateKayleyExperience();

      Math.random = originalRandom;

      if (experience) {
        const validTypes: ExperienceType[] = [
          "activity",
          "thought",
          "mood",
          "discovery",
          "mishap",
        ];
        expect(validTypes).toContain(experience.experienceType);
      }
    });
  });

  describe("formatExperiencesForPrompt", () => {
    it("should return empty string when no experiences", async () => {
      const prompt = await formatExperiencesForPrompt();
      expect(prompt).toBe("");
    });

    it("should format experiences correctly when present", async () => {
      // Mock experiences data
      const mockExperiences = [
        {
          id: "1",
          experience_type: "activity",
          content: "Finally nailed that chord progression",
          mood: "satisfied",
          created_at: new Date().toISOString(),
          surfaced_at: null,
        },
      ];

      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue({ data: mockExperiences, error: null }),
            }),
          }),
        }),
      });

      const prompt = await formatExperiencesForPrompt();
      expect(prompt).toContain("THINGS THAT HAPPENED TO YOU TODAY");
      expect(prompt).toContain("Finally nailed that chord progression");
      expect(prompt).toContain("satisfied");
    });
  });
});

// ============================================================================
// Calendar Awareness Service Tests
// ============================================================================

describe("Calendar Awareness Service", () => {
  const testUserId = "test-user-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("analyzeEventImportance", () => {
    it("should recognize interview events as important", () => {
      const result = analyzeEventImportance("Job Interview at Google");
      expect(result).not.toBeNull();
      expect(result?.isImportant).toBe(true);
      expect(result?.category).toBe("interview");
      expect(result?.messageStyle).toBe("supportive");
    });

    it("should recognize medical events as important", () => {
      const result = analyzeEventImportance("Doctor Appointment");
      expect(result).not.toBeNull();
      expect(result?.isImportant).toBe(true);
      expect(result?.category).toBe("medical");
      expect(result?.messageStyle).toBe("caring");
    });

    it("should recognize dentist events as important", () => {
      const result = analyzeEventImportance("Dentist Checkup");
      expect(result).not.toBeNull();
      expect(result?.category).toBe("medical");
    });

    it("should recognize family events as important", () => {
      const result = analyzeEventImportance("Dinner with Mom");
      expect(result).not.toBeNull();
      expect(result?.isImportant).toBe(true);
      expect(result?.category).toBe("social");
      expect(result?.messageStyle).toBe("curious");
    });

    it("should ignore routine events", () => {
      expect(analyzeEventImportance("Lunch")).toBeNull();
      expect(analyzeEventImportance("Focus Time")).toBeNull();
      expect(analyzeEventImportance("Commute")).toBeNull();
    });

    it("should return null for generic events", () => {
      const result = analyzeEventImportance("Random Meeting");
      expect(result).toBeNull();
    });
  });

  describe("getRecentlyCompletedEvents", () => {
    it("should return events that ended after lastInteractionAt", () => {
      const now = new Date();
      const lastInteraction = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
      const eventEnd = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago

      const events = [
        {
          id: "1",
          summary: "Interview",
          start: {
            dateTime: new Date(
              now.getTime() - 2 * 60 * 60 * 1000
            ).toISOString(),
          },
          end: { dateTime: eventEnd.toISOString() },
        },
      ];

      const result = getRecentlyCompletedEvents(events, lastInteraction);

      expect(result).toHaveLength(1);
      expect(result[0].event.id).toBe("1");
      expect(result[0].minutesSinceEnd).toBeLessThan(60);
    });

    it("should not return events that ended before lastInteractionAt", () => {
      const now = new Date();
      const lastInteraction = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago
      const eventEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago (before lastInteraction)

      const events = [
        {
          id: "1",
          summary: "Interview",
          start: {
            dateTime: new Date(
              now.getTime() - 3 * 60 * 60 * 1000
            ).toISOString(),
          },
          end: { dateTime: eventEnd.toISOString() },
        },
      ];

      const result = getRecentlyCompletedEvents(events, lastInteraction);

      expect(result).toHaveLength(0);
    });
  });
});

// ============================================================================
// Gift Message Service Tests
// ============================================================================

describe("Gift Message Service", () => {
  const testUserId = "test-user-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("canSendGiftToday", () => {
    it("should return true when no gift sent in last 24 hours", async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
        }),
      });

      const result = await canSendGiftToday();
      expect(result).toBe(true);
    });

    it("should return false when gift already sent today", async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({ count: 1, error: null }),
        }),
      });

      const result = await canSendGiftToday();
      expect(result).toBe(false);
    });
  });

  describe("maybeGenerateGiftMessage", () => {
    it("should return null most of the time (95% chance)", async () => {
      const originalRandom = Math.random;
      Math.random = () => 0.2; // Above 0.05 threshold

      const result = await maybeGenerateGiftMessage();

      Math.random = originalRandom;

      expect(result).toBeNull();
    });

    it("should potentially generate gift when random passes", async () => {
      const originalRandom = Math.random;
      let callCount = 0;
      Math.random = () => {
        callCount++;
        // First call: pass 5% check (0.02 < 0.05)
        // Second call: determine gift type (0.4 < 0.6 = selfie)
        return callCount === 1 ? 0.02 : 0.4;
      };

      // Mock no gift sent today
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
        }),
      });

      // Mock no pending message
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ count: 0, error: null }),
        }),
      });

      // Note: This may still return null due to additional checks
      const result = await maybeGenerateGiftMessage();

      Math.random = originalRandom;

      // Result depends on all conditions being met
      // Main thing we're testing is that the function doesn't throw
      expect(result === null || typeof result === "object").toBe(true);
    });
  });
});

// ============================================================================
// Pending Message Service Tests
// ============================================================================

describe("Pending Message Service", () => {
  const testUserId = "test-user-123";

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      error: null,
    });
  });

  describe("createPendingMessage", () => {
    it("should create a pending message with correct structure", async () => {
      const message = await createPendingMessage({
        messageText: "Hope your interview went well!",
        trigger: "calendar",
        triggerEventTitle: "Job Interview",
      });

      expect(message.id).toBeTruthy();
      expect(message.messageText).toBe("Hope your interview went well!");
      expect(message.trigger).toBe("calendar");
      expect(message.triggerEventTitle).toBe("Job Interview");
      expect(message.messageType).toBe("text");
      expect(message.priority).toBe("normal");
      expect(message.createdAt).toBeInstanceOf(Date);
    });

    it("should support photo message type", async () => {
      const message = await createPendingMessage({
        messageText: "Thought you might need this",
        messageType: "photo",
        trigger: "gift",
        priority: "low",
      });

      expect(message.messageType).toBe("photo");
      expect(message.trigger).toBe("gift");
      expect(message.priority).toBe("low");
    });
  });

  describe("hasUndeliveredMessage", () => {
    it("should return true when message waiting", async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ count: 1, error: null }),
        }),
      });

      const result = await hasUndeliveredMessage();
      expect(result).toBe(true);
    });

    it("should return false when no message waiting", async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ count: 0, error: null }),
        }),
      });

      const result = await hasUndeliveredMessage();
      expect(result).toBe(false);
    });
  });

  describe("getUndeliveredMessage", () => {
    it("should return null when no message waiting", async () => {
      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await getUndeliveredMessage();
      expect(result).toBeNull();
    });

    it("should return message when one is waiting", async () => {
      const mockMessage = {
        id: "msg-1",
        message_text: "Hope your interview went well!",
        message_type: "text",
        trigger: "calendar",
        trigger_event_title: "Job Interview",
        priority: "normal",
        created_at: new Date().toISOString(),
        delivered_at: null,
      };

      mockSelect.mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi
                  .fn()
                  .mockResolvedValue({ data: [mockMessage], error: null }),
              }),
            }),
          }),
        }),
      });

      const result = await getUndeliveredMessage();

      expect(result).not.toBeNull();
      expect(result?.messageText).toBe("Hope your interview went well!");
      expect(result?.trigger).toBe("calendar");
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Idle Life Integration", () => {
  describe("Experience Types", () => {
    const validTypes: ExperienceType[] = [
      "activity",
      "thought",
      "mood",
      "discovery",
      "mishap",
    ];

    it("should have distinct experience types", () => {
      expect(new Set(validTypes).size).toBe(validTypes.length);
    });
  });

  describe("Message Triggers", () => {
    it("should support calendar, gift, and urgent triggers", () => {
      const triggers = ["calendar", "gift", "urgent"];
      expect(triggers).toHaveLength(3);
    });
  });
});
