// server/services/memoryClassifier.ts
//
// Stage 1 (shadow mode): classifies proposed memory writes using a single Gemini call
// that combines lifecycle classification + semantic deduplication.
//
// Currently fire-and-forget — decisions are logged but writes are NOT gated.
// Stage 2 will use the returned decision to gate/redirect writes.
// From Claude:  The memory I updated is outside the project at C:\Users\gates\.claude\projects\...\memory\MEMORY.md — that's my private cross-session memory, not visible in your IDE.
import { ai } from "./ai/geminiClient";
import { querySemanticFactEmbeddingMatches } from "../../src/services/factEmbeddingsService";
import { log } from "../runtimeLogger";

const runtimeLog = log.fromContext({ source: "memoryClassifier" });

// ============================================
// Types
// ============================================

export type MemoryClass = "immutable" | "durable" | "situational" | "episodic" | "reject";
export type ClassifierDecision = "create_new" | "update_existing" | "merge_existing" | "duplicate" | "reject";

export interface ClassifierInput {
  domain: "user" | "character";
  category: string;
  proposed_key: string;
  proposed_value: string;
}

export interface ClassifierResult {
  memory_class: MemoryClass;
  canonical_category: string;
  canonical_key: string;
  concept_id: string;
  normalized_value: string;
  ttl_hours: number;
  decision: ClassifierDecision;
  target_id: string | null;
  reason: string;
  confidence: number;
}

// ============================================
// Immutable allowlist
// Only these concept_ids can ever be classified as immutable.
// Everything else gets downgraded to durable.
// ============================================

const IMMUTABLE_ALLOWLIST = new Set([
  "identity.birth_date",
  "identity.legal_name",
]);

// ============================================
// Classifier system prompt
// ============================================

const CLASSIFIER_SYSTEM_PROMPT = `You are a memory classifier for an AI companion named Kayley Adams.

Your job: given a proposed fact to store in memory plus semantic candidates from existing memory, return a single structured JSON decision that covers both lifecycle classification and deduplication.

## Memory Classes

- immutable: core identity anchors that never change (birth date, legal name only — extremely rare)
- durable: stable long-term facts that are true across weeks/months (name, preferences, relationships, personality traits)
- situational: currently true but will expire soon — days or weeks (e.g., "working on X project", "going through a hard time", "recovering from illness")
- episodic: a specific past event or snapshot in time (e.g., "had sushi on Jan 5", "celebrated birthday last night", "went to Houston for Christmas")
- reject: should not be stored at all

## When to REJECT

Reject if the proposed fact is ANY of:
- A sensitive credential (password, token, API key, secret)
- A system/code implementation detail (file path, module name, database table, code reference)
- Transient state using words like: currently, right now, today, tonight, this morning, this week, just now, at the moment
- A vague fact with no durable meaning (value is just "true", "yes", "no", a single generic word)
- Already fully captured by an existing semantic candidate (exact duplicate — no new information)
- Something that belongs in a profile/config file, not a memory row

## Dedupe Decisions (given semantic candidates)

- duplicate: same concept, same or equivalent value already stored — skip the write entirely
- update_existing: same concept, but the new value supersedes the old — update target_id row
- merge_existing: overlapping but complementary — could combine into one row (use target_id of the row to merge into)
- create_new: genuinely new concept not covered by any candidate
- reject: should not be stored regardless of candidates

## Key Normalization Rules

- Use snake_case
- Be specific: prefer "favorite_drink_whiskey" over "drink"
- concept_id format: domain.concept (e.g., identity.birth_date, preference.favorite_drink, relationship.daughter_name)
- If a close candidate key exists, reuse it rather than inventing a new one
- Normalize values: trim whitespace, fix obvious typos, standardize formatting

## Output

Return ONLY valid JSON — no markdown, no code fences, no explanation outside the JSON:
{
  "memory_class": "immutable|durable|situational|episodic|reject",
  "canonical_category": "string",
  "canonical_key": "string",
  "concept_id": "string",
  "normalized_value": "string",
  "ttl_hours": 0,
  "decision": "create_new|update_existing|merge_existing|duplicate|reject",
  "target_id": "uuid-or-null",
  "reason": "1-2 sentences explaining the decision",
  "confidence": 0.0
}`;

// ============================================
// Main classifier
// ============================================

export async function classifyMemoryWrite(
  input: ClassifierInput
): Promise<ClassifierResult | null> {
  try {
    const sourceType = input.domain === "user" ? "user_fact" : "character_fact";
    const queryText = `${input.category}.${input.proposed_key}: ${input.proposed_value}`;

    // Step 1: semantic candidate lookup
    const candidates = await querySemanticFactEmbeddingMatches({
      queryText,
      topK: 5,
      minSimilarity: 0.6,
    });

    const domainCandidates = candidates.filter((c) => c.source_type === sourceType);

    // Step 2: build user prompt
    const candidatesText =
      domainCandidates.length > 0
        ? domainCandidates
            .map(
              (c) =>
                `  - id: ${c.source_id} | key: ${c.source_key} | value: "${c.source_value}" | similarity: ${c.similarity.toFixed(2)}`
            )
            .join("\n")
        : "  (none)";

    const userPrompt = [
      `Domain: ${input.domain}`,
      `Category: ${input.category}`,
      `Proposed key: ${input.proposed_key}`,
      `Proposed value: ${input.proposed_value}`,
      ``,
      `Semantic candidates from existing memory (similarity >= 0.60):`,
      candidatesText,
      ``,
      `Classify this fact and return the JSON decision.`,
    ].join("\n");

    // Step 3: call Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: CLASSIFIER_SYSTEM_PROMPT,
        temperature: 0.1,
        maxOutputTokens: 512,
      },
    });

    const rawText =
      response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    if (!rawText) {
      runtimeLog.warning("Classifier returned empty response", { input });
      return null;
    }

    // Strip markdown code fences if present
    const jsonText = rawText
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();

    const result = JSON.parse(jsonText) as ClassifierResult;

    // Enforce immutable allowlist — downgrade anything not on the list
    if (
      result.memory_class === "immutable" &&
      !IMMUTABLE_ALLOWLIST.has(result.concept_id)
    ) {
      runtimeLog.warning(
        "Classifier returned immutable for non-allowlisted concept — downgrading to durable",
        { concept_id: result.concept_id, proposed_key: input.proposed_key }
      );
      result.memory_class = "durable";
    }

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    runtimeLog.error("Classifier failed", { error: errorMsg, input });
    return null;
  }
}

// ============================================
// Shadow mode runner (Stage 1)
// Fire-and-forget — logs the decision, does NOT affect writes.
// Replace this with gated writes in Stage 2.
// ============================================

export function runClassifierShadow(input: ClassifierInput): void {
  classifyMemoryWrite(input)
    .then((result) => {
      if (!result) return;
      runtimeLog.info("Shadow classifier decision", {
        domain: input.domain,
        proposed_key: input.proposed_key,
        memory_class: result.memory_class,
        decision: result.decision,
        canonical_key: result.canonical_key,
        concept_id: result.concept_id,
        target_id: result.target_id,
        confidence: result.confidence,
        reason: result.reason,
      });
    })
    .catch((err) => {
      runtimeLog.error("Shadow classifier threw unexpectedly", {
        error: err instanceof Error ? err.message : String(err),
        input,
      });
    });
}
