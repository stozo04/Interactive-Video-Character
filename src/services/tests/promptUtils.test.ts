// src/services/tests/promptUtils.test.ts
/**
 * Phase 3: Comfortable Imperfection Tests
 * 
 * Tests the uncertainty responses and brevity guidance added to the system prompt.
 * Verifies that Kayley is allowed to be uncertain, brief, and doesn't need
 * a follow-up question every time.
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

// Mock callbackDirector to avoid sessionStorage issues
vi.mock("../callbackDirector", () => ({
  formatCallbackForPrompt: vi.fn(() => ""),
}));

// Mock ongoingThreads
vi.mock("../ongoingThreads", () => ({
  formatThreadsForPromptAsync: vi.fn(() => Promise.resolve("")),
}));

// Mock moodKnobs for integration tests (but keep real exports available)
vi.mock("../moodKnobs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    formatMoodKnobsForPrompt: vi.fn(() => ""),
    calculateMoodKnobs: vi.fn(() => ({
      patienceDecay: 'slow',
      warmthAvailability: 'neutral',
      socialBattery: 66,
      flirtThreshold: 'cautious',
    })),
  };
});

// Mock localStorage and sessionStorage before imports
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

import {
  UNCERTAINTY_RESPONSES,
  BRIEF_RESPONSE_EXAMPLES,
  buildComfortableImperfectionPrompt,
  buildSystemPrompt,
} from "../promptUtils";

describe("Phase 3: Comfortable Imperfection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  // ============================================
  // UNCERTAINTY_RESPONSES Tests
  // ============================================
  
  describe("UNCERTAINTY_RESPONSES", () => {
    it("should export an array of uncertainty responses", () => {
      expect(Array.isArray(UNCERTAINTY_RESPONSES)).toBe(true);
      expect(UNCERTAINTY_RESPONSES.length).toBeGreaterThan(0);
    });

    it("should contain the specified uncertainty phrases from implementation plan", () => {
      const responses = [...UNCERTAINTY_RESPONSES];
      
      // Check for key phrases from the implementation plan
      expect(responses.some(r => r.includes("not sure what to say"))).toBe(true);
      expect(responses.some(r => r.includes("need to think about that"))).toBe(true);
      expect(responses.some(r => r.includes("don't have a smart take"))).toBe(true);
    });

    it("should have responses that feel human and authentic", () => {
      // Each response should be conversational, not robotic
      for (const response of UNCERTAINTY_RESPONSES) {
        // Should not contain robotic phrases
        expect(response.toLowerCase()).not.toContain("as an ai");
        expect(response.toLowerCase()).not.toContain("i cannot");
        expect(response.toLowerCase()).not.toContain("i am unable to");
        
        // Should be reasonably short (a real human pause, not an essay)
        expect(response.length).toBeLessThan(100);
      }
    });
  });

  // ============================================
  // BRIEF_RESPONSE_EXAMPLES Tests
  // ============================================
  
  describe("BRIEF_RESPONSE_EXAMPLES", () => {
    it("should export an array of brief response examples", () => {
      expect(Array.isArray(BRIEF_RESPONSE_EXAMPLES)).toBe(true);
      expect(BRIEF_RESPONSE_EXAMPLES.length).toBeGreaterThan(0);
    });

    it("should contain the specified brief response from implementation plan", () => {
      const responses = [...BRIEF_RESPONSE_EXAMPLES];
      
      // "That's really cool ✨" is specified in the implementation plan
      expect(responses.some(r => r.includes("really cool"))).toBe(true);
    });

    it("should have responses that are genuinely brief", () => {
      for (const response of BRIEF_RESPONSE_EXAMPLES) {
        // Brief responses should be under 20 characters or just a few words
        expect(response.length).toBeLessThan(25);
      }
    });

    it("should include variety of brief reactions", () => {
      const responses = [...BRIEF_RESPONSE_EXAMPLES];
      
      // Should have different types of brief responses
      const hasAffirmation = responses.some(r => 
        r.includes("Valid") || r.includes("Fair") || r.includes("Same")
      );
      const hasEnthusiasm = responses.some(r => 
        r.includes("cool") || r.includes("love") || r.includes("Ooh")
      );
      const hasEmoji = responses.some(r => 
        r.includes("✨") || r.includes("🤍")
      );
      
      expect(hasAffirmation).toBe(true);
      expect(hasEnthusiasm).toBe(true);
      expect(hasEmoji).toBe(true);
    });
  });

  // ============================================
  // buildComfortableImperfectionPrompt Tests
  // ============================================
  
  describe("buildComfortableImperfectionPrompt", () => {
    let prompt: string;
    
    beforeEach(() => {
      prompt = buildComfortableImperfectionPrompt();
    });

    it("should return a non-empty string", () => {
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should include section header identifying Phase 3", () => {
      expect(prompt).toContain("CONVERSATIONAL IMPERFECTION");
    });

    it("should include uncertainty guidance", () => {
      expect(prompt).toContain("UNCERTAINTY EXAMPLES");
      
      // Should include the actual uncertainty examples
      for (const response of UNCERTAINTY_RESPONSES) {
        expect(prompt).toContain(response);
      }
    });

    it("should include brevity guidance", () => {
      expect(prompt).toContain("BRIEF RESPONSE EXAMPLES");
      
      // Should include the actual brief examples
      for (const response of BRIEF_RESPONSE_EXAMPLES) {
        expect(prompt).toContain(response);
      }
    });

    it("should advise against interview-like behavior", () => {
      expect(prompt).toContain("conducting an interview");
      expect(prompt).toContain("not someone taking notes");
    });

    it("should explain WHEN to use these responses", () => {
      expect(prompt).toContain("YOU DON'T ALWAYS HAVE ANSWERS");
      expect(prompt).toContain("outside your depth");
    });

    it("should articulate the goal of feeling human", () => {
      expect(prompt).toContain("THE VIBE");
      expect(prompt).toContain("Real people");
    });
  });

  // ============================================
  // Integration with buildSystemPrompt Tests
  // ============================================
  
  describe("buildSystemPrompt - Phase 3 Integration", () => {
    it("should include comfortable imperfection prompt in system prompt", async () => {
      const systemPrompt = await buildSystemPrompt();
      
      // Verify Phase 3 content is present
      expect(systemPrompt).toContain("CONVERSATIONAL IMPERFECTION");
      expect(systemPrompt).toContain("UNCERTAINTY EXAMPLES");
      expect(systemPrompt).toContain("BRIEF RESPONSE EXAMPLES");
    });

    it("should place comfortable imperfection in the soul layer section", async () => {
      const systemPrompt = await buildSystemPrompt();
      
      // Check that it appears after selective attention and before motivated friction
      const selectiveAttentionIndex = systemPrompt.indexOf("SELECTIVE ATTENTION");
      const comfortableImperfectionIndex = systemPrompt.indexOf("CONVERSATIONAL IMPERFECTION");
      const motivatedFrictionIndex = systemPrompt.indexOf("MOTIVATED FRICTION");
      
      expect(selectiveAttentionIndex).toBeGreaterThan(-1);
      expect(comfortableImperfectionIndex).toBeGreaterThan(selectiveAttentionIndex);
      expect(motivatedFrictionIndex).toBeGreaterThan(comfortableImperfectionIndex);
    });

    it("should include specific uncertainty responses in system prompt", async () => {
      const systemPrompt = await buildSystemPrompt();
      
      // Check for key phrases from the implementation plan
      expect(systemPrompt).toContain("not sure what to say");
      expect(systemPrompt).toContain("need to think about that");
      expect(systemPrompt).toContain("don't have a smart take");
    });

    it("should include specific brief response examples in system prompt", async () => {
      const systemPrompt = await buildSystemPrompt();
      
      // Check for the "That's really cool ✨" example from implementation plan
      expect(systemPrompt).toContain("That's really cool");
    });
  });

  // ============================================
  // Edge Cases and Constraints
  // ============================================
  
  describe("Edge Cases", () => {
    it("uncertainty responses should not be too many (quality over quantity)", () => {
      // Don't want to overwhelm the model with 50 examples
      expect(UNCERTAINTY_RESPONSES.length).toBeLessThanOrEqual(20);
      expect(UNCERTAINTY_RESPONSES.length).toBeGreaterThanOrEqual(3);
    });

    it("brief response examples should be concise", () => {
      // Brief means BRIEF - under 25 chars each
      expect(BRIEF_RESPONSE_EXAMPLES.length).toBeLessThanOrEqual(25);
      expect(BRIEF_RESPONSE_EXAMPLES.length).toBeGreaterThanOrEqual(3);
      
      // Average length should be very short
      const avgLength = BRIEF_RESPONSE_EXAMPLES.reduce((sum, r) => sum + r.length, 0) / BRIEF_RESPONSE_EXAMPLES.length;
      expect(avgLength).toBeLessThan(15);
    });

    it("buildComfortableImperfectionPrompt should be deterministic", () => {
      // Same output every time (no randomness)
      const prompt1 = buildComfortableImperfectionPrompt();
      const prompt2 = buildComfortableImperfectionPrompt();
      
      expect(prompt1).toBe(prompt2);
    });
  });
});
