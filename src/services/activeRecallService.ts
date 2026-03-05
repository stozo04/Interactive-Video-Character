// src/services/activeRecallService.ts
/**
 * Active Recall Service
 *
 * Per-turn relevance matching for memory facts.
 * On each user message, retrieves the most relevant stored items
 * (user facts, character facts, storylines) and injects them into
 * the prompt for context-aware responses.
 *
 * Phase 2a: Lexical matching (deterministic, no embeddings)
 * Phase 2b: Semantic/hybrid retrieval with embedding index and lexical fallback
 */

import { getUserFacts, type UserFact } from "./memoryService";
import { getCharacterFacts, type CharacterFact } from "./characterFactsService";
import { getActiveStorylines, type LifeStoryline } from "./storylineService";
import { querySemanticFactEmbeddingMatches, type FactEmbeddingMatch } from "./factEmbeddingsService";
import { clientLogger } from "./clientLogger";

const log = clientLogger.scoped('ActiveRecall');

// ============================================================================
// Types
// ============================================================================

export enum RecallSourceType {
  USER_FACT = "user_fact",
  CHARACTER_FACT = "character_fact",
  STORYLINE = "storyline",
}

type ActiveRecallMode = "lexical" | "hybrid" | "semantic";
type FallbackMode = "none" | "lexical" | "empty";

export interface RecallCandidate {
  id: string;
  sourceType: RecallSourceType;
  key: string;
  value: string;
  updatedAt: string;
  confidence: number; // 0.0-1.0 (normalized)
  pinned: boolean; // user_facts only
}

export interface RankedRecallCandidate extends RecallCandidate {
  score: number;
  reasons: string[]; // ["semantic_match", "lexical_match", "key_bonus", "recent", ...]
}

// ============================================================================
// Configuration
// ============================================================================

// Size caps for prompt section
const SIZE_CAPS = {
  total_section: 900, // chars
  value_per_item: 140, // chars
  max_items: 7,
};

const ACTIVE_RECALL_ENABLED = true;
const ACTIVE_RECALL_MODE: ActiveRecallMode = "hybrid";
const ACTIVE_RECALL_LIMIT = 6;
const ACTIVE_RECALL_MIN_SCORE = 18;
const ACTIVE_RECALL_TIMEOUT_MS = 300;
const ACTIVE_RECALL_SEMANTIC_TOP_K = 30;
const ACTIVE_RECALL_SEMANTIC_MIN_SIM = 0.55;
const ACTIVE_RECALL_SEMANTIC_TIMEOUT_MS = 800;
const MIN_LEXICAL_SIGNAL_FOR_BOOSTS = 6;
const MIN_KEY_SIGNAL_FOR_BOOSTS = 8;
const MIN_LEXICAL_SIGNAL_FOR_SELECTION = 4;
const MIN_SEMANTIC_SIGNAL_FOR_SELECTION = 0.55;

function getConfig() {
  const rawLimit = ACTIVE_RECALL_LIMIT;
  const rawMinScore = ACTIVE_RECALL_MIN_SCORE;
  const rawTimeout = ACTIVE_RECALL_TIMEOUT_MS;
  const rawSemanticTopK = ACTIVE_RECALL_SEMANTIC_TOP_K;
  const rawSemanticMinSim = ACTIVE_RECALL_SEMANTIC_MIN_SIM;
  const rawSemanticTimeout = ACTIVE_RECALL_SEMANTIC_TIMEOUT_MS;

  return {
    enabled: ACTIVE_RECALL_ENABLED,
    mode: ACTIVE_RECALL_MODE,
    // Clamp lexical limit to 1..7
    limit: Math.min(SIZE_CAPS.max_items, Math.max(1, rawLimit)),
    // Keep threshold bounded
    minScore: Math.min(105, Math.max(0, rawMinScore)),
    timeoutMs: Math.max(50, rawTimeout),
    semanticTopK: Math.min(100, Math.max(1, rawSemanticTopK)),
    semanticMinSim: Math.min(1, Math.max(0, rawSemanticMinSim)),
    semanticTimeoutMs: Math.max(50, rawSemanticTimeout),
  };
}

// ============================================================================
// Candidate Mapping
// ============================================================================

