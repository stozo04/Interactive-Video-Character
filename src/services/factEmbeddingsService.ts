// src/services/factEmbeddingsService.ts
/**
 * Fact Embeddings Service (Phase 2B)
 *
 * Owns the embedding index for semantic active recall:
 * - generate embeddings for source records
 * - upsert/delete embedding rows
 * - semantic similarity lookup via RPC
 *
 * This service is fail-open by design: any failure logs and returns safely.
 */

import { GoogleGenAI } from "@google/genai";
import { supabase } from "./supabaseClient";
import type { UserFact } from "./memoryService";
import type { CharacterFact } from "./characterFactsService";
import type { LifeStoryline } from "./storylineService";

const LOG_PREFIX = "[FactEmbeddings]";
const TABLE = "fact_embeddings";
const RPC_MATCH = "match_fact_embeddings";
const EMBEDDING_DIMENSION = 768;
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";

export type EmbeddingSourceType = "user_fact" | "character_fact" | "storyline";
export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

interface EmbeddingConfig {
  enabled: boolean;
  embeddingModel: string;
  embeddingVersion: number;
}

export interface SemanticMatchQuery {
  queryText: string;
  topK: number;
  minSimilarity: number;
}

export interface FactEmbeddingMatch {
  source_type: EmbeddingSourceType;
  source_id: string;
  source_key: string;
  source_value: string;
  source_updated_at: string;
  confidence: number;
  pinned: boolean;
  similarity: number;
}


interface UpsertFactEmbeddingInput {
  sourceType: EmbeddingSourceType;
  sourceId: string;
  sourceKey: string;
  sourceValue: string;
  sourceUpdatedAt: string;
  confidence: number;
  pinned: boolean;
}



let aiClient: GoogleGenAI | null = null;

function getConfig(): EmbeddingConfig {
  return {
    enabled: true,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
    embeddingVersion: 1,
  };
}

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("VITE_GEMINI_API_KEY is not set");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

function toVectorLiteral(values: number[]): string {
  const sanitized = values.map((v) => (Number.isFinite(v) ? v.toString() : "0"));
  return `[${sanitized.join(",")}]`;
}

function buildStorylineEmbeddingText(storyline: LifeStoryline): string {
  const parts: string[] = [
    storyline.title,
    storyline.initialAnnouncement || "",
    storyline.stakes || "",
    storyline.currentEmotionalTone || "",
  ];
  return parts.join(" ").trim();
}

async function generateTextEmbedding(
  text: string,
  taskType: EmbeddingTaskType
): Promise<number[] | null> {
  const config = getConfig();
  if (!config.enabled) return null;

  const normalized = text.trim();
  if (!normalized) return null;

  try {
    const ai = getAIClient();
    const response = await ai.models.embedContent({
      model: config.embeddingModel,
      contents: [normalized],
      config: {
        taskType,
        outputDimensionality: EMBEDDING_DIMENSION,
      },
    });

    const values = response.embeddings?.[0]?.values;
    if (!values || !values.length) {
      console.warn(`${LOG_PREFIX} Empty embedding response`, { taskType });
      return null;
    }

    if (values.length !== EMBEDDING_DIMENSION) {
      console.warn(`${LOG_PREFIX} Unexpected embedding dimension`, {
        expected: EMBEDDING_DIMENSION,
        actual: values.length,
        taskType,
      });
      return null;
    }

    return values;
  } catch (err) {
    console.error(`${LOG_PREFIX} generateTextEmbedding failed`, {
      err,
      taskType,
      textLength: normalized.length,
    });
    return null;
  }
}

