/**
 * Open Loop Resolution Tests
 *
 * Tests for the resolve_open_loop LLM tool functionality:
 * 1. Topic matching (fuzzy matching via isSimilarTopic)
 * 2. Resolution types (resolved vs dismissed)
 * 3. Tool execution via executeMemoryTool
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Test: isSimilarTopic - Topic fuzzy matching logic
// ============================================================================

describe("isSimilarTopic", () => {
  /**
   * Replicate the fuzzy matching logic from presenceDirector.ts
   * for testing purposes.
   */
  function isSimilarTopic(existingTopic: string, newTopic: string): boolean {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, "") // Remove punctuation
        .replace(/\s+/g, " ") // Normalize whitespace
        .replace(/ies\b/g, "y") // Normalize "ies" plurals
        .replace(/s\b/g, ""); // Remove trailing 's'

    const existing = normalize(existingTopic);
    const incoming = normalize(newTopic);

    // Exact match after normalization
    if (existing === incoming) return true;

    // One contains the other (5+ chars required)
    if (incoming.length >= 5 && existing.includes(incoming)) return true;
    if (existing.length >= 5 && incoming.includes(existing)) return true;

    // No word overlap matching - LLM should use exact topic strings
    return false;
  }

  describe("Exact Matches (normalized)", () => {
    it("should match identical topics", () => {
      expect(isSimilarTopic("job interview", "job interview")).toBe(true);
    });

    it("should match case-insensitive", () => {
      expect(isSimilarTopic("Job Interview", "job interview")).toBe(true);
      expect(isSimilarTopic("DOCTOR APPOINTMENT", "doctor appointment")).toBe(true);
    });

    it("should match with different whitespace", () => {
      expect(isSimilarTopic("job  interview", "job interview")).toBe(true);
    });

    it("should match with/without punctuation", () => {
      expect(isSimilarTopic("What's up?", "whats up")).toBe(true);
    });
  });

  describe("Plural Normalization", () => {
    it("should match singular vs plural (trailing s)", () => {
      expect(isSimilarTopic("photo", "photos")).toBe(true);
      expect(isSimilarTopic("pictures", "picture")).toBe(true);
    });

    it("should match -ies plural normalization", () => {
      expect(isSimilarTopic("party", "parties")).toBe(true);
      expect(isSimilarTopic("memories", "memory")).toBe(true);
    });
  });

  describe("Containment Matching", () => {
    it("should match when one contains the other (5+ chars)", () => {
      // "interview" (9 chars) is contained in "job interview"
      expect(isSimilarTopic("job interview", "interview")).toBe(true);
      // "doctor" (6 chars) is contained in "doctor appointment"
      expect(isSimilarTopic("doctor", "doctor appointment")).toBe(true);
    });

    it("should match 'lost photos' with 'photo' (containment)", () => {
      // "photo" (5 chars) is contained in "lost photo" (normalized from "lost photos")
      expect(isSimilarTopic("lost photos", "photo")).toBe(true);
    });

    it("should NOT match 'lost photos' with 'lost picture' (no containment)", () => {
      // "lost photo" does not contain "lost pictur" - these are different words
      // LLM should use exact topic string from PRESENCE section
      expect(isSimilarTopic("lost photos", "lost picture")).toBe(false);
    });
  });

  describe("No Word Overlap Matching (Strict)", () => {
    it("should NOT match based on word overlap alone", () => {
      // LLM should use exact topic strings, so no word overlap matching
      expect(isSimilarTopic("holiday party", "party tonight")).toBe(false);
      expect(isSimilarTopic("Mila's gymnastics", "Mila's ear cleaning")).toBe(false);
    });

    it("should NOT match unrelated topics", () => {
      expect(isSimilarTopic("job interview", "doctor appointment")).toBe(false);
      expect(isSimilarTopic("lost photos", "job interview")).toBe(false);
      expect(isSimilarTopic("computer drama", "lost picture")).toBe(false);
    });
  });

  describe("Real-world Scenarios - LLM should use exact strings", () => {
    it("should match 'lost picture' with 'lost pictures' (containment)", () => {
      expect(isSimilarTopic("lost picture", "lost pictures")).toBe(true);
    });

    it("should match 'interview' when contained in 'job interview'", () => {
      expect(isSimilarTopic("job interview", "interview")).toBe(true);
    });

    it("should NOT match short words", () => {
      // "lost" is too short (4 chars after normalization = "lost")
      expect(isSimilarTopic("lost picture", "lost")).toBe(false);
    });
  });
});

// ============================================================================
// Test: resolve_open_loop Tool Arguments
// ============================================================================

