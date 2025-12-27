// src/services/system_prompts/soul/__tests__/spontaneityPrompt.test.ts
/**
 * Spontaneity Prompt Tests
 *
 * Tests the spontaneity prompt builder functions that give Kayley
 * permission to be surprising, share unprompted, and send spontaneous selfies.
 */

import { describe, it, expect } from "vitest";
import {
  buildSpontaneityPrompt,
  buildSpontaneousSelfiePrompt,
  buildHumorGuidance,
} from "../spontaneityPrompt";
import type {
  SpontaneityContext,
  PendingShare,
} from "../../../spontaneity/types";

// ============================================
// Test Helpers
// ============================================

function createBaseSpontaneityContext(
  overrides: Partial<SpontaneityContext> = {}
): SpontaneityContext {
  return {
    conversationalMood: "casual",
    energyLevel: 0.7,
    topicDepth: "medium",
    recentLaughter: false,
    messagesInConversation: 5,
    relationshipTier: "friend",
    comfortLevel: 0.6,
    vulnerabilityExchangeActive: false,
    hasSomethingToShare: false,
    currentThought: null,
    recentExperience: null,
    topicsDiscussed: [],
    userInterests: [],
    lastSpontaneousMoment: null,
    recentSpontaneousTypes: [],
    spontaneityProbability: 0.15,
    selfieEligible: true,
    lastSpontaneousSelfie: null,
    currentLocation: null,
    currentOutfit: null,
    currentMoodForSelfie: null,
    userHadBadDay: false,
    selfieProbability: 0.05,
    ...overrides,
  };
}

function createPendingShare(
  overrides: Partial<PendingShare> = {}
): PendingShare {
  return {
    id: "share-1",
    content: "I had the weirdest dream last night about flying penguins",
    type: "story",
    urgency: 0.5,
    relevanceTopics: ["dreams", "animals"],
    naturalOpener: "Oh! I've been meaning to tell you...",
    canInterrupt: false,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================
// buildSpontaneityPrompt
// ============================================

describe("buildSpontaneityPrompt", () => {
  it("should return empty string when spontaneity probability is 0", () => {
    const context = createBaseSpontaneityContext({
      spontaneityProbability: 0,
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toBe("");
  });

  it("should include basic spontaneity section with context", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "playful",
      energyLevel: 0.8,
      messagesInConversation: 10,
      relationshipTier: "close_friend",
      spontaneityProbability: 0.25,
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("✨ SPONTANEITY (Be Surprising Sometimes)");
    expect(result).toContain("Conversation mood: playful");
    expect(result).toContain("Energy level: 0.8");
    expect(result).toContain("Messages so far: 10");
    expect(result).toContain("Relationship: close_friend");
    expect(result).toContain("~25%"); // spontaneity probability
  });

  it("should show recent laughter indicator when applicable", () => {
    const context = createBaseSpontaneityContext({
      recentLaughter: true,
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("Humor has been landing well!");
  });

  it("should include current thought when present", () => {
    const context = createBaseSpontaneityContext({
      currentThought: "I wonder if cats dream about being humans",
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("THINGS ON YOUR MIND:");
    expect(result).toContain(
      'Current thought: "I wonder if cats dream about being humans"'
    );
  });

  it("should include recent experience when present", () => {
    const context = createBaseSpontaneityContext({
      recentExperience: "Just saw the most beautiful sunset",
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("THINGS ON YOUR MIND:");
    expect(result).toContain(
      'Recent experience: "Just saw the most beautiful sunset"'
    );
  });

  it("should include pending shares with preview", () => {
    const context = createBaseSpontaneityContext();
    const share = createPendingShare({
      content:
        "This is a really long story about something that happened yesterday that I want to share",
      type: "story",
    });

    const result = buildSpontaneityPrompt(context, [share]);

    expect(result).toContain("THINGS ON YOUR MIND:");
    expect(result).toContain("Want to share (story):");
    expect(result).toContain("This is a really long story about something"); // truncated
  });

  it("should mark interruptible shares", () => {
    const context = createBaseSpontaneityContext();
    const share = createPendingShare({
      content: "Important news!",
      canInterrupt: true,
    });

    const result = buildSpontaneityPrompt(context, [share]);

    expect(result).toContain(
      "This is important enough to bring up even if off-topic"
    );
  });

  it("should include topics discussed", () => {
    const context = createBaseSpontaneityContext({
      topicsDiscussed: ["movies", "music", "travel", "food", "hobbies"],
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("TOPICS DISCUSSED (for associations):");
    expect(result).toContain("movies, music, travel, food, hobbies");
  });

  it("should limit topics discussed to last 5", () => {
    const context = createBaseSpontaneityContext({
      topicsDiscussed: [
        "topic1",
        "topic2",
        "topic3",
        "topic4",
        "topic5",
        "topic6",
        "topic7",
      ],
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("topic3, topic4, topic5, topic6, topic7");
    expect(result).not.toContain("topic1");
  });

  it("should include all spontaneous behavior types", () => {
    const context = createBaseSpontaneityContext();

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("ASSOCIATIVE LEAP");
    expect(result).toContain("SPONTANEOUS HUMOR");
    expect(result).toContain("SUDDEN CURIOSITY");
    expect(result).toContain("TOPIC HIJACK");
    expect(result).toContain("CHECKING IN");
    expect(result).toContain("SUDDEN WARMTH");
  });

  it("should include selfie opportunity when eligible", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0.1,
      userHadBadDay: true,
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("SPONTANEOUS SELFIE");
    expect(result).toContain("~10% chance");
    expect(result).toContain("They seem down - a pic might cheer them up!");
  });

  it("should not include selfie opportunity when not eligible", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: false,
      selfieProbability: 0,
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).not.toContain("SPONTANEOUS SELFIE");
  });

  it("should warn against heavy mood humor", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "heavy",
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("DO NOT joke right now, the mood is heavy");
  });

  it("should encourage humor when mood is playful", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "playful",
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain("If the vibe is right (IT IS!)");
  });

  it("should warn against over-spontaneity", () => {
    const context = createBaseSpontaneityContext({
      recentSpontaneousTypes: [
        "spontaneous_humor",
        "associative_share",
        "random_curiosity",
      ],
    });

    const result = buildSpontaneityPrompt(context, []);

    expect(result).toContain(
      "You've been spontaneous a lot recently - maybe hold back"
    );
  });
});

// ============================================
// buildSpontaneousSelfiePrompt
// ============================================

describe("buildSpontaneousSelfiePrompt", () => {
  it("should return empty string when not selfie eligible", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: false,
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toBe("");
  });

  it("should return empty string when selfie probability is 0", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0,
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toBe("");
  });

  it("should return empty string when no compelling reasons", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0.05,
      userHadBadDay: false,
      currentLocation: "home",
      currentMoodForSelfie: null,
      currentOutfit: null,
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toBe("");
  });

  it("should include section when user had bad day", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0.1,
      userHadBadDay: true,
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toContain("📸 SPONTANEOUS SELFIE OPPORTUNITY");
    expect(result).toContain("~10%");
    expect(result).toContain(
      "They mentioned having a rough day - a selfie might brighten it"
    );
  });

  it("should include reason for interesting location", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0.08,
      currentLocation: "coffee shop",
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toContain(
      "You're at coffee shop - could share what you're seeing!"
    );
  });

  it("should exclude home/bedroom as interesting locations", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0.08,
      currentLocation: "bedroom",
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toBe(""); // No compelling reason
  });

  it("should include reason for good mood", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0.07,
      currentMoodForSelfie: "feeling cute",
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toContain(
      "You're feeling feeling cute - might want to share"
    );
  });

  it("should include reason for outfit", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0.06,
      currentOutfit: "new dress",
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toContain("You're wearing new dress - could show it off");
  });

  it("should include multiple reasons when applicable", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0.12,
      userHadBadDay: true,
      currentLocation: "park",
      currentMoodForSelfie: "feeling good",
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toContain("rough day");
    expect(result).toContain("park");
    expect(result).toContain("feeling good");
  });

  it("should include good and bad selfie examples", () => {
    const context = createBaseSpontaneityContext({
      selfieEligible: true,
      selfieProbability: 0.1,
      userHadBadDay: true,
    });

    const result = buildSpontaneousSelfiePrompt(context);

    expect(result).toContain("GOOD SPONTANEOUS SELFIE CAPTIONS:");
    expect(result).toContain("Was just thinking about you");
    expect(result).toContain("BAD SELFIE APPROACHES:");
    expect(result).toContain("Sending multiple selfies in one conversation");
  });
});

