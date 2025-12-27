/**
 * Association Engine
 *
 * Matches pending shares to current conversation topics, enabling Kayley
 * to naturally bring up things she's been wanting to share when relevant
 * topics come up ("Oh! Speaking of work, I've been meaning to tell you...").
 */

import type { PendingShare, AssociationMatch } from "./types";

// ============================================================================
// RELATED TOPICS MAPPING
// ============================================================================

/**
 * Mapping of semantically related topics
 * Each key is a "topic group" with related words
 */
const RELATED_TOPICS: Record<string, string[]> = {
  work: ["work", "job", "career", "office", "boss", "coworker", "meeting", "client", "project", "deadline"],
  family: ["family", "mom", "dad", "mother", "father", "parents", "brother", "sister", "sibling"],
  relationship: ["relationship", "dating", "boyfriend", "girlfriend", "partner", "romance", "love", "crush"],
  stress: ["stress", "stressed", "anxiety", "anxious", "overwhelmed", "busy", "pressure"],
  happy: ["happy", "joy", "joyful", "excited", "thrilled", "glad"],
  sad: ["sad", "depressed", "depression", "upset", "down", "blue"],
  angry: ["angry", "frustrated", "frustration", "mad", "annoyed", "irritated"],
  gaming: ["gaming", "games", "video games", "game", "gamer", "playing"],
  music: ["music", "concert", "band", "song", "singing", "album", "artist"],
  coffee: ["coffee", "cafe", "drink", "morning", "caffeine", "latte", "espresso"],
  ai: ["ai", "tech", "technology", "machine learning", "chatgpt", "automation", "artificial intelligence"],
  content: ["content", "video", "youtube", "tiktok", "filming", "editing", "streaming"],
  food: ["food", "eating", "restaurant", "cooking", "dinner", "lunch", "breakfast", "meal"],
  sleep: ["sleep", "sleeping", "tired", "nap", "rest", "dream", "insomnia"],
  health: ["health", "fitness", "gym", "workout", "exercise", "running", "yoga"],
  travel: ["travel", "trip", "vacation", "flight", "hotel", "adventure", "destination"],
};

// ============================================================================
// SIMILARITY CALCULATION
// ============================================================================

/**
 * Calculate the similarity between two topics
 * Returns:
 * - 1.0 for exact match
 * - 0.8 for contains match (one topic contains the other, but not via related topics)
 * - 0.6 for related topics (from the same semantic group)
 * - 0 for unrelated topics
 */
export function calculateTopicSimilarity(topic1: string, topic2: string): number {
  // Handle empty strings
  if (!topic1.trim() || !topic2.trim()) {
    return 0;
  }

  const t1 = topic1.toLowerCase().trim();
  const t2 = topic2.toLowerCase().trim();

  // Exact match
  if (t1 === t2) {
    return 1.0;
  }

  // Check if both topics are in the same related group first
  // This handles cases like "work" and "coworker" which should be 0.6 (related)
  // not 0.8 (contains), even though "coworker" contains "work"
  for (const group of Object.values(RELATED_TOPICS)) {
    const t1InGroup = group.some((r) => t1 === r || r === t1);
    const t2InGroup = group.some((r) => t2 === r || r === t2);

    if (t1InGroup && t2InGroup) {
      return 0.6;
    }
  }

  // Contains match (one topic contains the other)
  // Only if not already matched as related topics
  if (t1.includes(t2) || t2.includes(t1)) {
    return 0.8;
  }

  // Check for partial word matches in related groups
  for (const group of Object.values(RELATED_TOPICS)) {
    const t1InGroup = group.some((r) => t1.includes(r) || r.includes(t1));
    const t2InGroup = group.some((r) => t2.includes(r) || r.includes(t2));

    if (t1InGroup && t2InGroup) {
      return 0.6;
    }
  }

  // No match
  return 0;
}

// ============================================================================
// ASSOCIATION FINDING
// ============================================================================

/**
 * Find pending shares that match current conversation topics
 * Returns matches sorted by relevance score (highest first)
 */
export function findRelevantAssociations(
  pendingShares: PendingShare[],
  currentTopics: string[]
): AssociationMatch[] {
  // Handle empty inputs
  if (pendingShares.length === 0 || currentTopics.length === 0) {
    return [];
  }

  // Clean current topics
  const cleanTopics = currentTopics
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (cleanTopics.length === 0) {
    return [];
  }

  // Map to track best match per share
  const bestMatchPerShare = new Map<string, AssociationMatch>();

  for (const share of pendingShares) {
    // Skip shares with no relevance topics
    if (!share.relevanceTopics || share.relevanceTopics.length === 0) {
      continue;
    }

    let bestScore = 0;
    let bestMatchedTopic = "";

    // Check each combination of relevance topic and current topic
    for (const relevanceTopic of share.relevanceTopics) {
      for (const currentTopic of cleanTopics) {
        const similarity = calculateTopicSimilarity(relevanceTopic, currentTopic);

        if (similarity > 0 && similarity > bestScore) {
          bestScore = similarity;
          bestMatchedTopic = currentTopic;
        }
      }
    }

    // If we found a match, add it
    if (bestScore > 0) {
      // Factor in urgency - multiply score by (1 + urgency * 0.5)
      // This gives urgency some weight but doesn't overwhelm similarity
      const urgencyBoost = share.urgency * 0.5;
      const finalScore = bestScore * (1 + urgencyBoost);

      bestMatchPerShare.set(share.id, {
        share,
        matchedTopic: bestMatchedTopic,
        relevanceScore: bestScore, // Keep original similarity for display
      });
    }
  }

  // Convert to array and sort by relevance + urgency
  const matches = Array.from(bestMatchPerShare.values());

  matches.sort((a, b) => {
    // First by relevance score
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    // Then by urgency
    return b.share.urgency - a.share.urgency;
  });

  return matches;
}

// ============================================================================
// OPENER GENERATION
// ============================================================================

/**
 * Generate a natural association opener based on the match
 * All openers include the matched topic and natural conversational elements
 */
export function generateAssociationOpener(match: AssociationMatch): string {
  const { matchedTopic } = match;

  // Various opener templates - all include the matched topic and conversational elements
  // Each opener contains at least one of: "oh/Oh", "speaking of/Speaking of", "that reminds me/That reminds me"
  const openers = [
    `Oh wait, you mentioning ${matchedTopic} reminds me -`,
    `Oh random but ${matchedTopic} just made me think of something -`,
    `Speaking of ${matchedTopic} -`,
    `Oh! ${matchedTopic}! That reminds me -`,
    `Oh, since we're talking about ${matchedTopic} -`,
    `Oh that's funny, ${matchedTopic} made me think of -`,
    `Oh so ${matchedTopic} reminded me of something -`,
    `Oh, you brought up ${matchedTopic} - that reminds me -`,
    `Oh, ${matchedTopic}! I've been meaning to tell you -`,
  ];

  // Select a random opener
  const index = Math.floor(Math.random() * openers.length);
  return openers[index];
}
