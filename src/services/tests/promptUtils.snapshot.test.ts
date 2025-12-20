// src/services/tests/promptUtils.snapshot.test.ts
/**
 * Snapshot Tests for System Prompt Integrity
 *
 * These tests capture the FULL output of all prompt builders.
 * They serve as a "golden master" during refactoring to ensure
 * the output remains byte-for-byte identical.
 *
 * CRITICAL: If any snapshot test fails during refactoring,
 * it means the prompt output has changed. Investigate carefully
 * before updating snapshots.
 *
 * Usage:
 * - Run: npm test -- --run -t "snapshot"
 * - Update snapshots: npm test -- --run -t "snapshot" -u
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";

// ============================================
// DETERMINISTIC DATE MOCKING
// ============================================
// Mock Date to ensure consistent snapshots regardless of when tests run
const MOCK_DATE = new Date("2025-01-15T14:30:00.000Z"); // Wednesday, Jan 15, 2025, 2:30 PM UTC

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MOCK_DATE);
});

afterAll(() => {
  vi.useRealTimers();
});

// ============================================
// SERVICE MOCKS
// ============================================

// Mock Supabase client before any imports
vi.mock("../supabaseClient", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(function () {
          return this;
        }),
        order: vi.fn(function () {
          return this;
        }),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        then: vi.fn((resolve: any) =>
          Promise.resolve({ data: [], error: null }).then(resolve)
        ),
      })),
      insert: vi.fn(() => ({
        then: vi.fn((resolve: any) =>
          Promise.resolve({ data: null, error: null }).then(resolve)
        ),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          then: vi.fn((resolve: any) =>
            Promise.resolve({ data: null, error: null }).then(resolve)
          ),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          then: vi.fn((resolve: any) =>
            Promise.resolve({ data: null, error: null }).then(resolve)
          ),
        })),
      })),
    })),
    rpc: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  },
}));

// Mock relationship service
vi.mock("../relationshipService", () => ({
  getIntimacyContextForPrompt: vi.fn(() => "Intimacy context: moderate closeness"),
  getIntimacyContextForPromptAsync: vi.fn(() =>
    Promise.resolve("Intimacy context: moderate closeness")
  ),
  RelationshipMetrics: {},
}));

// Mock callbackDirector
vi.mock("../callbackDirector", () => ({
  formatCallbackForPrompt: vi.fn(() => "[Callback: None scheduled]"),
}));

// Mock ongoingThreads
vi.mock("../ongoingThreads", () => ({
  formatThreadsForPrompt: vi.fn(() => "[Threads: Thinking about tech trends]"),
  formatThreadsForPromptAsync: vi.fn(() =>
    Promise.resolve("[Threads: Thinking about tech trends]")
  ),
  formatThreadsFromData: vi.fn(() => "[Threads: Thinking about tech trends]"),
}));

// Mock stateService
vi.mock("../stateService", () => ({
  getFullCharacterContext: vi.fn(() =>
    Promise.resolve({
      mood_state: { energy: 70, social_battery: 65 },
      emotional_momentum: { current_mood: "content", streak_count: 3 },
      ongoing_threads: [],
    })
  ),
}));

// Mock moodKnobs with deterministic values
vi.mock("../moodKnobs", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const mockMoodKnobs = {
    patienceDecay: "slow" as const,
    warmthAvailability: "neutral" as const,
    socialBattery: 65,
    flirtThreshold: 0.5,
    curiosityDepth: "moderate" as const,
    initiationRate: 0.5,
    verbosity: 0.6,
  };
  return {
    ...actual,
    formatMoodKnobsForPrompt: vi.fn(
      () => `
[MOOD KNOBS: patience=slow, warmth=neutral, battery=65%, curiosity=moderate]`
    ),
    calculateMoodKnobs: vi.fn(() => mockMoodKnobs),
    calculateMoodKnobsFromState: vi.fn(() => mockMoodKnobs),
    getMoodKnobsAsync: vi.fn(() => Promise.resolve(mockMoodKnobs)),
  };
});

// Mock presenceDirector
vi.mock("../presenceDirector", () => ({
  getPresenceContext: vi.fn(() =>
    Promise.resolve({
      promptSection: "[PRESENCE: Available, relaxed mood]",
      openLoops: [],
      opinions: [],
    })
  ),
  getCharacterOpinions: vi.fn(() => [
    {
      topic: "AI technology",
      sentiment: "Excited but thoughtful",
      category: "likes",
      canMention: true,
    },
  ]),
  findRelevantOpinion: vi.fn(() => null),
}));

// Mock newsService
vi.mock("../newsService", () => ({
  getRecentNewsContext: vi.fn(() => "[NEWS: No recent news context]"),
}));

// Mock characterFactsService
vi.mock("../characterFactsService", () => ({
  formatCharacterFactsForPrompt: vi.fn(() => "[CHARACTER FACTS: Standard profile]"),
}));

// Mock actionKeyMapper
vi.mock("../../utils/actionKeyMapper", () => ({
  getActionKeysForPrompt: vi.fn(
    (actions) =>
      actions?.map((a: any) => a.name.toLowerCase().replace(/\s+/g, "_")).join(", ") ||
      ""
  ),
}));

// Mock localStorage and sessionStorage
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

Object.defineProperty(global, "localStorage", { value: localStorageMock });
Object.defineProperty(global, "sessionStorage", { value: sessionStorageMock });

// ============================================
// IMPORTS (after mocks)
// ============================================

import {
  buildSystemPrompt,
  buildGreetingPrompt,
  buildProactiveThreadPrompt,
  getTierBehaviorPrompt,
  buildComfortableImperfectionPrompt,
  getSelfieRulesConfig,
  buildDynamicDimensionEffects,
  buildSelfieRulesPrompt,
  UNCERTAINTY_RESPONSES,
  BRIEF_RESPONSE_EXAMPLES,
} from "../promptUtils";
import type { CharacterProfile, Task } from "../../types";
import type { RelationshipMetrics } from "../relationshipService";
import type { OngoingThread } from "../ongoingThreads";

// ============================================
// TEST FIXTURES
// ============================================

const mockCharacter: CharacterProfile = {
  id: "test-char-snapshot",
  createdAt: MOCK_DATE.getTime(),
  name: "Kayley Adams",
  displayName: "Kayley",
  image: {
    file: new File([], "test.png"),
    base64: "base64data",
    mimeType: "image/png",
  },
  idleVideoUrls: [],
  actions: [
    {
      id: "action-talking",
      name: "Talking",
      phrases: ["talk", "speaking"],
      video: new Blob(),
      videoPath: "/videos/talking.mp4",
    },
    {
      id: "action-confused",
      name: "Confused",
      phrases: ["confused", "what"],
      video: new Blob(),
      videoPath: "/videos/confused.mp4",
    },
  ],
};

// Friend relationship (middle tier)
const friendRelationship: RelationshipMetrics = {
  id: "rel-friend",
  relationshipScore: 35,
  warmthScore: 8,
  trustScore: 6,
  playfulnessScore: 7,
  stabilityScore: 5,
  relationshipTier: "friend",
  familiarityStage: "developing",
  totalInteractions: 25,
  positiveInteractions: 20,
  negativeInteractions: 3,
  firstInteractionAt: new Date(MOCK_DATE.getTime() - 7 * 24 * 60 * 60 * 1000),
  lastInteractionAt: new Date(MOCK_DATE.getTime() - 1 * 60 * 60 * 1000),
  isRuptured: false,
  lastRuptureAt: null,
  ruptureCount: 0,
};

// Stranger/acquaintance relationship
const strangerRelationship: RelationshipMetrics = {
  id: "rel-stranger",
  relationshipScore: 0,
  warmthScore: 0,
  trustScore: 0,
  playfulnessScore: 0,
  stabilityScore: 0,
  relationshipTier: "acquaintance",
  familiarityStage: "early",
  totalInteractions: 1,
  positiveInteractions: 0,
  negativeInteractions: 0,
  firstInteractionAt: MOCK_DATE,
  lastInteractionAt: MOCK_DATE,
  isRuptured: false,
  lastRuptureAt: null,
  ruptureCount: 0,
};

// Close friend relationship
const closeFriendRelationship: RelationshipMetrics = {
  id: "rel-close",
  relationshipScore: 75,
  warmthScore: 18,
  trustScore: 16,
  playfulnessScore: 14,
  stabilityScore: 12,
  relationshipTier: "close_friend",
  familiarityStage: "established",
  totalInteractions: 150,
  positiveInteractions: 140,
  negativeInteractions: 5,
  firstInteractionAt: new Date(MOCK_DATE.getTime() - 60 * 24 * 60 * 60 * 1000),
  lastInteractionAt: new Date(MOCK_DATE.getTime() - 30 * 60 * 1000),
  isRuptured: false,
  lastRuptureAt: null,
  ruptureCount: 0,
};

// Adversarial relationship
const adversarialRelationship: RelationshipMetrics = {
  id: "rel-adversarial",
  relationshipScore: -25,
  warmthScore: -12,
  trustScore: -8,
  playfulnessScore: -5,
  stabilityScore: -10,
  relationshipTier: "adversarial",
  familiarityStage: "developing",
  totalInteractions: 15,
  positiveInteractions: 2,
  negativeInteractions: 10,
  firstInteractionAt: new Date(MOCK_DATE.getTime() - 14 * 24 * 60 * 60 * 1000),
  lastInteractionAt: new Date(MOCK_DATE.getTime() - 2 * 24 * 60 * 60 * 1000),
  isRuptured: true,
  lastRuptureAt: new Date(MOCK_DATE.getTime() - 3 * 24 * 60 * 60 * 1000),
  ruptureCount: 2,
};

// Deeply loving relationship
const deeplyLovingRelationship: RelationshipMetrics = {
  id: "rel-loving",
  relationshipScore: 95,
  warmthScore: 25,
  trustScore: 22,
  playfulnessScore: 18,
  stabilityScore: 20,
  relationshipTier: "deeply_loving",
  familiarityStage: "established",
  totalInteractions: 500,
  positiveInteractions: 480,
  negativeInteractions: 10,
  firstInteractionAt: new Date(MOCK_DATE.getTime() - 180 * 24 * 60 * 60 * 1000),
  lastInteractionAt: new Date(MOCK_DATE.getTime() - 10 * 60 * 1000),
  isRuptured: false,
  lastRuptureAt: null,
  ruptureCount: 1,
};

const mockTasks: Task[] = [
  { id: "task-1", text: "Buy groceries", completed: false, priority: "medium" },
  { id: "task-2", text: "Call mom", completed: true, priority: "high" },
];

const mockCalendarEvents = [
  {
    id: "event-1",
    summary: "Team standup",
    start: { dateTime: new Date(MOCK_DATE.getTime() + 2 * 60 * 60 * 1000).toISOString() },
  },
];

const mockProactiveThread: OngoingThread = {
  id: "thread-1",
  userId: "user-123",
  topic: "tech-trends",
  currentState: "Thinking about how AI is changing creative work",
  emotionalValence: 0.6,
  salience: 0.7,
  isActive: true,
  decayRate: 0.1,
  createdAt: MOCK_DATE.toISOString(),
  lastUpdatedAt: MOCK_DATE.toISOString(),
  userRelated: false,
  userTrigger: null,
};

const mockUserRelatedThread: OngoingThread = {
  id: "thread-2",
  userId: "user-123",
  topic: "user-job",
  currentState: "Wondering how their job interview went",
  emotionalValence: 0.8,
  salience: 0.9,
  isActive: true,
  decayRate: 0.05,
  createdAt: MOCK_DATE.toISOString(),
  lastUpdatedAt: MOCK_DATE.toISOString(),
  userRelated: true,
  userTrigger: "I have a big job interview tomorrow, I'm so nervous!",
};

// ============================================
// SNAPSHOT TESTS
// ============================================

describe("Prompt Snapshot Tests - Golden Master", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  // ============================================
  // buildSystemPrompt Snapshots
  // ============================================
  describe("buildSystemPrompt", () => {
    it("should match snapshot for friend relationship", async () => {
      const prompt = await buildSystemPrompt(
        mockCharacter,
        friendRelationship,
        [], // no calendar events
        "Just finished editing a video", // characterContext
        [], // no tasks
        null, // relationshipSignals
        null, // toneIntent
        null, // fullIntent
        "test-user-id",
        "America/Chicago"
      );

      expect(prompt).toMatchSnapshot("buildSystemPrompt-friend");
    });

    it("should match snapshot for stranger relationship", async () => {
      const prompt = await buildSystemPrompt(
        mockCharacter,
        strangerRelationship,
        [],
        "Scrolling through social media",
        [],
        null,
        null,
        null,
        "test-user-id",
        "America/Chicago"
      );

      expect(prompt).toMatchSnapshot("buildSystemPrompt-stranger");
    });

    it("should match snapshot with calendar events and tasks", async () => {
      const prompt = await buildSystemPrompt(
        mockCharacter,
        friendRelationship,
        mockCalendarEvents,
        "Getting ready for a meeting",
        mockTasks,
        null,
        null,
        null,
        "test-user-id",
        "America/Chicago"
      );

      expect(prompt).toMatchSnapshot("buildSystemPrompt-with-events-tasks");
    });

    it("should match snapshot for close friend relationship", async () => {
      const prompt = await buildSystemPrompt(
        mockCharacter,
        closeFriendRelationship,
        [],
        "Relaxing at home",
        [],
        null,
        null,
        null,
        "test-user-id",
        "America/Chicago"
      );

      expect(prompt).toMatchSnapshot("buildSystemPrompt-close-friend");
    });

    it("should match snapshot for adversarial relationship", async () => {
      const prompt = await buildSystemPrompt(
        mockCharacter,
        adversarialRelationship,
        [],
        "Not in the best mood",
        [],
        null,
        null,
        null,
        "test-user-id",
        "America/Chicago"
      );

      expect(prompt).toMatchSnapshot("buildSystemPrompt-adversarial");
    });

    it("should match snapshot for deeply loving relationship", async () => {
      const prompt = await buildSystemPrompt(
        mockCharacter,
        deeplyLovingRelationship,
        [],
        "Missing my favorite person",
        [],
        null,
        null,
        null,
        "test-user-id",
        "America/Chicago"
      );

      expect(prompt).toMatchSnapshot("buildSystemPrompt-deeply-loving");
    });

    it("should match snapshot with no relationship (first meeting)", async () => {
      const prompt = await buildSystemPrompt(
        mockCharacter,
        null, // no relationship
        [],
        "Just chilling",
        [],
        null,
        null,
        null,
        "test-user-id",
        "America/Chicago"
      );

      expect(prompt).toMatchSnapshot("buildSystemPrompt-no-relationship");
    });
  });

  // ============================================
  // buildGreetingPrompt Snapshots
  // ============================================
  describe("buildGreetingPrompt", () => {
    it("should match snapshot for first meeting (no relationship)", () => {
      const prompt = buildGreetingPrompt(null, false, null, null, null);
      expect(prompt).toMatchSnapshot("greeting-first-meeting");
    });

    it("should match snapshot for stranger with known name", () => {
      const prompt = buildGreetingPrompt(strangerRelationship, true, "Alex", null, null);
      expect(prompt).toMatchSnapshot("greeting-stranger-named");
    });

    it("should match snapshot for friend", () => {
      const prompt = buildGreetingPrompt(friendRelationship, true, "Alex", null, null);
      expect(prompt).toMatchSnapshot("greeting-friend");
    });

    it("should match snapshot for close friend with open loop", () => {
      const openLoop = {
        id: "loop-1",
        topic: "job interview",
        triggerContext: "I have a big interview tomorrow",
        suggestedFollowup: "How did your interview go?",
        salience: 0.9,
        createdAt: MOCK_DATE.toISOString(),
        expiresAt: new Date(MOCK_DATE.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const prompt = buildGreetingPrompt(closeFriendRelationship, true, "Alex", openLoop, null);
      expect(prompt).toMatchSnapshot("greeting-close-friend-open-loop");
    });

    it("should match snapshot for adversarial relationship", () => {
      const prompt = buildGreetingPrompt(adversarialRelationship, true, "Alex", null, null);
      expect(prompt).toMatchSnapshot("greeting-adversarial");
    });

    it("should match snapshot for deeply loving relationship", () => {
      const prompt = buildGreetingPrompt(deeplyLovingRelationship, true, "Love", null, null);
      expect(prompt).toMatchSnapshot("greeting-deeply-loving");
    });

    it("should match snapshot with proactive thread", () => {
      const prompt = buildGreetingPrompt(
        friendRelationship,
        true,
        "Alex",
        null,
        mockProactiveThread
      );
      expect(prompt).toMatchSnapshot("greeting-friend-proactive-thread");
    });

    it("should match snapshot for early relationship (1-10 interactions)", () => {
      const earlyRelationship: RelationshipMetrics = {
        ...strangerRelationship,
        totalInteractions: 5,
      };
      const prompt = buildGreetingPrompt(earlyRelationship, true, "Alex", null, null);
      expect(prompt).toMatchSnapshot("greeting-early-relationship");
    });
  });

  // ============================================
  // buildProactiveThreadPrompt Snapshots
  // ============================================
  describe("buildProactiveThreadPrompt", () => {
    it("should match snapshot for autonomous thread", () => {
      const prompt = buildProactiveThreadPrompt(mockProactiveThread);
      expect(prompt).toMatchSnapshot("proactive-autonomous-thread");
    });

    it("should match snapshot for user-related thread", () => {
      const prompt = buildProactiveThreadPrompt(mockUserRelatedThread);
      expect(prompt).toMatchSnapshot("proactive-user-related-thread");
    });
  });

  // ============================================
  // Helper Function Snapshots
  // ============================================
  describe("Helper Functions", () => {
    it("getTierBehaviorPrompt should match snapshot for each tier", () => {
      const tiers = [
        "adversarial",
        "rival",
        "neutral_negative",
        "acquaintance",
        "friend",
        "close_friend",
        "deeply_loving",
        undefined, // default case
      ];

      tiers.forEach((tier) => {
        const prompt = getTierBehaviorPrompt(tier);
        expect(prompt).toMatchSnapshot(`tier-behavior-${tier ?? "undefined"}`);
      });
    });

    it("buildComfortableImperfectionPrompt should match snapshot", () => {
      const prompt = buildComfortableImperfectionPrompt();
      expect(prompt).toMatchSnapshot("comfortable-imperfection");
    });

    it("buildSelfieRulesPrompt should match snapshot for friend", () => {
      const prompt = buildSelfieRulesPrompt(friendRelationship);
      expect(prompt).toMatchSnapshot("selfie-rules-friend");
    });

    it("buildSelfieRulesPrompt should match snapshot for stranger", () => {
      const prompt = buildSelfieRulesPrompt(strangerRelationship);
      expect(prompt).toMatchSnapshot("selfie-rules-stranger");
    });

    it("buildSelfieRulesPrompt should match snapshot for no relationship", () => {
      const prompt = buildSelfieRulesPrompt(null);
      expect(prompt).toMatchSnapshot("selfie-rules-null");
    });

    it("buildDynamicDimensionEffects should match snapshot for high warmth", () => {
      const highWarmthRelationship: RelationshipMetrics = {
        ...friendRelationship,
        warmthScore: 20,
      };
      const prompt = buildDynamicDimensionEffects(highWarmthRelationship);
      expect(prompt).toMatchSnapshot("dimension-effects-high-warmth");
    });

    it("buildDynamicDimensionEffects should match snapshot for low trust", () => {
      const lowTrustRelationship: RelationshipMetrics = {
        ...friendRelationship,
        trustScore: -15,
      };
      const prompt = buildDynamicDimensionEffects(lowTrustRelationship);
      expect(prompt).toMatchSnapshot("dimension-effects-low-trust");
    });

    it("buildDynamicDimensionEffects should match snapshot for moderate values", () => {
      const prompt = buildDynamicDimensionEffects(friendRelationship);
      expect(prompt).toMatchSnapshot("dimension-effects-moderate");
    });

    it("getSelfieRulesConfig should return correct config for each tier", () => {
      expect(getSelfieRulesConfig(null)).toMatchSnapshot("selfie-config-null");
      expect(getSelfieRulesConfig(strangerRelationship)).toMatchSnapshot(
        "selfie-config-stranger"
      );
      expect(getSelfieRulesConfig(friendRelationship)).toMatchSnapshot("selfie-config-friend");
      expect(getSelfieRulesConfig(closeFriendRelationship)).toMatchSnapshot(
        "selfie-config-close-friend"
      );
    });
  });

  // ============================================
  // Constants Snapshots
  // ============================================
  describe("Response Constants", () => {
    it("UNCERTAINTY_RESPONSES should match snapshot", () => {
      expect(UNCERTAINTY_RESPONSES).toMatchSnapshot("uncertainty-responses");
    });

    it("BRIEF_RESPONSE_EXAMPLES should match snapshot", () => {
      expect(BRIEF_RESPONSE_EXAMPLES).toMatchSnapshot("brief-response-examples");
    });
  });
});

// ============================================
// INTEGRITY CHECKS
// ============================================
describe("Prompt Integrity Checks", () => {
  it("buildSystemPrompt output should be deterministic", async () => {
    const prompt1 = await buildSystemPrompt(
      mockCharacter,
      friendRelationship,
      [],
      "Testing",
      [],
      null,
      null,
      null,
      "test-user",
      "America/Chicago"
    );

    const prompt2 = await buildSystemPrompt(
      mockCharacter,
      friendRelationship,
      [],
      "Testing",
      [],
      null,
      null,
      null,
      "test-user",
      "America/Chicago"
    );

    expect(prompt1).toBe(prompt2);
  });

  it("buildGreetingPrompt output should be deterministic", () => {
    const prompt1 = buildGreetingPrompt(friendRelationship, true, "Alex", null, null);
    const prompt2 = buildGreetingPrompt(friendRelationship, true, "Alex", null, null);

    expect(prompt1).toBe(prompt2);
  });

  it("buildSystemPrompt should produce substantial output", async () => {
    const prompt = await buildSystemPrompt(
      mockCharacter,
      friendRelationship,
      [],
      "Testing",
      [],
      null,
      null,
      null,
      "test-user",
      "America/Chicago"
    );

    // The prompt should be substantial (at least 10K characters based on current implementation)
    expect(prompt.length).toBeGreaterThan(10000);
  });

  it("buildSystemPrompt should contain critical sections", async () => {
    const prompt = await buildSystemPrompt(
      mockCharacter,
      friendRelationship,
      [],
      "Testing",
      [],
      null,
      null,
      null,
      "test-user",
      "America/Chicago"
    );

    // These sections MUST be present
    const criticalSections = [
      "IDENTITY ANCHOR",
      "ANTI-ASSISTANT MODE",
      "OUTPUT FORMAT",
      "CRITICAL OUTPUT RULES",
      "text_response",
      "action_id",
    ];

    criticalSections.forEach((section) => {
      expect(prompt).toContain(section);
    });
  });
});
