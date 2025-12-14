// src/services/tests/systemPrompt.test.ts
/**
 * System Prompt Unit Tests
 * 
 * Comprehensive tests for buildSystemPrompt and related functions.
 * These tests ensure prompt structure is maintained during refactoring.
 * 
 * Critical for Phase 2 changes - these tests validate:
 * 1. Identity sections are present and correct
 * 2. JSON output format instructions are clear
 * 3. Relationship context is properly injected
 * 4. Semantic intent analysis is included
 * 5. Action keys are formatted correctly
 * 6. Negative constraints prevent LLM output issues
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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
  RelationshipMetrics: {},
}));

// Mock callbackDirector
vi.mock("../callbackDirector", () => ({
  formatCallbackForPrompt: vi.fn(() => ""),
}));

// Mock ongoingThreads
vi.mock("../ongoingThreads", () => ({
  formatThreadsForPrompt: vi.fn(() => ""),
}));

// Mock moodKnobs
vi.mock("../moodKnobs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    formatMoodKnobsForPrompt: vi.fn(() => ""),
    calculateMoodKnobs: vi.fn(() => ({
      patienceDecay: 'slow',
      warmthAvailability: 'neutral',
      socialBattery: 66,
      flirtThreshold: 0.5,
      curiosityDepth: 'moderate',
      initiationRate: 0.5,
      verbosity: 0.6,
    })),
  };
});

// Mock presenceDirector
vi.mock("../presenceDirector", () => ({
  getPresenceContext: vi.fn(() => null),
  getCharacterOpinions: vi.fn(() => []),
  findRelevantOpinion: vi.fn(() => null),
}));

// Mock actionKeyMapper
vi.mock("../../utils/actionKeyMapper", () => ({
  getActionKeysForPrompt: vi.fn((actions) => 
    actions.map((a: any) => a.name.toLowerCase().replace(/\s+/g, '_')).join(', ')
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

Object.defineProperty(global, 'localStorage', { value: localStorageMock });
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock });

import { buildSystemPrompt, buildGreetingPrompt } from "../promptUtils";
import type { CharacterProfile, Task } from "../../types";
import type { RelationshipMetrics } from "../relationshipService";

// Mock character profile
const mockCharacter: CharacterProfile = {
  id: "test-char-123",
  createdAt: Date.now(),
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
      id: "action-uuid-talking",
      name: "Talking",
      phrases: ["talk", "speaking"],
      video: new Blob(),
      videoPath: "/videos/talking.mp4",
    },
    {
      id: "action-uuid-confused",
      name: "Confused",
      phrases: ["confused", "what"],
      video: new Blob(),
      videoPath: "/videos/confused.mp4",
    },
    {
      id: "action-uuid-wave",
      name: "Wave Hello",
      phrases: ["hi", "hello"],
      video: new Blob(),
      videoPath: "/videos/wave.mp4",
    },
  ],
};

// Mock relationship metrics - matching actual RelationshipMetrics interface
const mockRelationship: RelationshipMetrics = {
  id: "rel-123",
  relationshipScore: 35,
  warmthScore: 5,
  trustScore: 3,
  playfulnessScore: 4,
  stabilityScore: 6,
  relationshipTier: "friend",
  familiarityStage: "developing",
  totalInteractions: 25,
  positiveInteractions: 20,
  negativeInteractions: 3,
  firstInteractionAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  lastInteractionAt: new Date(),
  isRuptured: false,
  lastRuptureAt: null,
  ruptureCount: 0,
};

const strangerRelationship: RelationshipMetrics = {
  id: "rel-456",
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
  firstInteractionAt: new Date(),
  lastInteractionAt: new Date(),
  isRuptured: false,
  lastRuptureAt: null,
  ruptureCount: 0,
};

describe("System Prompt - Core Structure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  // ============================================
  // Identity Section Tests
  // ============================================

  describe("Identity Section", () => {
    it("should produce a non-empty prompt", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(1000);
    });

    it("should include comfortable imperfection section", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("COMFORTABLE IMPERFECTION");
      expect(prompt).toContain("UNCERTAINTY IS ALLOWED");
    });

    it("should include character behavior guidance", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      // These sections exist in the current promptUtils.ts
      expect(prompt).toContain("SELECTIVE ATTENTION");
      expect(prompt).toContain("MOTIVATED FRICTION");
    });
  });

  // ============================================
  // JSON Output Format Tests
  // ============================================

  describe("JSON Output Format", () => {
    it("should include JSON format section", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("ACTIONS & JSON FORMAT");
    });

    it("should define required JSON fields", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("text_response");
      expect(prompt).toContain("action_id");
    });

    it("should explain action_id should be null 90% of the time", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("90%");
      expect(prompt).toContain("null");
    });

    it("should include calendar_action schema", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("calendar_action");
      expect(prompt).toContain("create");
      expect(prompt).toContain("delete");
    });

    it("should include task_action schema", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("task_action");
    });
  });

  // ============================================
  // Negative Constraint Tests (Phase 1)
  // ============================================

  describe("Negative Constraints (JSON Adherence)", () => {
    it("should include critical output rules at end", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("CRITICAL OUTPUT RULES");
    });

    it("should instruct to start with { and end with }", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("Start with '{'");
      expect(prompt).toContain("end with '}'");
    });

    it("should explicitly forbid preamble", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("NO PREAMBLE");
      expect(prompt).toContain("Sure!");
    });

    it("should forbid markdown code blocks", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("NO MARKDOWN");
      expect(prompt).toContain("```json");
    });

    it("should include quote escaping instructions", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("ESCAPE QUOTES");
      expect(prompt).toContain("\\\"");
    });

    it("should include example JSON format", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain('{"text_response"');
      expect(prompt).toContain('"action_id": null');
    });

    it("should have output rules near the end of the prompt", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      // The critical output rules should be in the last 25% of the prompt
      const criticalRulesIndex = prompt.indexOf("CRITICAL OUTPUT RULES");
      const promptLength = prompt.length;
      
      expect(criticalRulesIndex).toBeGreaterThan(0);
      expect(criticalRulesIndex / promptLength).toBeGreaterThan(0.75);
    });
  });

  // ============================================
  // Action Keys Tests (Phase 1)
  // ============================================

  describe("Action Keys (Simplified Format)", () => {
    it("should include available actions section when character has actions", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("Available Actions");
    });

    it("should NOT include full UUID objects in actions", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      // Should NOT have the old format with full UUID objects
      expect(prompt).not.toContain("action-uuid-talking");
      expect(prompt).not.toContain("action-uuid-confused");
    });

    it("should include simple action key names", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      // Should have simple key format
      expect(prompt).toContain("talking");
    });

    it("should include usage example for action_id", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain('"action_id"');
    });

    it("should not include actions section if character has no actions", () => {
      const characterNoActions = {
        ...mockCharacter,
        actions: [],
      };
      
      const prompt = buildSystemPrompt(characterNoActions, mockRelationship);
      
      expect(prompt).not.toContain("[Available Actions]");
    });
  });

  // ============================================
  // Relationship Context Tests
  // ============================================

  describe("Relationship Context", () => {
    it("should include relationship state section", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("RELATIONSHIP STATE");
    });

    it("should include relationship tier", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("friend");
    });

    it("should include warmth score", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("Warmth");
    });

    it("should include trust score", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("Trust");
    });

    it("should include tier behavior guidance", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("Tier behavior");
      expect(prompt).toContain("adversarial");
      expect(prompt).toContain("deeply_loving");
    });

    it("should differentiate between stranger and friend", () => {
      const strangerPrompt = buildSystemPrompt(mockCharacter, strangerRelationship);
      const friendPrompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(strangerPrompt).toContain("acquaintance");
      expect(friendPrompt).toContain("friend");
    });

    it("should handle null relationship gracefully", () => {
      const prompt = buildSystemPrompt(mockCharacter, null);
      
      // Should not throw, should have default handling
      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe("string");
    });
  });

  // ============================================
  // Tasks Context Tests
  // ============================================

  describe("Tasks Context", () => {
    const mockTasks: Task[] = [
      {
        id: "task-1",
        text: "Buy groceries",
        completed: false,
        createdAt: Date.now(),
        completedAt: null,
        priority: "high",
      },
      {
        id: "task-2",
        text: "Call mom",
        completed: true,
        createdAt: Date.now(),
        completedAt: Date.now(),
        priority: "medium",
      },
    ];

    it("should include daily checklist section when tasks exist", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship, [], undefined, mockTasks);
      
      expect(prompt).toContain("DAILY CHECKLIST");
    });

    it("should include task text in prompt", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship, [], undefined, mockTasks);
      
      expect(prompt).toContain("Buy groceries");
    });

    it("should differentiate completed and pending tasks", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship, [], undefined, mockTasks);
      
      // Should show completion status somehow
      expect(prompt).toContain("complete");
    });

    it("should handle empty tasks array", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship, [], undefined, []);
      
      expect(prompt).toContain("no tasks");
    });
  });

  // ============================================
  // Soul Layer Tests
  // ============================================

  describe("Soul Layer Components", () => {
    it("should include selective attention section", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("SELECTIVE ATTENTION");
    });

    it("should include comfortable imperfection section", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("COMFORTABLE IMPERFECTION");
    });

    it("should include motivated friction section", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("MOTIVATED FRICTION");
    });

    it("should include curiosity directive", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("CURIOSITY");
    });
  });

  // ============================================
  // Selfie/Image Generation Tests
  // ============================================

  describe("Selfie Generation Rules", () => {
    it("should include selfie rules section", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("SELFIE");
    });

    it("should explain selfies require relationship", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("RELATIONSHIP CHECK");
    });

    it("should include deflection examples for strangers", () => {
      const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
      
      expect(prompt).toContain("DEFLECTION");
    });
  });
});

// ============================================
// buildGreetingPrompt Tests
// ============================================

describe("buildGreetingPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("First Interaction Greetings", () => {
    it("should generate first-time greeting for new users", () => {
      const prompt = buildGreetingPrompt(null, false, null, null);
      
      expect(prompt).toContain("FIRST TIME");
    });

    it("should not ask for name immediately (per guidelines)", () => {
      const prompt = buildGreetingPrompt(null, false, null, null);
      
      expect(prompt).toContain("Don't immediately ask for their name");
    });

    it("should keep greeting short", () => {
      const prompt = buildGreetingPrompt(null, false, null, null);
      
      expect(prompt).toContain("under 12 words");
    });
  });

  describe("Returning User Greetings", () => {
    it("should generate warmer greeting for friends", () => {
      const prompt = buildGreetingPrompt(mockRelationship, true, "Alex", null);
      
      // Should use name and be more familiar
      expect(prompt).toContain("Alex");
    });

    it("should handle adversarial relationship", () => {
      const adversarialRelationship: RelationshipMetrics = {
        ...mockRelationship,
        relationshipTier: "adversarial",
        warmthScore: -15,
      };
      
      const prompt = buildGreetingPrompt(adversarialRelationship, true, null, null);
      
      expect(prompt).toContain("GUARDED");
    });
  });

  describe("Open Loop Integration", () => {
    it("should include open loop topic when provided", () => {
      // Full OpenLoop object matching the actual interface from presenceDirector
      const openLoop = {
        id: "loop-123",
        userId: "test-user",
        topic: "their job interview",
        suggestedFollowup: "How did the interview go?",
        loopType: "pending_event" as const,  // Use actual LoopType from presenceDirector
        createdAt: new Date(),
        status: "active" as const,
        salience: 0.8,
        surfaceCount: 0,
        maxSurfaces: 3,
      };
      
      const prompt = buildGreetingPrompt(mockRelationship, true, "Alex", openLoop);
      
      expect(prompt).toContain("job interview");

    });
  });
});

// ============================================
// Prompt Consistency Tests (Regression Prevention)
// ============================================

describe("Prompt Consistency (Regression Prevention)", () => {
  it("should always produce non-empty prompts", () => {
    const testCases = [
      buildSystemPrompt(),
      buildSystemPrompt(mockCharacter),
      buildSystemPrompt(mockCharacter, mockRelationship),
      buildSystemPrompt(mockCharacter, null),
      buildSystemPrompt(undefined, mockRelationship),
    ];
    
    testCases.forEach((prompt, i) => {
      expect(prompt.length).toBeGreaterThan(1000); // Reasonable minimum
      expect(typeof prompt).toBe("string");
    });
  });

  it("should be deterministic (same input = same output)", () => {
    const prompt1 = buildSystemPrompt(mockCharacter, mockRelationship);
    const prompt2 = buildSystemPrompt(mockCharacter, mockRelationship);
    
    expect(prompt1).toBe(prompt2);
  });

  it("should not contain JavaScript undefined serialization issues", () => {
    const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
    
    // Check only for patterns that indicate JavaScript's undefined being incorrectly serialized
    // Bad: ": undefined," (would break JSON) or stringified undefined in key places
    expect(prompt).not.toContain(": undefined,");
    expect(prompt).not.toContain(": undefined}");
    expect(prompt).not.toContain(": undefined]");
    // Note: The word "undefined" in instructional text is fine (e.g., "treat as UNDEFINED")
  });

  it("should not contain [object Object]", () => {
    const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
    
    expect(prompt).not.toContain("[object Object]");
  });

  it("should maintain section ordering: Identity -> Context -> Guidelines -> Output", () => {
    const prompt = buildSystemPrompt(mockCharacter, mockRelationship);
    
    const identityIndex = prompt.indexOf("YOUR IDENTITY");
    const relationshipIndex = prompt.indexOf("RELATIONSHIP STATE");
    const actionsIndex = prompt.indexOf("ACTIONS & JSON FORMAT");
    const outputRulesIndex = prompt.indexOf("CRITICAL OUTPUT RULES");
    
    expect(identityIndex).toBeLessThan(relationshipIndex);
    expect(relationshipIndex).toBeLessThan(actionsIndex);
    expect(actionsIndex).toBeLessThan(outputRulesIndex);
  });
});
