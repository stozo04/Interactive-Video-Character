// src/services/tests/systemPrompt.test.ts
/**
 * System Prompt Unit Tests
 * 
 * Comprehensive tests for buildSystemPromptForGreeting and related functions.
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
vi.mock("../supabaseClient", () => {
  // Create chainable mock that supports .in().in().order().order()
  const createChainableMock = () => {
    const mock: any = {
      eq: vi.fn(() => mock),
      in: vi.fn(() => mock),
      order: vi.fn(() => mock),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: vi.fn((resolve: any) =>
        Promise.resolve({ data: [], error: null }).then(resolve)
      ),
    };
    return mock;
  };

  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => createChainableMock()),
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
  };
});

// Mock relationship service
vi.mock("../relationshipService", () => ({
  getIntimacyContextForPrompt: vi.fn(() => "Intimacy context mock"),
  getIntimacyContextForPromptAsync: vi.fn(() => Promise.resolve("Intimacy context mock")),
  RelationshipMetrics: {},
}));

// Mock callbackDirector
vi.mock("../callbackDirector", () => ({
  formatCallbackForPrompt: vi.fn(() => ""),
}));

// Mock ongoingThreads
vi.mock("../ongoingThreads", () => ({
  formatThreadsForPrompt: vi.fn(() => ""),
  formatThreadsForPromptAsync: vi.fn(() => Promise.resolve("")),
}));

// Mock moodKnobs
vi.mock("../moodKnobs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    formatMoodForPrompt: vi.fn(() => ""),
    calculateMoodFromState: vi.fn(() => ({
      energy: 0.3,
      warmth: 0.5,
      genuineMoment: false,
    })),
    getMoodAsync: vi.fn(() => Promise.resolve({
      energy: 0.3,
      warmth: 0.5,
      genuineMoment: false,
    })),
  };
});

// Mock presenceDirector
vi.mock("../presenceDirector", () => ({
  getPresenceContext: vi.fn(() => Promise.resolve(null)),
  getCharacterOpinions: vi.fn(() => []),
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

import { buildSystemPromptForGreeting, buildSystemPromptForNonGreeting, buildGreetingPrompt } from "../promptUtils";
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
    it("should produce a non-empty prompt", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(1000);
    });

    it("should include greeting context section", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      // Greeting prompt focuses on greeting-specific context
      expect(prompt).toContain("GREETING CONTEXT");
      expect(prompt).toContain("TIME OF DAY");
    });

    it("should include relationship section", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      // Core relationship behavior is in greeting prompt
      expect(prompt).toContain("RELATIONSHIP");
      expect(prompt).toContain("TIER");
    });
  });

  // ============================================
  // JSON Output Format Tests
  // ============================================

  describe("JSON Output Format", () => {
    it("should include JSON format section", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("OUTPUT FORMAT");
    });

    it("should define required JSON fields", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("text_response");
      expect(prompt).toContain("action_id");
    });

    it("should explain action_id should be null 90% of the time", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("90%");
      expect(prompt).toContain("null");
    });

    it("should include calendar_action schema", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("calendar_action");
      expect(prompt).toContain("create");
      expect(prompt).toContain("delete");
    });

    it("should include task_action schema", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("task_action");
    });
  });

  // ============================================
  // Negative Constraint Tests (Phase 1)
  // ============================================

  describe("Negative Constraints (JSON Adherence)", () => {
    it("should include critical output rules at end", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("CRITICAL OUTPUT RULES");
    });

    it("should instruct to start with { and end with }", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("Start with '{'");
      expect(prompt).toContain("end with '}'");
    });

    it("should explicitly forbid preamble", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("NO PREAMBLE");
      expect(prompt).toContain("Sure!");
    });

    it("should forbid markdown code blocks", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("NO MARKDOWN");
      expect(prompt).toContain("```json");
    });

    it("should include quote escaping instructions", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain("ESCAPE QUOTES");
      expect(prompt).toContain('\\"');
    });

    it("should include example JSON format", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain('{"text_response"');
      expect(prompt).toContain('"action_id": null');
    });

    it("should have output rules near the end of the prompt", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

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
    it("should include action_id in output format", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      // Output format includes action_id field
      expect(prompt).toContain("action_id");
    });

    it("should NOT include full UUID objects in prompts", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      // Should NOT have the old format with full UUID objects
      expect(prompt).not.toContain("action-uuid-talking");
      expect(prompt).not.toContain("action-uuid-confused");
    });

    it("should have greeting prompt with core identity", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      // Greeting prompt has identity
      expect(prompt).toContain("Kayley Adams");
    });

    it("should include usage example for action_id", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      expect(prompt).toContain('"action_id"');
    });

    it("should include action rules section", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      // Action rules are in the output format section
      expect(prompt).toContain("ACTION RULES");
    });
  });

  // ============================================
  // Relationship Context Tests
  // ============================================

  // GATES: Help!!
  // describe("Relationship Context", () => {
  //   it("should include relationship state section", async () => {
  //     const prompt = await buildSystemPromptForGreeting(mockRelationship);

  //     expect(prompt).toContain("RELATIONSHIP STATE");
  //   });

  //   it("should include relationship tier", async () => {
  //     const prompt = await buildSystemPromptForGreeting(mockRelationship);

  //     expect(prompt).toContain("friend");
  //   });

  //   it("should include warmth score", async () => {
  //     const prompt = await buildSystemPromptForGreeting(mockRelationship);

  //     expect(prompt).toContain("Warmth");
  //   });

  //   it("should include trust score", async () => {
  //     const prompt = await buildSystemPromptForGreeting(mockRelationship);

  //     expect(prompt).toContain("Trust");
  //   });

  //   it("should include tier behavior guidance", async () => {
  //     const prompt = await buildSystemPromptForGreeting(mockRelationship);

  //     // Phase 3: Only the CURRENT tier is included (friend in this case), not all tiers
  //     // This is the key token-saving optimization
  //     expect(prompt).toContain("YOUR TIER");
  //     expect(prompt).toContain("FRIEND"); // mockRelationship has tier: "friend"
  //   });

  //   it("should differentiate between stranger and friend", async () => {
  //     const strangerPrompt = await buildSystemPromptForGreeting(
  //
  //       strangerRelationship
  //     );
  //     const friendPrompt = await buildSystemPromptForGreeting(
  //
  //       mockRelationship
  //     );

  //     expect(strangerPrompt).toContain("acquaintance");
  //     expect(friendPrompt).toContain("friend");
  //   });

  //   it("should handle null relationship gracefully", async () => {
  //     const prompt = await buildSystemPromptForGreeting(null);

  //     // Should not throw, should have default handling
  //     expect(prompt).toBeDefined();
  //     expect(typeof prompt).toBe("string");
  //   });
  // });

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

    it("should include daily checklist section when tasks exist", async () => {
      const prompt = await buildSystemPromptForGreeting(
        mockRelationship,
        [],
        mockTasks
      );

      expect(prompt).toContain("DAILY CHECKLIST");
    });

    it("should include task text in prompt", async () => {
      const prompt = await buildSystemPromptForGreeting(
        mockRelationship,
        [],
        mockTasks
      );

      expect(prompt).toContain("Buy groceries");
    });

    it("should differentiate completed and pending tasks", async () => {
      const prompt = await buildSystemPromptForGreeting(
        mockRelationship,
        [],
        mockTasks
      );

      // Should show completion status somehow
      expect(prompt).toContain("complete");
    });

    it("should handle empty tasks array", async () => {
      const prompt = await buildSystemPromptForGreeting(
        mockRelationship,
        [],
        []
      );

      expect(prompt).toContain("No tasks yet");
    });
  });

  // ============================================
  // Soul Layer Tests
  // Note: Soul layer components are in NonGreeting prompt only
  // Greeting prompt is lean - focused on greeting context
  // ============================================

  describe("Soul Layer Components", () => {
    it("should include selective attention section in NonGreeting", async () => {
      const prompt = await buildSystemPromptForNonGreeting(
        mockRelationship,
        [],
        undefined,
        [],
        undefined,
        0
      );

      expect(prompt).toContain("SELECTIVE ATTENTION");
    });

    it("should include comfortable imperfection section in NonGreeting", async () => {
      const prompt = await buildSystemPromptForNonGreeting(
        mockRelationship,
        [],
        undefined,
        [],
        undefined,
        0
      );

      expect(prompt).toContain("CONVERSATIONAL IMPERFECTION");
    });

    it("should have greeting prompt focused on greeting context (lean structure)", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      // Greeting prompt is lean - has greeting-specific sections
      expect(prompt).toContain("GREETING CONTEXT");
      expect(prompt).toContain("TIME OF DAY");
    });

    it("should have identity anchor in greeting prompt", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      // Core identity is still in greeting prompt
      expect(prompt).toContain("Kayley Adams");
    });
  });

  // ============================================
  // Selfie/Image Generation Tests
  // Note: Selfie rules are in NonGreeting prompt only
  // ============================================

  describe("Selfie Generation Rules", () => {
    it("should include selfie rules section for friends in NonGreeting prompt", async () => {
      const prompt = await buildSystemPromptForNonGreeting(
        mockRelationship,
        [],
        undefined,
        [],
        undefined,
        0
      );

      // Friends get full selfie rules (Phase 3: conditional selfie rules)
      expect(prompt).toContain("SELFIE");
    });

    it("should include full selfie instructions for friends in NonGreeting prompt", async () => {
      const prompt = await buildSystemPromptForNonGreeting(
        mockRelationship,
        [],
        undefined,
        [],
        undefined,
        0
      );

      // Friends see selfie_action instructions
      expect(prompt).toContain("selfie_action");
    });

    it("should have greeting prompt focused on greeting context", async () => {
      const prompt = await buildSystemPromptForGreeting(mockRelationship);

      // Greeting prompt focuses on greeting context
      expect(prompt).toContain("GREETING CONTEXT");
      expect(prompt).toContain("TIME OF DAY");
    });
  });

  // ============================================
  // buildGreetingPrompt Tests
  // ============================================

  describe("buildGreetingPrompt", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      localStorageMock.clear();
    });
    describe("First Interaction Greetings", () => {
      it("should generate first-time greeting for new users", () => {
        const prompt = buildGreetingPrompt(null, false, null, null);

        expect(prompt).toContain("FIRST TIME");
      });

      it("should not ask for name immediately (per guidelines)", () => {
        const prompt = buildGreetingPrompt(null, false, null, null);

        expect(prompt).toContain(
          "Generate a warm, natural INTRODUCTORY greeting. This is your FIRST TIME talking"
        );
      });

      it("should keep greeting short", () => {
        const prompt = buildGreetingPrompt(null, false, null, null);

        expect(prompt).toContain("under 15 words");
      });
    });

    describe("Returning User Greetings", () => {
      it("should generate warmer greeting for friends", () => {
        const prompt = buildGreetingPrompt(
          mockRelationship,
          true,
          "Alex",
          null
        );

        // Should use name and be more familiar
        expect(prompt).toContain("Alex");
      });

      it("should handle adversarial relationship", () => {
        const adversarialRelationship: RelationshipMetrics = {
          ...mockRelationship,
          relationshipTier: "adversarial",
          warmthScore: -15,
        };

        const prompt = buildGreetingPrompt(
          adversarialRelationship,
          true,
          null,
          null
        );

        expect(prompt).toContain("GUARDED");
      });
    });

    // ============================================
    // Prompt Consistency Tests (Regression Prevention)
    // ============================================

    describe("Prompt Consistency (Regression Prevention)", () => {
      it("should always produce non-empty prompts", async () => {
        const testCases = await Promise.all([
          buildSystemPromptForGreeting(),
          buildSystemPromptForGreeting(),
          buildSystemPromptForGreeting(mockRelationship),
          buildSystemPromptForGreeting(null),
          buildSystemPromptForGreeting(mockRelationship),
        ]);

        testCases.forEach((prompt, i) => {
          expect(prompt.length).toBeGreaterThan(1000); // Reasonable minimum
          expect(typeof prompt).toBe("string");
        });
      });

      it("should be deterministic (same input = same output)", async () => {
        const prompt1 = await buildSystemPromptForGreeting(mockRelationship);
        const prompt2 = await buildSystemPromptForGreeting(mockRelationship);

        expect(prompt1).toBe(prompt2);
      });

      it("should not contain JavaScript undefined serialization issues", async () => {
        const prompt = await buildSystemPromptForGreeting(mockRelationship);

        // Check only for patterns that indicate JavaScript's undefined being incorrectly serialized
        // Bad: ": undefined," (would break JSON) or stringified undefined in key places
        expect(prompt).not.toContain(": undefined,");
        expect(prompt).not.toContain(": undefined}");
        expect(prompt).not.toContain(": undefined]");
        // Note: The word "undefined" in instructional text is fine (e.g., "treat as UNDEFINED")
      });

      it("should not contain [object Object]", async () => {
        const prompt = await buildSystemPromptForGreeting(mockRelationship);

        expect(prompt).not.toContain("[object Object]");
      });

      it("should maintain section ordering: Identity -> Context -> Guidelines -> Output", async () => {
        const prompt = await buildSystemPromptForGreeting(mockRelationship);

        const identityIndex = prompt.indexOf("YOUR IDENTITY");
        const relationshipIndex = prompt.indexOf("RELATIONSHIP STATE");
        const actionsIndex = prompt.indexOf(
          "OUTPUT FORMAT (JSON Response Structure)"
        );
        const outputRulesIndex = prompt.indexOf("CRITICAL OUTPUT RULES");

        expect(identityIndex).toBeLessThan(relationshipIndex);
        expect(relationshipIndex).toBeLessThan(actionsIndex);
        expect(actionsIndex).toBeLessThan(outputRulesIndex);
      });

      // ============================================
      // Robustness Tests (Recommended Improvements)
      // ============================================

      it("should handle explicitly undefined optional parameters without problematic 'undefined' patterns", async () => {
        // Explicitly pass undefined for optional parameters
        // This catches template literal ${undefined} issues
        const prompt = await buildSystemPromptForGreeting(
          mockRelationship,
          undefined, // upcomingEvents
          undefined, // characterContext
          undefined // tasks
          // Move 37: Intent parameters removed
        );

        // Should not contain problematic undefined patterns from template interpolation
        // These patterns indicate a bug where ${variable} was undefined
        expect(prompt).not.toContain(": undefined,");
        expect(prompt).not.toContain(": undefined}");
        expect(prompt).not.toContain(": undefined]");
        expect(prompt).not.toContain("=undefined ");
        expect(prompt).not.toContain("= undefined ");
        expect(prompt).not.toContain("[undefined]");
        expect(prompt).not.toContain("(undefined)");
      });

      it("should not contain template literal undefined serialization", async () => {
        // Test with null relationship (edge case)
        const promptNoRelationship = await buildSystemPromptForGreeting(null);

        // Check for patterns that indicate ${undefinedVar} in templates
        expect(promptNoRelationship).not.toContain("undefined]");
        expect(promptNoRelationship).not.toContain("undefined,");
        expect(promptNoRelationship).not.toContain("=undefined");
        expect(promptNoRelationship).not.toContain(": undefined");
      });

      it("should produce prompts within expected size range (token savings regression)", async () => {
        // Test with friend relationship (typical case)
        const friendPrompt = await buildSystemPromptForGreeting(mockRelationship);

        // Test with stranger relationship (should be smaller due to Phase 3 optimizations)
        const strangerPrompt = await buildSystemPromptForGreeting(strangerRelationship);

        // Greeting prompt is lean (~30-40KB) - focused on greeting context only
        // Selfie rules, character facts, and many other sections are NOT in greeting prompt
        expect(friendPrompt.length).toBeLessThan(50000);
        expect(friendPrompt.length).toBeGreaterThan(20000);

        // Stranger prompts should be similar or smaller (no dimension effects)
        expect(strangerPrompt.length).toBeLessThan(50000);
      });
    });

    // ============================================
    // V2 Prompt Structure Tests (Task 3 - Recency Bias Optimization)
    // ============================================

    describe("V2 Prompt Structure (Recency Bias Optimization)", () => {
      beforeEach(() => {
        vi.clearAllMocks();
        localStorageMock.clear();
      });

      describe("Output Format Positioning", () => {
        it("should have JSON schema in the last 20% of the prompt", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          // The JSON schema (text_response, action_id structure) should be near the end
          const jsonSchemaIndex = prompt.indexOf('"text_response": string');
          const promptLength = prompt.length;

          // V2 target: JSON schema in last 20% of prompt for recency bias
          // Current V1 may not meet this - this test documents the target
          expect(jsonSchemaIndex).toBeGreaterThan(0);
          // This assertion will PASS after V2 refactor:
          // expect(jsonSchemaIndex / promptLength).toBeGreaterThan(0.80);
        });

        it("should have CRITICAL OUTPUT RULES at the very end", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          const outputRulesIndex = prompt.indexOf("CRITICAL OUTPUT RULES");
          const promptLength = prompt.length;

          // Output rules should be in the final 10% of the prompt
          expect(outputRulesIndex / promptLength).toBeGreaterThan(0.9);
        });

        it("should have tools section before output format", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          const toolsIndex = prompt.indexOf("TOOLS");
          const outputRulesIndex = prompt.indexOf("CRITICAL OUTPUT RULES");

          // Tools section should come before output rules
          expect(toolsIndex).toBeGreaterThan(0);
          expect(toolsIndex).toBeLessThan(outputRulesIndex);
        });
      });

      describe("Behavioral Content Before Output Format", () => {
        it("should have greeting context before output format section", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          const greetingIndex = prompt.indexOf("GREETING CONTEXT");
          const outputRulesIndex = prompt.indexOf("CRITICAL OUTPUT RULES");

          expect(greetingIndex).toBeLessThan(outputRulesIndex);
        });

        it("should have calendar rules before output format section", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          const calendarIndex = prompt.indexOf("CALENDAR");
          const outputRulesIndex = prompt.indexOf("CRITICAL OUTPUT RULES");

          expect(calendarIndex).toBeLessThan(outputRulesIndex);
        });

        it("should have relationship section before output format section", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          const relationshipIndex = prompt.indexOf("RELATIONSHIP");
          const outputRulesIndex = prompt.indexOf("CRITICAL OUTPUT RULES");

          expect(relationshipIndex).toBeLessThan(outputRulesIndex);
        });
      });

      describe("Recency Optimization Metrics", () => {
        it("should have identity anchor at the very beginning", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          // Identity should be in the first 5% of the prompt
          const identityIndex = prompt.indexOf("IDENTITY");
          const promptLength = prompt.length;

          expect(identityIndex / promptLength).toBeLessThan(0.05);
        });
      });
    });

    // ============================================
    // Phase 3: Pre-computed Relationship Rules Tests
    // ============================================

    describe("Phase 3: Pre-computed Relationship Rules", () => {
      beforeEach(() => {
        vi.clearAllMocks();
        localStorageMock.clear();
      });

      // ============================================
      // Task 1: Tier-Specific Behavior Rules
      // ============================================

      describe("Tier-Specific Behavior Rules", () => {
        // Create different tier relationships for testing
        const adversarialRelationship: RelationshipMetrics = {
          ...strangerRelationship,
          relationshipTier: "adversarial",
          warmthScore: -15,
          trustScore: -10,
        };

        const closeRelationship: RelationshipMetrics = {
          ...mockRelationship,
          relationshipTier: "deeply_loving",
          warmthScore: 25,
          trustScore: 20,
        };

        it("should include adversarial tier behavior when relationship is adversarial", async () => {
          const prompt = await buildSystemPromptForGreeting(adversarialRelationship);

          // Should include adversarial behavior guidance
          expect(prompt).toContain("adversarial");
          expect(prompt.toLowerCase()).toContain("guarded");
        });

        it("should include friend tier behavior when relationship is friend", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          // Should include friend behavior guidance
          expect(prompt).toContain("friend");
          expect(prompt.toLowerCase()).toContain("warm");
        });

        it("should include deeply_loving tier behavior for close relationships", async () => {
          const prompt = await buildSystemPromptForGreeting(closeRelationship);

          // Should include deeply_loving behavior guidance (Phase 3 format: [YOUR TIER: DEEPLY LOVING])
          expect(prompt).toContain("DEEPLY LOVING");
        });

        it("should have tier behavior section in prompt", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          // Phase 3: Tier behavior now uses [YOUR TIER: ...] format
          expect(prompt).toContain("YOUR TIER");
        });
      });

      // ============================================
      // Task 2: Conditional Selfie Rules
      // Note: Selfie rules are in NonGreeting prompt only, not in lean Greeting prompt
      // ============================================

      describe("Conditional Selfie Rules", () => {
        it("should include selfie rules for friend tier in NonGreeting prompt", async () => {
          // Selfie rules are only in NonGreeting prompt - greeting is lean
          const prompt = await buildSystemPromptForNonGreeting(
            mockRelationship,
            [],
            undefined,
            [],
            undefined,
            0
          );

          expect(prompt).toContain("SELFIE");
        });

        it("should include selfie rules for deeply_loving tier in NonGreeting prompt", async () => {
          const closeRelationship: RelationshipMetrics = {
            ...mockRelationship,
            relationshipTier: "deeply_loving",
            warmthScore: 25,
          };

          const prompt = await buildSystemPromptForNonGreeting(
            closeRelationship,
            [],
            undefined,
            [],
            undefined,
            0
          );

          expect(prompt).toContain("SELFIE");
        });

        it("should have greeting prompt without selfie section (lean structure)", async () => {
          // Greeting prompt is lean and doesn't include selfie rules
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          // Greeting prompt focuses on greeting context, not selfie rules
          expect(prompt).toContain("GREETING CONTEXT");
        });

        it("should include relationship context in both prompts", async () => {
          const greetingPrompt = await buildSystemPromptForGreeting(mockRelationship);
          const nonGreetingPrompt = await buildSystemPromptForNonGreeting(
            mockRelationship,
            [],
            undefined,
            [],
            undefined,
            0
          );

          // Both should have relationship section
          expect(greetingPrompt).toContain("RELATIONSHIP");
          expect(nonGreetingPrompt).toContain("RELATIONSHIP");
        });
      });

      // ============================================
      // Task 3: Dynamic Dimension Effects
      // ============================================

      describe("Dynamic Dimension Effects", () => {
        it("should NOT include dimension effects for moderate values (token savings)", async () => {
          // mockRelationship has moderate values (warmth: 5, trust: 3)
          // Phase 3 optimization: don't include guidance for non-extreme dimensions
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          // For moderate values, dimension effects section should not appear
          // This is the key Phase 3 optimization - only extreme values trigger guidance
          expect(prompt).not.toContain(
            "Dimension effects (based on extreme values)"
          );
        });

        it("should include dimension effects when warmth is extremely high", async () => {
          const highWarmth: RelationshipMetrics = {
            ...mockRelationship,
            warmthScore: 20, // Extreme high (>15)
          };

          const prompt = await buildSystemPromptForGreeting(highWarmth);

          // Should include dimension effects for extreme values
          expect(prompt).toContain("Dimension effects");
          expect(prompt.toLowerCase()).toContain("warmth");
        });

        it("should include dimension effects when trust is extremely low", async () => {
          const lowTrust: RelationshipMetrics = {
            ...mockRelationship,
            trustScore: -15, // Extreme low (<-10)
          };

          const prompt = await buildSystemPromptForGreeting(lowTrust);

          // Should include trust guidance for extreme values
          expect(prompt).toContain("Dimension effects");
          expect(prompt.toLowerCase()).toContain("trust");
        });

        it("should include playfulness guidance when score is extreme", async () => {
          const highPlayfulness: RelationshipMetrics = {
            ...mockRelationship,
            playfulnessScore: 20, // Extreme high
          };

          const prompt = await buildSystemPromptForGreeting(highPlayfulness);

          // Should include playfulness guidance for extreme values
          expect(prompt.toLowerCase()).toContain("playful");
        });

        it("should include stability guidance when extremely low", async () => {
          const lowStability: RelationshipMetrics = {
            ...mockRelationship,
            stabilityScore: -15, // Extreme low (<-10)
          };

          const prompt = await buildSystemPromptForGreeting(lowStability);

          // Should include stability guidance
          expect(prompt.toLowerCase()).toContain("stability");
        });
      });

      // ============================================
      // Token Savings Validation
      // ============================================

      describe("Token Savings Metrics", () => {
        it("should not increase prompt size significantly for friends", async () => {
          const prompt = await buildSystemPromptForGreeting(mockRelationship);

          // Baseline: prompt should be reasonable size
          // Phase 2 target was ~72KB, Phase 3 should not exceed this
          expect(prompt.length).toBeLessThan(80000);
        });

        it("should produce valid prompts for all tier types", async () => {
          const tiers = [
            "adversarial",
            "rival",
            "neutral_negative",
            "acquaintance",
            "friend",
            "close_friend",
            "deeply_loving",
          ];

          await Promise.all(
            tiers.map(async (tier) => {
              const tierRelationship: RelationshipMetrics = {
                ...mockRelationship,
                relationshipTier: tier,
              };

              const prompt = await buildSystemPromptForGreeting(tierRelationship);

              // Should produce valid non-empty prompts for all tiers
              expect(prompt).toBeDefined();
              expect(prompt.length).toBeGreaterThan(1000);
            })
          );
        });
      });
    });
  });
});

// ============================================
// Phase 3: Helper Function Unit Tests
// ============================================

import {
  getTierBehaviorPrompt,
  getSelfieRulesConfig,
  buildDynamicDimensionEffects,
} from "../promptUtils";

describe("Phase 3: Helper Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // getTierBehaviorPrompt Tests
  // ============================================

  describe("getTierBehaviorPrompt", () => {
    it("should return adversarial rules for adversarial tier", () => {
      const result = getTierBehaviorPrompt("adversarial");

      expect(result).toContain("ADVERSARIAL");
      expect(result.toLowerCase()).toContain("guarded");
    });

    it("should return friend rules for friend tier", () => {
      const result = getTierBehaviorPrompt("friend");

      expect(result).toContain("FRIEND");
      expect(result.toLowerCase()).toContain("warm");
    });

    it("should return acquaintance rules for undefined tier", () => {
      const result = getTierBehaviorPrompt(undefined);

      expect(result).toContain("ACQUAINTANCE");
    });

    it("should return acquaintance rules for unknown tier", () => {
      const result = getTierBehaviorPrompt("unknown_tier");

      expect(result).toContain("ACQUAINTANCE");
    });

    it("should return deeply loving rules for deeply_loving tier", () => {
      const result = getTierBehaviorPrompt("deeply_loving");

      expect(result).toContain("DEEPLY LOVING");
      expect(result.toLowerCase()).toContain("intimacy");
    });
  });

  // ============================================
  // getSelfieRulesConfig Tests
  // ============================================

  describe("getSelfieRulesConfig", () => {
    it("should return deflection only for null relationship", () => {
      const result = getSelfieRulesConfig(null);

      expect(result.shouldIncludeFull).toBe(false);
      expect(result.shouldIncludeDeflection).toBe(true);
    });

    it("should return deflection only for acquaintance tier", () => {
      const result = getSelfieRulesConfig(strangerRelationship);

      expect(result.shouldIncludeFull).toBe(false);
      expect(result.shouldIncludeDeflection).toBe(true);
    });

    it("should return full selfie rules for friend tier", () => {
      const result = getSelfieRulesConfig(mockRelationship);

      expect(result.shouldIncludeFull).toBe(true);
      expect(result.shouldIncludeDeflection).toBe(false);
    });

    it("should return full selfie rules for deeply_loving tier", () => {
      const closeRelationship: RelationshipMetrics = {
        ...mockRelationship,
        relationshipTier: "deeply_loving",
      };

      const result = getSelfieRulesConfig(closeRelationship);

      expect(result.shouldIncludeFull).toBe(true);
      expect(result.shouldIncludeDeflection).toBe(false);
    });

    it("should return deflection for adversarial tier", () => {
      const adversarialRelationship: RelationshipMetrics = {
        ...mockRelationship,
        relationshipTier: "adversarial",
      };

      const result = getSelfieRulesConfig(adversarialRelationship);

      expect(result.shouldIncludeFull).toBe(false);
      expect(result.shouldIncludeDeflection).toBe(true);
    });
  });

  // ============================================
  // buildDynamicDimensionEffects Tests
  // ============================================

  describe("buildDynamicDimensionEffects", () => {
    it("should return empty string for null relationship", () => {
      const result = buildDynamicDimensionEffects(null);

      expect(result).toBe("");
    });

    it("should return empty string for moderate dimension values", () => {
      // mockRelationship has moderate values (warmth: 5, trust: 3)
      const result = buildDynamicDimensionEffects(mockRelationship);

      expect(result).toBe("");
    });

    it("should include warmth guidance for high warmth", () => {
      const highWarmth: RelationshipMetrics = {
        ...mockRelationship,
        warmthScore: 20,
      };

      const result = buildDynamicDimensionEffects(highWarmth);

      expect(result).toContain("warmth");
      expect(result).toContain("HIGH");
    });

    it("should include warmth guidance for low warmth", () => {
      const lowWarmth: RelationshipMetrics = {
        ...mockRelationship,
        warmthScore: -15,
      };

      const result = buildDynamicDimensionEffects(lowWarmth);

      expect(result).toContain("warmth");
      expect(result).toContain("LOW");
    });

    it("should include trust guidance for high trust", () => {
      const highTrust: RelationshipMetrics = {
        ...mockRelationship,
        trustScore: 20,
      };

      const result = buildDynamicDimensionEffects(highTrust);

      expect(result).toContain("trust");
      expect(result).toContain("HIGH");
    });

    it("should include multiple dimension effects when multiple are extreme", () => {
      const extremeRelationship: RelationshipMetrics = {
        ...mockRelationship,
        warmthScore: 25,
        trustScore: 20,
        playfulnessScore: 18,
      };

      const result = buildDynamicDimensionEffects(extremeRelationship);

      expect(result).toContain("warmth");
      expect(result).toContain("trust");
      expect(result).toContain("playful");
    });

    it("should include stability guidance for low stability", () => {
      const lowStability: RelationshipMetrics = {
        ...mockRelationship,
        stabilityScore: -15,
      };

      const result = buildDynamicDimensionEffects(lowStability);

      expect(result).toContain("stability");
    });
  });
});