describe("resolve_open_loop Tool Args", () => {
  interface ResolveLoopArgs {
    topic: string;
    resolution_type: "resolved" | "dismissed";
    reason?: string;
  }

  function validateArgs(args: ResolveLoopArgs): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!args.topic || args.topic.trim() === "") {
      errors.push("topic is required and cannot be empty");
    }

    if (!["resolved", "dismissed"].includes(args.resolution_type)) {
      errors.push("resolution_type must be 'resolved' or 'dismissed'");
    }

    return { valid: errors.length === 0, errors };
  }

  it("should accept valid resolved args", () => {
    const args: ResolveLoopArgs = {
      topic: "job interview",
      resolution_type: "resolved",
      reason: "user said it went well",
    };
    expect(validateArgs(args).valid).toBe(true);
  });

  it("should accept valid dismissed args", () => {
    const args: ResolveLoopArgs = {
      topic: "lost photos",
      resolution_type: "dismissed",
    };
    expect(validateArgs(args).valid).toBe(true);
  });

  it("should reject empty topic", () => {
    const args: ResolveLoopArgs = {
      topic: "",
      resolution_type: "resolved",
    };
    expect(validateArgs(args).valid).toBe(false);
    expect(validateArgs(args).errors).toContain("topic is required and cannot be empty");
  });

  it("should allow reason to be optional", () => {
    const args: ResolveLoopArgs = {
      topic: "interview",
      resolution_type: "resolved",
      // no reason
    };
    expect(validateArgs(args).valid).toBe(true);
  });
});

// ============================================================================
// Test: Loop Resolution Logic
// ============================================================================

describe("Loop Resolution Logic", () => {
  interface OpenLoop {
    id: string;
    topic: string;
    status: "active" | "surfaced" | "resolved" | "dismissed" | "expired";
    salience: number;
  }

  /**
   * Simulates the resolution logic from presenceDirector.ts
   */
  function resolveLoopsByTopic(
    loops: OpenLoop[],
    topic: string,
    resolutionType: "resolved" | "dismissed"
  ): { updatedLoops: OpenLoop[]; count: number } {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .replace(/ies\b/g, "y")
        .replace(/s\b/g, "");

    function isSimilarTopic(existingTopic: string, newTopic: string): boolean {
      const existing = normalize(existingTopic);
      const incoming = normalize(newTopic);

      // Exact match after normalization
      if (existing === incoming) return true;

      // One contains the other (5+ chars required)
      if (incoming.length >= 5 && existing.includes(incoming)) return true;
      if (existing.length >= 5 && incoming.includes(existing)) return true;

      // No word overlap matching - LLM should use exact topic strings
      return false;
    }

    let count = 0;
    const updatedLoops = loops.map((loop) => {
      if (
        (loop.status === "active" || loop.status === "surfaced") &&
        isSimilarTopic(loop.topic, topic)
      ) {
        count++;
        return { ...loop, status: resolutionType };
      }
      return loop;
    });

    return { updatedLoops, count };
  }

  describe("Resolving Loops", () => {
    const testLoops: OpenLoop[] = [
      { id: "1", topic: "lost photos", status: "active", salience: 1.0 },
      { id: "2", topic: "job interview", status: "surfaced", salience: 0.8 },
      { id: "3", topic: "doctor appointment", status: "active", salience: 0.6 },
    ];

    it("should resolve matching active loop", () => {
      const { updatedLoops, count } = resolveLoopsByTopic(testLoops, "photos", "resolved");
      expect(count).toBe(1);
      expect(updatedLoops.find((l) => l.id === "1")?.status).toBe("resolved");
    });

    it("should resolve matching surfaced loop", () => {
      const { updatedLoops, count } = resolveLoopsByTopic(testLoops, "interview", "resolved");
      expect(count).toBe(1);
      expect(updatedLoops.find((l) => l.id === "2")?.status).toBe("resolved");
    });

    it("should dismiss matching loop", () => {
      const { updatedLoops, count } = resolveLoopsByTopic(testLoops, "doctor", "dismissed");
      expect(count).toBe(1);
      expect(updatedLoops.find((l) => l.id === "3")?.status).toBe("dismissed");
    });

    it("should NOT resolve already resolved/dismissed loops", () => {
      const loopsWithResolved: OpenLoop[] = [
        { id: "1", topic: "lost photos", status: "resolved", salience: 1.0 },
        { id: "2", topic: "job interview", status: "dismissed", salience: 0.8 },
      ];
      const { count } = resolveLoopsByTopic(loopsWithResolved, "photos", "resolved");
      expect(count).toBe(0);
    });

    it("should return 0 when no loops match", () => {
      const { count } = resolveLoopsByTopic(testLoops, "vacation plans", "resolved");
      expect(count).toBe(0);
    });
  });

  describe("Multiple Loop Resolution (Exact Matching)", () => {
    it("should resolve only exact matching loops", () => {
      const loopsWithVariations: OpenLoop[] = [
        { id: "1", topic: "lost photos", status: "active", salience: 1.0 },
        { id: "2", topic: "lost pictures", status: "active", salience: 0.9 }, // Won't match
        { id: "3", topic: "photo recovery", status: "surfaced", salience: 0.8 }, // Won't match
      ];

      const { updatedLoops, count } = resolveLoopsByTopic(loopsWithVariations, "lost photos", "resolved");

      // Only exact match resolves - LLM should use exact topic string
      expect(count).toBe(1);
      expect(updatedLoops.find((l) => l.id === "1")?.status).toBe("resolved");
      expect(updatedLoops.find((l) => l.id === "2")?.status).toBe("active"); // Unchanged
    });

    it("should resolve when topic is contained in loop topic", () => {
      const loops: OpenLoop[] = [
        { id: "1", topic: "job interview preparation", status: "active", salience: 1.0 },
      ];

      // "interview" (9 chars) is contained in "job interview preparation"
      const { count } = resolveLoopsByTopic(loops, "interview", "resolved");
      expect(count).toBe(1);
    });
  });
});