async function upsertFactEmbedding(input: UpsertFactEmbeddingInput): Promise<boolean> {
  const config = getConfig();
  if (!config.enabled) return false;

  try {
    const sourceText = `${input.sourceKey}: ${input.sourceValue}`.trim();
    const embedding = await generateTextEmbedding(sourceText, "RETRIEVAL_DOCUMENT");
    if (!embedding) return false;

    const { error } = await supabase.from(TABLE).upsert(
      {
        source_type: input.sourceType,
        source_id: input.sourceId,
        source_key: input.sourceKey,
        source_value: input.sourceValue,
        source_updated_at: input.sourceUpdatedAt,
        confidence: clampConfidence(input.confidence),
        pinned: !!input.pinned,
        embedding_model: config.embeddingModel,
        embedding_version: config.embeddingVersion,
        embedding: toVectorLiteral(embedding),
      },
      {
        onConflict: "source_type,source_id,embedding_model,embedding_version",
      }
    );

    if (error) {
      console.error(`${LOG_PREFIX} Failed to upsert embedding row`, {
        error,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error(`${LOG_PREFIX} upsertFactEmbedding failed`, {
      err,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
    return false;
  }
}

export async function deleteFactEmbedding(
  sourceType: EmbeddingSourceType,
  sourceId: string
): Promise<void> {
  const config = getConfig();
  if (!config.enabled) return;

  try {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq("source_type", sourceType)
      .eq("source_id", sourceId);

    if (error) {
      console.error(`${LOG_PREFIX} Failed to delete embedding row`, {
        error,
        sourceType,
        sourceId,
      });
    }
  } catch (err) {
    console.error(`${LOG_PREFIX} deleteFactEmbedding failed`, { err, sourceType, sourceId });
  }
}

export async function upsertUserFactEmbedding(fact: UserFact): Promise<boolean> {
  return upsertFactEmbedding({
    sourceType: "user_fact",
    sourceId: fact.id,
    sourceKey: `${fact.category}.${fact.fact_key}`,
    sourceValue: fact.fact_value,
    sourceUpdatedAt: fact.updated_at,
    confidence: fact.confidence,
    pinned: fact.pinned,
  });
}

export async function upsertCharacterFactEmbedding(fact: CharacterFact): Promise<boolean> {
  return upsertFactEmbedding({
    sourceType: "character_fact",
    sourceId: fact.id,
    sourceKey: `${fact.category}.${fact.fact_key}`,
    sourceValue: fact.fact_value,
    sourceUpdatedAt: fact.updated_at,
    confidence: fact.confidence,
    pinned: false,
  });
}

export async function upsertStorylineEmbedding(storyline: LifeStoryline): Promise<boolean> {
  return upsertFactEmbedding({
    sourceType: "storyline",
    sourceId: storyline.id,
    sourceKey: `${storyline.category}.${storyline.title}`,
    sourceValue: buildStorylineEmbeddingText(storyline),
    sourceUpdatedAt: storyline.updatedAt.toISOString(),
    confidence: 0.6,
    pinned: false,
  });
}

export async function querySemanticFactEmbeddingMatches(
  input: SemanticMatchQuery
): Promise<FactEmbeddingMatch[]> {
  const config = getConfig();
  if (!config.enabled) return [];

  try {
    const queryEmbedding = await generateTextEmbedding(input.queryText, "RETRIEVAL_QUERY");
    if (!queryEmbedding) return [];

    const { data, error } = await supabase.rpc(RPC_MATCH, {
      query_embedding: toVectorLiteral(queryEmbedding),
      match_threshold: input.minSimilarity,
      match_count: input.topK,
      embedding_model: config.embeddingModel,
      embedding_version: config.embeddingVersion,
    });

    if (error) {
      console.error(`${LOG_PREFIX} Semantic match RPC failed`, {
        error,
        rpc: RPC_MATCH,
      });
      return [];
    }

    return ((data || []) as FactEmbeddingMatch[]).map((row) => ({
      ...row,
      confidence: clampConfidence(Number(row.confidence ?? 0.6)),
      pinned: !!row.pinned,
      similarity: Math.max(0, Math.min(1, Number(row.similarity ?? 0))),
    }));
  } catch (err) {
    console.error(`${LOG_PREFIX} querySemanticFactEmbeddingMatches failed`, { err });
    return [];
  }
}