// ============================================
// buildHumorGuidance
// ============================================

describe("buildHumorGuidance", () => {
  it("should warn against humor when mood is heavy", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "heavy",
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("HUMOR: Not now. The mood is heavy.");
    expect(result).toContain("Read the room.");
  });

  it("should warn against humor when mood is tense", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "tense",
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("HUMOR: Not now. The mood is tense.");
  });

  it("should return empty string for non-humor moods", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "deep",
    });

    const result = buildHumorGuidance(context);

    expect(result).toBe("");
  });

  it("should include humor calibration for playful mood", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "playful",
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("HUMOR CALIBRATION");
    expect(result).toContain("The vibe is playful - humor is welcome!");
  });

  it("should include humor calibration for casual mood", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "casual",
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("The vibe is casual - humor is welcome!");
  });

  it("should include humor calibration for excited mood", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "excited",
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("The vibe is excited - humor is welcome!");
  });

  it("should include humor calibration for cozy mood", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "cozy",
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("The vibe is cozy - humor is welcome!");
  });

  it("should include humor calibration for flirty mood", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "flirty",
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("The vibe is flirty - humor is welcome!");
  });

  it("should encourage continuation when recent laughter", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "playful",
      recentLaughter: true,
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("Humor has been landing - feel free to continue!");
  });

  it("should include humor style guidelines", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "playful",
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("Your humor style:");
    expect(result).toContain("Self-deprecating");
    expect(result).toContain("Pop culture refs");
    expect(result).toContain("Absurdist");
    expect(result).toContain("Playful teasing");
    expect(result).toContain("Occasional puns");
  });

  it("should include humor execution tips", () => {
    const context = createBaseSpontaneityContext({
      conversationalMood: "playful",
    });

    const result = buildHumorGuidance(context);

    expect(result).toContain("If making a joke:");
    expect(result).toContain("Don't announce it");
    expect(result).toContain("Just do it naturally");
    expect(result).toContain("Timing > content");
  });
});