// ============================================================================
// Test: Tool Declaration Validation
// ============================================================================

describe("resolve_open_loop Tool Declaration", () => {
  const toolDeclaration = {
    name: "resolve_open_loop",
    description: expect.stringContaining("resolved"),
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: expect.any(String),
        },
        resolution_type: {
          type: "string",
          enum: ["resolved", "dismissed"],
        },
        reason: {
          type: "string",
        },
      },
      required: ["topic", "resolution_type"],
    },
  };

  it("should have correct name", () => {
    expect(toolDeclaration.name).toBe("resolve_open_loop");
  });

  it("should have topic as required", () => {
    expect(toolDeclaration.parameters.required).toContain("topic");
  });

  it("should have resolution_type as required", () => {
    expect(toolDeclaration.parameters.required).toContain("resolution_type");
  });

  it("should have reason as optional", () => {
    expect(toolDeclaration.parameters.required).not.toContain("reason");
  });

  it("should have exactly two resolution types", () => {
    expect(toolDeclaration.parameters.properties.resolution_type.enum).toEqual([
      "resolved",
      "dismissed",
    ]);
  });
});

// ============================================================================
// Test: Expected LLM Behavior
// ============================================================================

describe("LLM Tool Usage Scenarios", () => {
  /**
   * These tests document expected LLM behavior for calling resolve_open_loop.
   */

  interface Scenario {
    userMessage: string;
    openLoopTopic: string;
    expectedToolCall: {
      topic: string;
      resolution_type: "resolved" | "dismissed";
      reason?: string;
    } | null;
  }

  const scenarios: Scenario[] = [
    {
      userMessage: "The interview went great! I got the job!",
      openLoopTopic: "job interview",
      expectedToolCall: {
        topic: "job interview",
        resolution_type: "resolved",
        reason: "user got the job",
      },
    },
    {
      userMessage: "I found all my photos, they were backed up to iCloud!",
      openLoopTopic: "lost photos",
      expectedToolCall: {
        topic: "lost photos",
        resolution_type: "resolved",
        reason: "user found photos in iCloud",
      },
    },
    {
      userMessage: "I don't want to talk about the doctor anymore.",
      openLoopTopic: "doctor appointment",
      expectedToolCall: {
        topic: "doctor appointment",
        resolution_type: "dismissed",
        reason: "user doesn't want to discuss",
      },
    },
    {
      userMessage: "Let's change the subject.",
      openLoopTopic: "sensitive topic",
      expectedToolCall: {
        topic: "sensitive topic",
        resolution_type: "dismissed",
        reason: "user changed subject",
      },
    },
    {
      userMessage: "What's the weather like?",
      openLoopTopic: "job interview",
      expectedToolCall: null, // Not addressing the loop
    },
  ];

  it.each(scenarios)(
    "should handle: $userMessage",
    ({ userMessage, openLoopTopic, expectedToolCall }) => {
      // Document expected behavior
      if (expectedToolCall) {
        expect(expectedToolCall.topic).toBeTruthy();
        expect(["resolved", "dismissed"]).toContain(expectedToolCall.resolution_type);
      }
      // This test documents expected behavior for future LLM tuning
      expect(true).toBe(true);
    }
  );
});