function mapUserFacts(userFacts: UserFact[]): RecallCandidate[] {
  return userFacts.map((fact) => ({
    id: fact.id,
    sourceType: RecallSourceType.USER_FACT,
    key: fact.fact_key,
    value: fact.fact_value,
    updatedAt: fact.updated_at,
    confidence: fact.confidence,
    pinned: fact.pinned,
  }));
}

function mapCharacterFacts(characterFacts: CharacterFact[]): RecallCandidate[] {
  return characterFacts.map((fact) => ({
    id: fact.id,
    sourceType: RecallSourceType.CHARACTER_FACT,
    key: fact.fact_key,
    value: fact.fact_value,
    updatedAt: fact.updated_at,
    confidence: fact.confidence,
    pinned: false,
  }));
}

function mapStorylines(storylines: LifeStoryline[]): RecallCandidate[] {
  return storylines.map((storyline) => ({
    id: storyline.id,
    sourceType: RecallSourceType.STORYLINE,
    key: storyline.title,
    value: buildStorylineValue(storyline),
    updatedAt: storyline.updatedAt.toISOString(),
    confidence: 0.6,
    pinned: false,
  }));
}

function buildStorylineValue(storyline: LifeStoryline): string {
  const parts: string[] = [];

  if (storyline.initialAnnouncement) parts.push(storyline.initialAnnouncement);
  if (storyline.stakes) parts.push(storyline.stakes);
  if (storyline.currentEmotionalTone) parts.push(storyline.currentEmotionalTone);

  return parts.join(" ").trim();
}

function mapEmbeddingMatchToCandidate(match: FactEmbeddingMatch): RecallCandidate {
  const sourceType =
    match.source_type === "character_fact"
      ? RecallSourceType.CHARACTER_FACT
      : match.source_type === "storyline"
      ? RecallSourceType.STORYLINE
      : RecallSourceType.USER_FACT;

  return {
    id: match.source_id,
    sourceType,
    key: match.source_key,
    value: match.source_value,
    updatedAt: match.source_updated_at,
    confidence: Number(match.confidence ?? 0.6),
    pinned: !!match.pinned,
  };
}

// ============================================================================
// Tokenization
// ============================================================================

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "must",
  "can",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

// ============================================================================
// Scoring Functions
// ============================================================================

/**
 * Lexical overlap score (0-60 points)
 */
export function computeLexicalScore(messageTokens: string[], candidateTokens: string[]): number {
  const msgSet = new Set(messageTokens);
  const candSet = new Set(candidateTokens);

  if (msgSet.size === 0 || candSet.size === 0) return 0;

  const intersection = [...msgSet].filter((t) => candSet.has(t));
  const overlapRatio = intersection.length / Math.max(msgSet.size, candSet.size);
  return overlapRatio * 60;
}

/**
 * Key bonus (0-15 points)
 */
export function computeKeyBonus(messageTokens: string[], keyTokens: string[]): number {
  const msgSet = new Set(messageTokens);
  const keySet = new Set(keyTokens);

  if (keySet.size === 0) return 0;

  const keyMatches = [...keySet].filter((t) => msgSet.has(t)).length;
  if (keyMatches === keySet.size) return 15;
  if (keyMatches > 0) return 8;
  return 0;
}

/**
 * Recency boost (0-15 points)
 */
export function computeRecencyBoost(updatedAt: string): number {
  const daysSince = daysBetween(updatedAt, new Date());
  if (daysSince <= 7) return 15;
  if (daysSince <= 30) return 8;
  return 0;
}

/**
 * Confidence boost (0-10 points)
 */
export function computeConfidenceBoost(confidence: number): number {
  return Math.round(Math.min(1, Math.max(0, confidence)) * 10);
}

/**
 * Pinned boost (0-5 points)
 */
export function computePinnedBoost(pinned: boolean): number {
  return pinned ? 5 : 0;
}

// ============================================================================
// Helper Functions
// ============================================================================

