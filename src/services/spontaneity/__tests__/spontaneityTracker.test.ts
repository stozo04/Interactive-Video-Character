// src/services/spontaneity/__tests__/spontaneityTracker.test.ts
/**
 * Spontaneity Tracker Tests
 *
 * Tests the spontaneity tracking system that makes Kayley feel alive:
 * - Conversation state tracking (topics, laughter, messages)
 * - Spontaneity probability calculations with tier bonuses
 * - Selfie probability calculations (friend+ only)
 * - Cooldown enforcement
 * - Context building for spontaneous actions
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resetConversationState,
  trackMessage,
  trackLaughter,
  recordSpontaneousAction,
  calculateSpontaneityProbability,
  calculateSelfieProbability,
  buildSpontaneityContext,
  getConversationState,
} from "../spontaneityTracker";
import {
  SPONTANEITY_DEFAULTS,
  TIER_SPONTANEITY_BONUS,
  TIER_SELFIE_BONUS,
  type ConversationalMood,
} from "../types";

describe("Spontaneity Tracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationState();
  });

  // ============================================
  // resetConversationState
  // ============================================

  describe("resetConversationState", () => {
    it("should reset all conversation state to defaults", () => {
      // First add some state
      trackMessage(["topic1", "topic2"]);
      trackLaughter();
      recordSpontaneousAction("spontaneous_humor");

      // Reset
      resetConversationState();

      const state = getConversationState();
      expect(state.messagesCount).toBe(0);
      expect(state.topicsDiscussed).toEqual([]);
      expect(state.recentLaughter).toBe(false);
      expect(state.lastSpontaneousMoment).toBeNull();
      expect(state.recentSpontaneousTypes).toEqual([]);
      expect(state.lastSpontaneousSelfie).toBeNull();
    });

    it("should start session timestamp at reset", () => {
      const beforeReset = Date.now();
      resetConversationState();
      const afterReset = Date.now();

      const state = getConversationState();
      expect(state.sessionStartedAt.getTime()).toBeGreaterThanOrEqual(beforeReset);
      expect(state.sessionStartedAt.getTime()).toBeLessThanOrEqual(afterReset);
    });
  });

  // ============================================
  // trackMessage
  // ============================================

  describe("trackMessage", () => {
    it("should increment message count", () => {
      trackMessage([]);
      trackMessage([]);
      trackMessage([]);

      const state = getConversationState();
      expect(state.messagesCount).toBe(3);
    });

    it("should accumulate topics discussed", () => {
      trackMessage(["music", "guitar"]);
      trackMessage(["music", "piano"]); // music duplicate
      trackMessage(["sports"]);

      const state = getConversationState();
      expect(state.topicsDiscussed).toContain("music");
      expect(state.topicsDiscussed).toContain("guitar");
      expect(state.topicsDiscussed).toContain("piano");
      expect(state.topicsDiscussed).toContain("sports");
    });

    it("should deduplicate topics", () => {
      trackMessage(["music"]);
      trackMessage(["music"]);
      trackMessage(["music"]);

      const state = getConversationState();
      expect(state.topicsDiscussed.filter(t => t === "music")).toHaveLength(1);
    });

    it("should limit topics to 20 most recent", () => {
      // Add 25 unique topics
      for (let i = 0; i < 25; i++) {
        trackMessage([`topic${i}`]);
      }

      const state = getConversationState();
      expect(state.topicsDiscussed).toHaveLength(20);
      // Should keep most recent (topic20-24 should be in there)
      expect(state.topicsDiscussed).toContain("topic24");
      expect(state.topicsDiscussed).toContain("topic23");
      // Should have dropped earliest (topic0 should not be there)
      expect(state.topicsDiscussed).not.toContain("topic0");
    });

    it("should handle empty topics array", () => {
      trackMessage([]);

      const state = getConversationState();
      expect(state.messagesCount).toBe(1);
      expect(state.topicsDiscussed).toEqual([]);
    });

    it("should trim and filter empty topic strings", () => {
      trackMessage(["  ", "", "  valid  ", ""]);

      const state = getConversationState();
      expect(state.topicsDiscussed).toEqual(["valid"]);
    });
  });

  // ============================================
  // trackLaughter
  // ============================================

  describe("trackLaughter", () => {
    it("should set recentLaughter to true", () => {
      trackLaughter();

      const state = getConversationState();
      expect(state.recentLaughter).toBe(true);
    });

    it("should increment humor successes", () => {
      trackLaughter();
      trackLaughter();

      const state = getConversationState();
      expect(state.humorSuccessesCount).toBe(2);
    });

    it("should decay after 5 minutes", () => {
      vi.useFakeTimers();
      const now = new Date();
      vi.setSystemTime(now);

      trackLaughter();
      expect(getConversationState().recentLaughter).toBe(true);

      // Move forward 4 minutes - should still be recent
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(getConversationState().recentLaughter).toBe(true);

      // Move forward 2 more minutes (total 6) - should decay
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(getConversationState().recentLaughter).toBe(false);

      vi.useRealTimers();
    });

    it("should refresh decay timer on new laughter", () => {
      vi.useFakeTimers();
      const now = new Date();
      vi.setSystemTime(now);

      trackLaughter();

      // 4 minutes pass
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(getConversationState().recentLaughter).toBe(true);

      // New laughter resets timer
      trackLaughter();

      // Another 4 minutes - should still be recent
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(getConversationState().recentLaughter).toBe(true);

      vi.useRealTimers();
    });
  });

  // ============================================
  // recordSpontaneousAction
  // ============================================

  describe("recordSpontaneousAction", () => {
    it("should record timestamp of spontaneous moment", () => {
      const beforeAction = Date.now();
      recordSpontaneousAction("spontaneous_humor");
      const afterAction = Date.now();

      const state = getConversationState();
      expect(state.lastSpontaneousMoment).not.toBeNull();
      expect(state.lastSpontaneousMoment!.getTime()).toBeGreaterThanOrEqual(beforeAction);
      expect(state.lastSpontaneousMoment!.getTime()).toBeLessThanOrEqual(afterAction);
    });

    it("should add action type to recent types", () => {
      recordSpontaneousAction("spontaneous_humor");
      recordSpontaneousAction("associative_share");

      const state = getConversationState();
      expect(state.recentSpontaneousTypes).toEqual([
        "spontaneous_humor",
        "associative_share"
      ]);
    });

    it("should limit recent types to 10", () => {
      // Record 12 actions
      const types: Array<"spontaneous_humor" | "associative_share"> = [
        "spontaneous_humor", "associative_share", "spontaneous_humor",
        "associative_share", "spontaneous_humor", "associative_share",
        "spontaneous_humor", "associative_share", "spontaneous_humor",
        "associative_share", "spontaneous_humor", "associative_share"
      ];

      types.forEach(type => recordSpontaneousAction(type));

      const state = getConversationState();
      expect(state.recentSpontaneousTypes).toHaveLength(10);
      // Should keep most recent
      expect(state.recentSpontaneousTypes[9]).toBe("associative_share");
    });

    it("should record selfie timestamp separately", () => {
      recordSpontaneousAction("spontaneous_selfie");

      const state = getConversationState();
      expect(state.lastSpontaneousSelfie).not.toBeNull();
      expect(state.lastSpontaneousMoment).not.toBeNull();
    });

    it("should update lastSpontaneousMoment timestamp on each action", () => {
      vi.useFakeTimers();
      const startTime = new Date("2025-01-01T12:00:00Z");
      vi.setSystemTime(startTime);

      recordSpontaneousAction("spontaneous_humor");
      const firstTimestamp = getConversationState().lastSpontaneousMoment!.getTime();

      vi.advanceTimersByTime(60 * 1000); // 1 minute later

      recordSpontaneousAction("associative_share");
      const secondTimestamp = getConversationState().lastSpontaneousMoment!.getTime();

      expect(secondTimestamp).toBeGreaterThan(firstTimestamp);
      expect(secondTimestamp - firstTimestamp).toBe(60 * 1000);

      vi.useRealTimers();
    });
  });

  // ============================================
  // calculateSpontaneityProbability
  // ============================================

  describe("calculateSpontaneityProbability", () => {
    it("should return base probability for stranger with no energy bonus", () => {
      const prob = calculateSpontaneityProbability("stranger", 0.5, 1);

      // Base = 0.1, tier bonus = 0, energy = 0.5, no other modifiers
      const expected = SPONTANEITY_DEFAULTS.baseProbability;
      expect(prob).toBe(expected);
    });

    it("should add tier bonus for friend", () => {
      const prob = calculateSpontaneityProbability("friend", 0.5, 1);

      const expected = SPONTANEITY_DEFAULTS.baseProbability + TIER_SPONTANEITY_BONUS.friend;
      expect(prob).toBeCloseTo(expected, 4);
    });

    it("should add tier bonus for close_friend", () => {
      const prob = calculateSpontaneityProbability("close_friend", 0.5, 1);

      const expected = SPONTANEITY_DEFAULTS.baseProbability + TIER_SPONTANEITY_BONUS.close_friend;
      expect(prob).toBeCloseTo(expected, 4);
    });

    it("should add tier bonus for deeply_loving", () => {
      const prob = calculateSpontaneityProbability("deeply_loving", 0.5, 1);

      const expected = SPONTANEITY_DEFAULTS.baseProbability + TIER_SPONTANEITY_BONUS.deeply_loving;
      expect(prob).toBeCloseTo(expected, 4);
    });

    it("should increase with high energy level", () => {
      const lowEnergy = calculateSpontaneityProbability("friend", 0.3, 1);
      const highEnergy = calculateSpontaneityProbability("friend", 0.9, 1);

      expect(highEnergy).toBeGreaterThan(lowEnergy);
    });

    it("should increase slightly with message count", () => {
      const fewMessages = calculateSpontaneityProbability("friend", 0.7, 2);
      const manyMessages = calculateSpontaneityProbability("friend", 0.7, 20);

      expect(manyMessages).toBeGreaterThan(fewMessages);
    });

    it("should be capped at maximum probability", () => {
      // Try to exceed max with high tier, high energy, many messages
      const prob = calculateSpontaneityProbability("deeply_loving", 1.0, 100);

      expect(prob).toBeLessThanOrEqual(SPONTANEITY_DEFAULTS.maxProbability);
    });

    it("should reduce probability when in cooldown", () => {
      vi.useFakeTimers();
      const now = new Date();
      vi.setSystemTime(now);

      // No cooldown yet
      const beforeCooldown = calculateSpontaneityProbability("friend", 0.7, 5);

      // Record a spontaneous action
      recordSpontaneousAction("spontaneous_humor");

      // Immediately after (in cooldown)
      const duringCooldown = calculateSpontaneityProbability("friend", 0.7, 5);

      expect(duringCooldown).toBeLessThan(beforeCooldown);

      vi.useRealTimers();
    });

    it("should restore probability after cooldown expires", () => {
      vi.useFakeTimers();
      const now = new Date();
      vi.setSystemTime(now);

      // Record action
      recordSpontaneousAction("spontaneous_humor");

      // During cooldown
      const duringCooldown = calculateSpontaneityProbability("friend", 0.7, 5);

      // Move past cooldown (3 minutes + 1 second)
      vi.advanceTimersByTime((SPONTANEITY_DEFAULTS.cooldownMinutes * 60 + 1) * 1000);

      // After cooldown
      const afterCooldown = calculateSpontaneityProbability("friend", 0.7, 5);

      expect(afterCooldown).toBeGreaterThan(duringCooldown);

      vi.useRealTimers();
    });

    it("should handle unknown tier gracefully", () => {
      const prob = calculateSpontaneityProbability("unknown_tier", 0.5, 1);

      // Should use base probability with 0 tier bonus
      expect(prob).toBeGreaterThanOrEqual(0);
      expect(prob).toBeLessThanOrEqual(SPONTANEITY_DEFAULTS.maxProbability);
    });

    it("should handle edge case of 0 energy", () => {
      // Use stranger tier to isolate energy effect (no tier bonus)
      const prob = calculateSpontaneityProbability("stranger", 0, 1);

      // Should be lower than base probability due to negative energy modifier
      expect(prob).toBeGreaterThanOrEqual(0);
      expect(prob).toBeLessThan(SPONTANEITY_DEFAULTS.baseProbability);
    });

    it("should handle edge case of 0 messages", () => {
      const prob = calculateSpontaneityProbability("friend", 0.7, 0);

      expect(prob).toBeGreaterThanOrEqual(0);
      expect(prob).toBeLessThanOrEqual(SPONTANEITY_DEFAULTS.maxProbability);
    });
  });

  // ============================================
  // calculateSelfieProbability
  // ============================================

  describe("calculateSelfieProbability", () => {
    it("should return 0 for stranger tier", () => {
      const prob = calculateSelfieProbability(
        "stranger",
        0.7,
        "playful",
        false,
        null,
        null
      );

      expect(prob).toBe(0);
    });

    it("should return 0 for acquaintance tier", () => {
      const prob = calculateSelfieProbability(
        "acquaintance",
        0.7,
        "playful",
        false,
        null,
        null
      );

      expect(prob).toBe(0);
    });

    it("should allow selfies for friend tier", () => {
      const prob = calculateSelfieProbability(
        "friend",
        0.7,
        "playful",
        false,
        null,
        null
      );

      expect(prob).toBeGreaterThan(0);
    });

    it("should allow selfies for close_friend tier", () => {
      const prob = calculateSelfieProbability(
        "close_friend",
        0.7,
        "playful",
        false,
        null,
        null
      );

      expect(prob).toBeGreaterThan(0);
    });

    it("should allow selfies for deeply_loving tier", () => {
      const prob = calculateSelfieProbability(
        "deeply_loving",
        0.7,
        "playful",
        false,
        null,
        null
      );

      expect(prob).toBeGreaterThan(0);
    });

    it("should add tier bonus for higher relationship tiers", () => {
      const friendProb = calculateSelfieProbability(
        "friend",
        0.7,
        "playful",
        false,
        null,
        null
      );

      const closeProb = calculateSelfieProbability(
        "close_friend",
        0.7,
        "playful",
        false,
        null,
        null
      );

      const deepProb = calculateSelfieProbability(
        "deeply_loving",
        0.7,
        "playful",
        false,
        null,
        null
      );

      expect(closeProb).toBeGreaterThan(friendProb);
      expect(deepProb).toBeGreaterThan(closeProb);
    });

    it("should increase probability for playful mood", () => {
      const casualProb = calculateSelfieProbability(
        "friend",
        0.7,
        "casual",
        false,
        null,
        null
      );

      const playfulProb = calculateSelfieProbability(
        "friend",
        0.7,
        "playful",
        false,
        null,
        null
      );

      expect(playfulProb).toBeGreaterThan(casualProb);
    });

    it("should increase probability for excited mood", () => {
      const casualProb = calculateSelfieProbability(
        "friend",
        0.7,
        "casual",
        false,
        null,
        null
      );

      const excitedProb = calculateSelfieProbability(
        "friend",
        0.7,
        "excited",
        false,
        null,
        null
      );

      expect(excitedProb).toBeGreaterThan(casualProb);
    });

    it("should increase probability when user had bad day", () => {
      const normalProb = calculateSelfieProbability(
        "friend",
        0.7,
        "casual",
        false,
        null,
        null
      );

      const badDayProb = calculateSelfieProbability(
        "friend",
        0.7,
        "casual",
        true,
        null,
        null
      );

      expect(badDayProb).toBeGreaterThan(normalProb);
    });

    it("should increase probability with high energy", () => {
      const lowEnergyProb = calculateSelfieProbability(
        "friend",
        0.3,
        "casual",
        false,
        null,
        null
      );

      const highEnergyProb = calculateSelfieProbability(
        "friend",
        0.9,
        "casual",
        false,
        null,
        null
      );

      expect(highEnergyProb).toBeGreaterThan(lowEnergyProb);
    });

    it("should increase probability at interesting location", () => {
      const homeProb = calculateSelfieProbability(
        "friend",
        0.7,
        "casual",
        false,
        null,
        "home"
      );

      const locationProb = calculateSelfieProbability(
        "friend",
        0.7,
        "casual",
        false,
        null,
        "beach"
      );

      expect(locationProb).toBeGreaterThan(homeProb);
    });

    it("should be capped at maximum probability", () => {
      // Try to exceed max with all bonuses
      const prob = calculateSelfieProbability(
        "deeply_loving",
        1.0,
        "excited",
        true,
        null,
        "beach sunset"
      );

      expect(prob).toBeLessThanOrEqual(SPONTANEITY_DEFAULTS.selfieMaxProbability);
    });

    it("should reduce probability when in selfie cooldown", () => {
      vi.useFakeTimers();
      const now = new Date();
      vi.setSystemTime(now);

      const beforeCooldown = calculateSelfieProbability(
        "friend",
        0.7,
        "playful",
        false,
        null,
        null
      );

      // Record selfie
      recordSpontaneousAction("spontaneous_selfie");

      const duringCooldown = calculateSelfieProbability(
        "friend",
        0.7,
        "playful",
        false,
        null,
        null
      );

      expect(duringCooldown).toBeLessThan(beforeCooldown);

      vi.useRealTimers();
    });

    it("should restore probability after 24-hour selfie cooldown", () => {
      vi.useFakeTimers();
      const now = new Date();
      vi.setSystemTime(now);

      recordSpontaneousAction("spontaneous_selfie");

      const duringCooldown = calculateSelfieProbability(
        "friend",
        0.7,
        "playful",
        false,
        null,
        null
      );

      // Move past 24-hour cooldown
      vi.advanceTimersByTime((SPONTANEITY_DEFAULTS.selfieCooldownHours * 60 * 60 + 1) * 1000);

      const afterCooldown = calculateSelfieProbability(
        "friend",
        0.7,
        "playful",
        false,
        null,
        null
      );

      expect(afterCooldown).toBeGreaterThan(duringCooldown);

      vi.useRealTimers();
    });

    it("should use provided lastSpontaneousSelfie timestamp", () => {
      vi.useFakeTimers();
      const now = new Date();
      vi.setSystemTime(now);

      // Selfie from 1 hour ago (within cooldown)
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const probWithRecentSelfie = calculateSelfieProbability(
        "friend",
        0.7,
        "playful",
        false,
        oneHourAgo,
        null
      );

      // Selfie from 25 hours ago (past cooldown)
      const longAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);

      const probWithOldSelfie = calculateSelfieProbability(
        "friend",
        0.7,
        "playful",
        false,
        longAgo,
        null
      );

      expect(probWithOldSelfie).toBeGreaterThan(probWithRecentSelfie);

      vi.useRealTimers();
    });
  });

  // ============================================
  // buildSpontaneityContext
  // ============================================

  describe("buildSpontaneityContext", () => {
    it("should build complete context with all required fields", () => {
      trackMessage(["music", "guitar"]);
      trackLaughter();

      const context = buildSpontaneityContext({
        conversationalMood: "playful" as ConversationalMood,
        relationshipTier: "friend",
        energyLevel: 0.7,
        comfortLevel: 0.6,
        vulnerabilityExchangeActive: false,
        hasSomethingToShare: false,
        currentThought: null,
        recentExperience: null,
        userInterests: ["music", "coding"],
        currentLocation: null,
        currentOutfit: null,
        currentMoodForSelfie: null,
        userHadBadDay: false,
      });

      expect(context.conversationalMood).toBe("playful");
      expect(context.energyLevel).toBe(0.7);
      expect(context.relationshipTier).toBe("friend");
      expect(context.comfortLevel).toBe(0.6);
      expect(context.recentLaughter).toBe(true);
      expect(context.messagesInConversation).toBe(1);
      expect(context.topicsDiscussed).toEqual(["music", "guitar"]);
      expect(context.userInterests).toEqual(["music", "coding"]);
    });

    it("should calculate topic depth based on conversation", () => {
      // Few messages = surface
      trackMessage(["hi"]);
      const surfaceContext = buildSpontaneityContext({
        conversationalMood: "casual" as ConversationalMood,
        relationshipTier: "friend",
        energyLevel: 0.7,
        comfortLevel: 0.5,
        vulnerabilityExchangeActive: false,
        hasSomethingToShare: false,
        currentThought: null,
        recentExperience: null,
        userInterests: [],
        currentLocation: null,
        currentOutfit: null,
        currentMoodForSelfie: null,
        userHadBadDay: false,
      });
      expect(surfaceContext.topicDepth).toBe("surface");

      resetConversationState();

      // Many messages = deep
      for (let i = 0; i < 20; i++) {
        trackMessage(["topic"]);
      }
      const deepContext = buildSpontaneityContext({
        conversationalMood: "deep" as ConversationalMood,
        relationshipTier: "friend",
        energyLevel: 0.7,
        comfortLevel: 0.5,
        vulnerabilityExchangeActive: false,
        hasSomethingToShare: false,
        currentThought: null,
        recentExperience: null,
        userInterests: [],
        currentLocation: null,
        currentOutfit: null,
        currentMoodForSelfie: null,
        userHadBadDay: false,
      });
      expect(deepContext.topicDepth).toBe("deep");
    });

    it("should include recent spontaneous action types", () => {
      recordSpontaneousAction("spontaneous_humor");
      recordSpontaneousAction("associative_share");

      const context = buildSpontaneityContext({
        conversationalMood: "playful" as ConversationalMood,
        relationshipTier: "friend",
        energyLevel: 0.7,
        comfortLevel: 0.5,
        vulnerabilityExchangeActive: false,
        hasSomethingToShare: false,
        currentThought: null,
        recentExperience: null,
        userInterests: [],
        currentLocation: null,
        currentOutfit: null,
        currentMoodForSelfie: null,
        userHadBadDay: false,
      });

      expect(context.recentSpontaneousTypes).toEqual([
        "spontaneous_humor",
        "associative_share"
      ]);
    });

    it("should calculate spontaneity probability", () => {
      const context = buildSpontaneityContext({
        conversationalMood: "playful" as ConversationalMood,
        relationshipTier: "friend",
        energyLevel: 0.7,
        comfortLevel: 0.5,
        vulnerabilityExchangeActive: false,
        hasSomethingToShare: false,
        currentThought: null,
        recentExperience: null,
        userInterests: [],
        currentLocation: null,
        currentOutfit: null,
        currentMoodForSelfie: null,
        userHadBadDay: false,
      });

      expect(context.spontaneityProbability).toBeGreaterThan(0);
      expect(context.spontaneityProbability).toBeLessThanOrEqual(SPONTANEITY_DEFAULTS.maxProbability);
    });

    it("should mark selfieEligible as true for friend tier", () => {
      const context = buildSpontaneityContext({
        conversationalMood: "playful" as ConversationalMood,
        relationshipTier: "friend",
        energyLevel: 0.7,
        comfortLevel: 0.5,
        vulnerabilityExchangeActive: false,
        hasSomethingToShare: false,
        currentThought: null,
        recentExperience: null,
        userInterests: [],
        currentLocation: null,
        currentOutfit: null,
        currentMoodForSelfie: null,
        userHadBadDay: false,
      });

      expect(context.selfieEligible).toBe(true);
    });

    it("should mark selfieEligible as false for stranger tier", () => {
      const context = buildSpontaneityContext({
        conversationalMood: "casual" as ConversationalMood,
        relationshipTier: "stranger",
        energyLevel: 0.7,
        comfortLevel: 0.3,
        vulnerabilityExchangeActive: false,
        hasSomethingToShare: false,
        currentThought: null,
        recentExperience: null,
        userInterests: [],
        currentLocation: null,
        currentOutfit: null,
        currentMoodForSelfie: null,
        userHadBadDay: false,
      });

      expect(context.selfieEligible).toBe(false);
    });

    it("should calculate selfie probability", () => {
      const context = buildSpontaneityContext({
        conversationalMood: "playful" as ConversationalMood,
        relationshipTier: "friend",
        energyLevel: 0.7,
        comfortLevel: 0.5,
        vulnerabilityExchangeActive: false,
        hasSomethingToShare: false,
        currentThought: null,
        recentExperience: null,
        userInterests: [],
        currentLocation: null,
        currentOutfit: null,
        currentMoodForSelfie: "feeling cute",
        userHadBadDay: false,
      });

      expect(context.selfieProbability).toBeGreaterThan(0);
      expect(context.selfieProbability).toBeLessThanOrEqual(SPONTANEITY_DEFAULTS.selfieMaxProbability);
    });

    it("should include all provided context fields", () => {
      const context = buildSpontaneityContext({
        conversationalMood: "deep" as ConversationalMood,
        relationshipTier: "close_friend",
        energyLevel: 0.8,
        comfortLevel: 0.7,
        vulnerabilityExchangeActive: true,
        hasSomethingToShare: true,
        currentThought: "I wonder if they're okay",
        recentExperience: "Had a great day at the beach",
        userInterests: ["photography", "travel"],
        currentLocation: "coffee shop downtown",
        currentOutfit: "new blue sweater",
        currentMoodForSelfie: "feeling cozy",
        userHadBadDay: true,
      });

      expect(context.vulnerabilityExchangeActive).toBe(true);
      expect(context.hasSomethingToShare).toBe(true);
      expect(context.currentThought).toBe("I wonder if they're okay");
      expect(context.recentExperience).toBe("Had a great day at the beach");
      expect(context.currentLocation).toBe("coffee shop downtown");
      expect(context.currentOutfit).toBe("new blue sweater");
      expect(context.currentMoodForSelfie).toBe("feeling cozy");
      expect(context.userHadBadDay).toBe(true);
    });

    it("should include timestamps", () => {
      recordSpontaneousAction("spontaneous_humor");

      const context = buildSpontaneityContext({
        conversationalMood: "playful" as ConversationalMood,
        relationshipTier: "friend",
        energyLevel: 0.7,
        comfortLevel: 0.5,
        vulnerabilityExchangeActive: false,
        hasSomethingToShare: false,
        currentThought: null,
        recentExperience: null,
        userInterests: [],
        currentLocation: null,
        currentOutfit: null,
        currentMoodForSelfie: null,
        userHadBadDay: false,
      });

      expect(context.lastSpontaneousMoment).not.toBeNull();
      expect(context.lastSpontaneousMoment).toBeInstanceOf(Date);
    });
  });

  // ============================================
  // Edge Cases and Integration
  // ============================================

  describe("edge cases and integration", () => {
    it("should handle concurrent tracking operations", () => {
      // Simulate multiple operations happening in quick succession
      trackMessage(["topic1"]);
      trackLaughter();
      recordSpontaneousAction("spontaneous_humor");
      trackMessage(["topic2"]);

      const state = getConversationState();
      expect(state.messagesCount).toBe(2);
      expect(state.topicsDiscussed).toHaveLength(2);
      expect(state.recentLaughter).toBe(true);
      expect(state.recentSpontaneousTypes).toHaveLength(1);
    });

    it("should maintain consistency across reset cycles", () => {
      // First session
      trackMessage(["music"]);
      recordSpontaneousAction("spontaneous_humor");

      // Reset
      resetConversationState();

      // Second session
      trackMessage(["sports"]);
      const state = getConversationState();

      expect(state.messagesCount).toBe(1);
      expect(state.topicsDiscussed).toEqual(["sports"]);
      expect(state.recentSpontaneousTypes).toEqual([]);
    });

    it("should handle very long topic strings gracefully", () => {
      const longTopic = "a".repeat(1000);
      trackMessage([longTopic]);

      const state = getConversationState();
      expect(state.topicsDiscussed).toContain(longTopic);
    });

    it("should handle special characters in topics", () => {
      const specialTopics = ["coding/programming", "music & art", "food (italian)"];
      trackMessage(specialTopics);

      const state = getConversationState();
      specialTopics.forEach(topic => {
        expect(state.topicsDiscussed).toContain(topic);
      });
    });
  });
});
