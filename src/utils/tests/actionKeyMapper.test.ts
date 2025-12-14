// src/utils/tests/actionKeyMapper.test.ts
/**
 * Action Key Mapper Unit Tests
 * 
 * Tests the action key mapping functionality that converts simple action keys
 * (used in LLM prompts) to UUIDs (used in the application).
 * 
 * Phase 1 Optimization - System Prompt Token Reduction
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildActionKeyMap,
  getActionKeysForPrompt,
  resolveActionKey,
  isActionKeyMapInitialized,
  clearActionKeyMap,
} from "../actionKeyMapper";
import type { CharacterAction } from "../../types";

// Mock character actions for testing
const mockActions: CharacterAction[] = [
  {
    id: "uuid-123-talking",
    name: "Talking",
    phrases: ["talk", "speaking", "chat"],
    video: new Blob(),
    videoPath: "/videos/talking.mp4",
  },
  {
    id: "uuid-456-confused",
    name: "Confused",
    phrases: ["what", "huh", "confused"],
    video: new Blob(),
    videoPath: "/videos/confused.mp4",
  },
  {
    id: "uuid-789-excited",
    name: "Excited",
    phrases: ["wow", "amazing", "excited"],
    video: new Blob(),
    videoPath: "/videos/excited.mp4",
  },
  {
    id: "uuid-abc-waving-hello",
    name: "Waving Hello",
    phrases: ["hi", "hello", "wave"],
    video: new Blob(),
    videoPath: "/videos/waving-hello.mp4",
  },
];

describe("Action Key Mapper", () => {
  beforeEach(() => {
    clearActionKeyMap();
  });

  // ============================================
  // buildActionKeyMap Tests
  // ============================================

  describe("buildActionKeyMap", () => {
    it("should initialize the action key map from character actions", () => {
      expect(isActionKeyMapInitialized()).toBe(false);
      
      buildActionKeyMap(mockActions);
      
      expect(isActionKeyMapInitialized()).toBe(true);
    });

    it("should handle empty actions array", () => {
      buildActionKeyMap([]);
      
      expect(isActionKeyMapInitialized()).toBe(false);
    });

    it("should normalize action names to lowercase with underscores", () => {
      buildActionKeyMap(mockActions);
      
      // "Waving Hello" should become "waving_hello"
      const resolved = resolveActionKey("waving_hello");
      expect(resolved).toBe("uuid-abc-waving-hello");
    });
  });

  // ============================================
  // getActionKeysForPrompt Tests
  // ============================================

  describe("getActionKeysForPrompt", () => {
    it("should return comma-separated list of action keys", () => {
      const keys = getActionKeysForPrompt(mockActions);
      
      expect(keys).toContain("talking");
      expect(keys).toContain("confused");
      expect(keys).toContain("excited");
      expect(keys).toContain("waving_hello");
    });

    it("should return empty string for empty actions array", () => {
      const keys = getActionKeysForPrompt([]);
      
      expect(keys).toBe("");
    });

    it("should normalize multi-word action names", () => {
      const keys = getActionKeysForPrompt(mockActions);
      
      // "Waving Hello" should become "waving_hello"
      expect(keys).toContain("waving_hello");
      expect(keys).not.toContain("Waving Hello");
    });

    it("should be consistent format for LLM prompt injection", () => {
      const keys = getActionKeysForPrompt(mockActions);
      
      // Should be a simple comma-separated list
      const keyArray = keys.split(", ");
      expect(keyArray.length).toBe(4);
      expect(keyArray).toContain("talking");
    });
  });

  // ============================================
  // resolveActionKey Tests - Direct Matches
  // ============================================

  describe("resolveActionKey - Direct Matches", () => {
    beforeEach(() => {
      buildActionKeyMap(mockActions);
    });

    it("should resolve exact lowercase key to UUID", () => {
      expect(resolveActionKey("talking")).toBe("uuid-123-talking");
      expect(resolveActionKey("confused")).toBe("uuid-456-confused");
      expect(resolveActionKey("excited")).toBe("uuid-789-excited");
    });

    it("should resolve multi-word key with underscores", () => {
      expect(resolveActionKey("waving_hello")).toBe("uuid-abc-waving-hello");
    });

    it("should return null for null input", () => {
      expect(resolveActionKey(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(resolveActionKey(undefined)).toBeNull();
    });

    it("should return null for empty string input", () => {
      expect(resolveActionKey("")).toBeNull();
    });

    it("should normalize input to lowercase before matching", () => {
      expect(resolveActionKey("TALKING")).toBe("uuid-123-talking");
      expect(resolveActionKey("Talking")).toBe("uuid-123-talking");
      expect(resolveActionKey("TaLkInG")).toBe("uuid-123-talking");
    });

    it("should normalize spaces to underscores", () => {
      expect(resolveActionKey("waving hello")).toBe("uuid-abc-waving-hello");
      expect(resolveActionKey("Waving Hello")).toBe("uuid-abc-waving-hello");
    });
  });

  // ============================================
  // resolveActionKey Tests - Fuzzy Matching
  // ============================================

  describe("resolveActionKey - Fuzzy Matching (Levenshtein)", () => {
    beforeEach(() => {
      buildActionKeyMap(mockActions);
    });

    it("should fuzzy match minor typos (distance <= 3)", () => {
      // "talkng" is distance 1 from "talking" (missing 'i')
      expect(resolveActionKey("talkng")).toBe("uuid-123-talking");
      
      // "talkig" is distance 1 from "talking" (n -> g)
      expect(resolveActionKey("talkig")).toBe("uuid-123-talking");
    });

    it("should fuzzy match with one character off", () => {
      // "confuse" is distance 1 from "confused" (missing 'd')
      expect(resolveActionKey("confuse")).toBe("uuid-456-confused");
    });

    it("should fuzzy match with two characters off", () => {
      // "excted" is distance 2 from "excited" (missing 'i')
      expect(resolveActionKey("excted")).toBe("uuid-789-excited");
    });

    it("should NOT match if distance > 3 (too different)", () => {
      // "running" is distance 4 from "talking" (r→t, u→a, n→l, n→k, i=i, n=n, g=g) - too different
      expect(resolveActionKey("running")).toBeNull();
      
      // "jumping" is distance 5+ from all actions - definitely no match
      expect(resolveActionKey("jumping")).toBeNull();
      
      // Note: "dancing" is exactly distance 3 from "talking" so it DOES match (boundary case)
      // This is intentional - we want fuzzy matching to catch close typos
    });

    it("should handle hallucinated but close keys gracefully", () => {
      // LLM might output "talkiing" (extra 'i')
      expect(resolveActionKey("talkiing")).toBe("uuid-123-talking");
      
      // LLM might output "exited" (missing 'c')
      expect(resolveActionKey("exited")).toBe("uuid-789-excited");
    });
  });

  // ============================================
  // resolveActionKey Tests - Edge Cases
  // ============================================

  describe("resolveActionKey - Edge Cases", () => {
    it("should return null when action key map is not initialized", () => {
      // Map is cleared in beforeEach, so it's not initialized
      expect(resolveActionKey("talking")).toBeNull();
    });

    it("should return null for unknown action keys", () => {
      buildActionKeyMap(mockActions);
      
      expect(resolveActionKey("unknown_action")).toBeNull();
      expect(resolveActionKey("random_key")).toBeNull();
    });

    it("should gracefully handle UUID-like input (legacy format)", () => {
      buildActionKeyMap(mockActions);
      
      // If LLM outputs a UUID instead of key, it won't match any key
      // and should return null (the app can then check if it's a valid UUID directly)
      expect(resolveActionKey("uuid-123-talking")).toBeNull();
    });

    it("should handle special characters gracefully (fuzzy matching applies)", () => {
      buildActionKeyMap(mockActions);
      
      // Special characters with small edit distance still match (expected fuzzy behavior)
      // "talking!" is distance 1 from "talking" - should still match
      expect(resolveActionKey("talking!")).toBe("uuid-123-talking");
      
      // "@confused" is distance 1 from "confused" - should still match
      expect(resolveActionKey("@confused")).toBe("uuid-456-confused");
      
      // But completely different strings should not match
      expect(resolveActionKey("!!!")).toBeNull();
      expect(resolveActionKey("@#$%")).toBeNull();
    });
  });

  // ============================================
  // isActionKeyMapInitialized Tests
  // ============================================

  describe("isActionKeyMapInitialized", () => {
    it("should return false before initialization", () => {
      expect(isActionKeyMapInitialized()).toBe(false);
    });

    it("should return true after initialization with actions", () => {
      buildActionKeyMap(mockActions);
      expect(isActionKeyMapInitialized()).toBe(true);
    });

    it("should return false after clearing", () => {
      buildActionKeyMap(mockActions);
      clearActionKeyMap();
      expect(isActionKeyMapInitialized()).toBe(false);
    });

    it("should return false if initialized with empty array", () => {
      buildActionKeyMap([]);
      expect(isActionKeyMapInitialized()).toBe(false);
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe("Integration - Full Flow", () => {
    it("should work end-to-end: build map, get keys for prompt, resolve key", () => {
      // Step 1: Build the map when character loads
      buildActionKeyMap(mockActions);
      expect(isActionKeyMapInitialized()).toBe(true);
      
      // Step 2: Get keys for the LLM prompt
      const promptKeys = getActionKeysForPrompt(mockActions);
      expect(promptKeys).toContain("talking");
      
      // Step 3: When LLM returns a key, resolve it to UUID
      const uuid = resolveActionKey("talking");
      expect(uuid).toBe("uuid-123-talking");
    });

    it("should handle the null action_id case (90% of responses)", () => {
      buildActionKeyMap(mockActions);
      
      // Most responses should have action_id: null
      expect(resolveActionKey(null)).toBeNull();
    });

    it("should handle rebuilding the map for different characters", () => {
      // First character
      buildActionKeyMap(mockActions);
      expect(resolveActionKey("talking")).toBe("uuid-123-talking");
      
      // Second character with different actions
      const otherActions: CharacterAction[] = [
        {
          id: "other-uuid-happy",
          name: "Happy",
          phrases: ["happy"],
          video: new Blob(),
          videoPath: "/videos/happy.mp4",
        },
      ];
      
      buildActionKeyMap(otherActions);
      
      // Old keys should no longer resolve
      expect(resolveActionKey("talking")).toBeNull();
      
      // New keys should resolve
      expect(resolveActionKey("happy")).toBe("other-uuid-happy");
    });
  });
});