function daysBetween(dateStr: string, now: Date): number {
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function getCandidateText(candidate: RecallCandidate): string {
  return `${candidate.key} ${candidate.value}`.trim();
}

function buildReasonList(parts: {
  semantic?: number;
  lexical: number;
  keyBonus: number;
  recency: number;
  confidence: number;
  pinned: number;
}): string[] {
  const reasons: string[] = [];
  if ((parts.semantic || 0) > 0) reasons.push("semantic_match");
  if (parts.lexical > 0) reasons.push("lexical_match");
  if (parts.keyBonus > 0) reasons.push("key_bonus");
  if (parts.recency > 0) reasons.push("recent");
  if (parts.confidence > 0) reasons.push("confidence");
  if (parts.pinned > 0) reasons.push("pinned");
  return reasons;
}

function deduplicateCandidates(candidates: RankedRecallCandidate[]): RankedRecallCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const fingerprint = `${c.sourceType}:${c.key}:${c.value.toLowerCase()}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function sortAndTrim(
  candidates: RankedRecallCandidate[],
  minScore: number,
  maxItems: number
): RankedRecallCandidate[] {
  const aboveThreshold = candidates.filter((c) => c.score >= minScore);
  const deduped = deduplicateCandidates(aboveThreshold);

  deduped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return deduped.slice(0, maxItems);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

function timeoutAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

// ============================================================================
// Lexical Retrieval (Phase 2A)
// ============================================================================

/**
 * Get ranked recall candidates for a given user message.
 * Fetches from all 3 sources, scores them, and returns top N.
 */
export async function getRankedRecallCandidates(
  userMessage: string,
  maxItems: number = 6
): Promise<RankedRecallCandidate[]> {
  const startTime = Date.now();
  const config = getConfig();

  try {
    const [userFacts, characterFacts, storylines] = await Promise.all([
      getUserFacts("all"),
      getCharacterFacts(),
      getActiveStorylines(),
    ]);

    const candidates: RecallCandidate[] = [
      ...mapUserFacts(userFacts),
      ...mapCharacterFacts(characterFacts),
      ...mapStorylines(storylines),
    ];

    const messageTokens = tokenize(userMessage);
    if (messageTokens.length === 0) {
      log.verbose('Message too short, no tokens');
      return [];
    }

    const scored: RankedRecallCandidate[] = candidates.map((cand) => {
      const candTokens = tokenize(getCandidateText(cand));
      const keyTokens = tokenize(cand.key);

      const lexical = computeLexicalScore(messageTokens, candTokens);
      const keyBonus = computeKeyBonus(messageTokens, keyTokens);

      // Strong-signal gating: avoids boosting weak accidental overlaps.
      const hasStrongRelevance =
        lexical >= MIN_LEXICAL_SIGNAL_FOR_BOOSTS || keyBonus >= MIN_KEY_SIGNAL_FOR_BOOSTS;
      const recency = hasStrongRelevance ? computeRecencyBoost(cand.updatedAt) : 0;
      const confidence = hasStrongRelevance ? computeConfidenceBoost(cand.confidence) : 0;
      const pinned = hasStrongRelevance ? computePinnedBoost(cand.pinned) : 0;

      return {
        ...cand,
        score: lexical + keyBonus + recency + confidence + pinned,
        reasons: buildReasonList({
          lexical,
          keyBonus,
          recency,
          confidence,
          pinned,
        }),
      };
    });

    const scoredWithSignal = scored.filter(
      (cand) =>
        cand.score > 0 &&
        (cand.reasons.includes("key_bonus") ||
          computeLexicalScore(messageTokens, tokenize(getCandidateText(cand))) >=
            MIN_LEXICAL_SIGNAL_FOR_SELECTION)
    );

    const selected = sortAndTrim(scoredWithSignal, config.minScore, maxItems);
    const durationMs = Date.now() - startTime;

    log.info('Retrieved lexical candidates', {
      mode: "lexical",
      messageTokenCount: messageTokens.length,
      candidateCount: candidates.length,
      weakFilteredCount: scored.length - scoredWithSignal.length,
      eligibleCount: scoredWithSignal.length,
      selectedCount: selected.length,
      durationMs,
      featureEnabled: config.enabled,
      timedOut: false,
    });

    return selected;
  } catch (err) {
    log.error('getRankedRecallCandidates failed', { err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

// ============================================================================
// Semantic / Hybrid Retrieval (Phase 2B)
// ============================================================================

function scoreSemanticCandidate(
  mode: ActiveRecallMode,
  messageTokens: string[],
  candidate: RecallCandidate,
  similarity: number
): RankedRecallCandidate {
  const semanticScore = Math.max(0, Math.min(1, similarity)) * 70;
  const candidateTokens = tokenize(getCandidateText(candidate));
  const keyTokens = tokenize(candidate.key);

  const lexical = mode === "hybrid" ? computeLexicalScore(messageTokens, candidateTokens) : 0;
  const keyBonus = mode === "hybrid" ? computeKeyBonus(messageTokens, keyTokens) : 0;
  const hasRelevance = semanticScore > 0 || lexical > 0 || keyBonus > 0;
  const recency = hasRelevance ? computeRecencyBoost(candidate.updatedAt) : 0;
  const confidence = hasRelevance ? computeConfidenceBoost(candidate.confidence) : 0;
  const pinned = hasRelevance ? computePinnedBoost(candidate.pinned) : 0;

  return {
    ...candidate,
    score: semanticScore + lexical + keyBonus + recency + confidence + pinned,
    reasons: buildReasonList({
      semantic: semanticScore,
      lexical,
      keyBonus,
      recency,
      confidence,
      pinned,
    }),
  };
}

export async function getRankedRecallCandidatesSemantic(
  userMessage: string,
  maxItems: number = 6
): Promise<RankedRecallCandidate[]> {
  const startTime = Date.now();
  const config = getConfig();
  const messageTokens = tokenize(userMessage);

  if (messageTokens.length === 0) {
    log.verbose('Semantic retrieval skipped (message too short)');
    return [];
  }

  try {
    const matches = await querySemanticFactEmbeddingMatches({
      queryText: userMessage,
      topK: config.semanticTopK,
      minSimilarity: config.semanticMinSim,
    });

    const semanticEligible = matches.filter(
      (match) => (match.similarity ?? 0) >= MIN_SEMANTIC_SIGNAL_FOR_SELECTION
    );

    const scored: RankedRecallCandidate[] = semanticEligible.map((match: FactEmbeddingMatch) =>
      scoreSemanticCandidate(
        config.mode,
        messageTokens,
        mapEmbeddingMatchToCandidate(match),
        match.similarity
      )
    );

    const selected = sortAndTrim(scored, config.minScore, maxItems);
    const durationMs = Date.now() - startTime;

    log.info('Retrieved semantic candidates', {
      mode: config.mode,
      semanticTopK: config.semanticTopK,
      semanticCandidates: matches.length,
      semanticEligibleCount: semanticEligible.length,
      semanticSelectionMinSim: MIN_SEMANTIC_SIGNAL_FOR_SELECTION,
      semanticMinSim: config.semanticMinSim,
      selectedCount: selected.length,
      durationMs,
      featureEnabled: config.enabled,
      timedOut: false,
    });

    return selected;
  } catch (err) {
    log.error('getRankedRecallCandidatesSemantic failed', {
      err: err instanceof Error ? err.message : String(err),
      mode: config.mode,
    });
    return [];
  }
}

// ============================================================================
// Prompt Section Builder
// ============================================================================

/**
 * Build active recall prompt section for injection into system prompt.
 * Returns empty string if feature disabled, no message, or retrieval fails.
 */
export async function buildActiveRecallPromptSection(
  currentUserMessage: string | undefined
): Promise<string> {
  const config = getConfig();

  if (!config.enabled) return "";
  if (!currentUserMessage) {
    log.verbose('Skipped (no current user message)');
    return "";
  }

  let candidates: RankedRecallCandidate[] = [];
  let fallbackUsed: FallbackMode = "none";
  let timedOut = false;

  try {
    if (config.mode === "lexical") {
      candidates = await Promise.race([
        getRankedRecallCandidates(currentUserMessage, config.limit),
        timeoutAfter(config.timeoutMs, "LexicalTimeout"),
      ]);
    } else {
      const semanticPromise = getRankedRecallCandidatesSemantic(currentUserMessage, config.limit);
      try {
        candidates = await Promise.race([
          semanticPromise,
          timeoutAfter(config.semanticTimeoutMs, "SemanticTimeout"),
        ]);

        if (!candidates.length) {
          fallbackUsed = "lexical";
          candidates = await Promise.race([
            getRankedRecallCandidates(currentUserMessage, config.limit),
            timeoutAfter(config.timeoutMs, "LexicalTimeout"),
          ]);
        }
      } catch (semanticErr) {
        fallbackUsed = "lexical";
        const semanticErrorMessage =
          semanticErr instanceof Error ? semanticErr.message : String(semanticErr);
        timedOut =
          semanticErrorMessage === "SemanticTimeout" || semanticErrorMessage === "LexicalTimeout";

        // Lexical fallback may already have been attempted in the semantic branch.
        // If that attempt timed out, avoid a duplicate retry and let outer handler fail-open.
        if (semanticErrorMessage === "LexicalTimeout") {
          log.warning('Semantic retrieval failed, lexical path timed out', {
            mode: config.mode,
            featureEnabled: config.enabled,
            timedOut,
            error: semanticErrorMessage,
          });
          throw semanticErr;
        }

        const lexicalPromise = Promise.race([
          getRankedRecallCandidates(currentUserMessage, config.limit),
          timeoutAfter(config.timeoutMs, "LexicalTimeout"),
        ]);

        if (semanticErrorMessage === "SemanticTimeout") {
          // Semantic may complete milliseconds after timeout. Race that late result
          // against lexical fallback and use whichever returns first.
          try {
            const winner = await Promise.race([
              semanticPromise.then((result) => ({ source: "semantic" as const, result })),
              lexicalPromise.then((result) => ({ source: "lexical" as const, result })),
            ]);

            candidates = winner.result;
            if (winner.source === "semantic") {
              if (winner.result.length === 0) {
                // Semantic recovered but empty — prefer lexical
                try {
                  candidates = await lexicalPromise;
                  fallbackUsed = "lexical";
                } catch {
                  // lexical also failed, keep empty
                }
                log.info('Semantic won race but empty, used lexical fallback', {
                  mode: config.mode,
                  lexicalCount: candidates.length,
                });
              } else {
                fallbackUsed = "none";
                timedOut = false;
                log.info('Semantic retrieval recovered after timeout window', {
                  mode: config.mode,
                  featureEnabled: config.enabled,
                  fallbackUsed,
                  timedOut,
                });
              }
            } else {
              log.warning('Semantic timeout; using lexical fallback winner', {
                mode: config.mode,
                featureEnabled: config.enabled,
                timedOut,
                error: semanticErrorMessage,
              });
            }
          } catch {
            log.warning('Semantic timeout race failed; using lexical fallback', {
              mode: config.mode,
              featureEnabled: config.enabled,
              timedOut,
              error: semanticErrorMessage,
            });
            try {
              candidates = await lexicalPromise;
            } catch {
              // lexical also timed out — fail open with empty
              candidates = [];
            }
          }
        } else {
          log.warning('Semantic retrieval failed, using lexical fallback', {
            mode: config.mode,
            featureEnabled: config.enabled,
            timedOut,
            error: semanticErrorMessage,
          });
          candidates = await lexicalPromise;
        }
      }
    }

    if (!candidates.length) {
      fallbackUsed = fallbackUsed === "none" ? "empty" : fallbackUsed;
      return "";
    }

    const items = candidates
      .map((c) => {
        const truncatedValue = truncate(c.value, SIZE_CAPS.value_per_item);
        return `- ${c.sourceType}.${c.key}: ${truncatedValue}`;
      })
      .join("\n");

    const section = `
====================================================
ACTIVE RECALL (relevant memory for this message)
====================================================
${items}

Use these only if relevant to the current user message.
If current user message conflicts, trust the current message.
====================================================
`.trim();

    const finalSection =
      section.length > SIZE_CAPS.total_section ? truncate(section, SIZE_CAPS.total_section) : section;

    log.info('Built recall section', {
      mode: config.mode,
      selectedCount: candidates.length,
      fallbackUsed,
      featureEnabled: config.enabled,
      timedOut,
    });

    return finalSection;
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.message === "LexicalTimeout" || err.message === "SemanticTimeout");

    if (isTimeout) {
      log.warning('Failed to build section', {
        err: err instanceof Error ? err.message : String(err),
        mode: config.mode,
        featureEnabled: config.enabled,
        timedOut: true,
        fallbackUsed,
      });
    } else {
      log.error('Failed to build section', {
        err: err instanceof Error ? err.message : String(err),
        mode: config.mode,
        featureEnabled: config.enabled,
        timedOut: false,
        fallbackUsed,
      });
    }
    return "";
  }
}
