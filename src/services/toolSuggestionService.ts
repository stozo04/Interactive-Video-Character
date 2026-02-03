import { supabase } from "./supabaseClient";

const TOOL_SUGGESTIONS_TABLE = "kayley_tool_suggestions";
const LOG_PREFIX = "[ToolSuggestions]";
const SEMANTIC_DEDUPE_WINDOW = 50;
const SEMANTIC_DEDUPE_THRESHOLD = 0.55;
const MIN_TOKEN_LENGTH = 3;

export type ToolSuggestionStatus = "queued" | "shared";
export type ToolSuggestionTriggerSource = "idle" | "live";

export interface ToolSuggestionRecord {
  id: string;
  toolKey: string;
  title: string;
  reasoning: string;
  userValue: string;
  trigger: string;
  samplePrompt: string;
  permissionsNeeded: string[];
  status: ToolSuggestionStatus;
  triggerSource: ToolSuggestionTriggerSource;
  theme?: string | null;
  seedId?: string | null;
  triggerText?: string | null;
  triggerReason?: string | null;
  createdAt: Date;
  sharedAt?: Date | null;
}

export interface ToolSuggestionCreateInput {
  toolKey: string;
  title: string;
  reasoning: string;
  userValue: string;
  trigger: string;
  samplePrompt: string;
  permissionsNeeded: string[];
  triggerSource: ToolSuggestionTriggerSource;
  theme?: string | null;
  seedId?: string | null;
  triggerText?: string | null;
  triggerReason?: string | null;
}

export function normalizeToolKey(value: string): string {
  const raw = value.trim().toLowerCase();
  const underscored = raw.replace(/[\s-]+/g, "_");
  const cleaned = underscored.replace(/[^a-z0-9_]/g, "");
  return cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function tokenizeForSimilarity(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function buildSuggestionFingerprint(input: ToolSuggestionCreateInput): string {
  return [
    input.title,
    input.reasoning,
    input.userValue,
    input.trigger,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function mapToolSuggestion(row: any): ToolSuggestionRecord {
  return {
    id: row.id,
    toolKey: row.tool_key,
    title: row.title,
    reasoning: row.reasoning,
    userValue: row.user_value,
    trigger: row.trigger,
    samplePrompt: row.sample_prompt,
    permissionsNeeded: Array.isArray(row.permissions_needed)
      ? row.permissions_needed
      : [],
    status: row.status,
    triggerSource: row.trigger_source,
    theme: row.theme ?? null,
    seedId: row.seed_id ?? null,
    triggerText: row.trigger_text ?? null,
    triggerReason: row.trigger_reason ?? null,
    createdAt: new Date(row.created_at),
    sharedAt: row.shared_at ? new Date(row.shared_at) : null,
  };
}

export async function getToolSuggestions(options?: {
  status?: ToolSuggestionStatus;
  limit?: number;
  ascending?: boolean;
}): Promise<ToolSuggestionRecord[]> {
  const status = options?.status;
  const limit = options?.limit;
  const ascending = options?.ascending ?? false;
  let query = supabase
    .from(TOOL_SUGGESTIONS_TABLE)
    .select("*")
    .order("created_at", { ascending });

  if (status) {
    query = query.eq("status", status);
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error || !data) {
    if (error) {
      console.error(`${LOG_PREFIX} Failed to fetch tool suggestions`, { error });
    }
    return [];
  }

  return data.map(mapToolSuggestion);
}

export async function getToolSuggestionKeys(): Promise<string[]> {
  const { data, error } = await supabase
    .from(TOOL_SUGGESTIONS_TABLE)
    .select("tool_key")
    .order("created_at", { ascending: false });

  if (error || !data) {
    if (error) {
      console.error(`${LOG_PREFIX} Failed to fetch tool suggestion keys`, {
        error,
      });
    }
    return [];
  }

  return data.map((row) => row.tool_key);
}

export async function createToolSuggestion(
  input: ToolSuggestionCreateInput,
  status: ToolSuggestionStatus,
): Promise<ToolSuggestionRecord | null> {
  const normalizedKey = normalizeToolKey(input.toolKey);
  if (!normalizedKey) {
    console.warn(`${LOG_PREFIX} Invalid tool_key`, { toolKey: input.toolKey });
    return null;
  }

  const { data: existing, error: existingError } = await supabase
    .from(TOOL_SUGGESTIONS_TABLE)
    .select("id")
    .eq("tool_key", normalizedKey)
    .limit(1)
    .maybeSingle();

  if (existing && !existingError) {
    console.log(`${LOG_PREFIX} Duplicate tool suggestion detected`, {
      toolKey: normalizedKey,
    });
    return null;
  }

  if (existingError && existingError.code !== "PGRST116") {
    console.error(`${LOG_PREFIX} Failed to check tool suggestion dedupe`, {
      error: existingError,
    });
    return null;
  }

  const fingerprint = buildSuggestionFingerprint(input);
  const candidateTokens = new Set(tokenizeForSimilarity(fingerprint));
  if (candidateTokens.size > 0) {
    const { data: recentSuggestions, error: recentError } = await supabase
      .from(TOOL_SUGGESTIONS_TABLE)
      .select("id, tool_key, title, reasoning, user_value, trigger")
      .order("created_at", { ascending: false })
      .limit(SEMANTIC_DEDUPE_WINDOW);

    if (recentError) {
      console.error(`${LOG_PREFIX} Failed to fetch suggestions for semantic dedupe`, {
        error: recentError,
      });
      return null;
    }

    if (recentSuggestions && recentSuggestions.length > 0) {
      for (const suggestion of recentSuggestions) {
        const otherTokens = new Set(
          tokenizeForSimilarity(
            [suggestion.title, suggestion.reasoning, suggestion.user_value, suggestion.trigger]
              .filter((value) => typeof value === "string" && value.trim().length > 0)
              .join(" "),
          ),
        );
        const similarity = jaccardSimilarity(candidateTokens, otherTokens);
        if (similarity >= SEMANTIC_DEDUPE_THRESHOLD) {
          console.log(`${LOG_PREFIX} Semantic duplicate detected`, {
            toolKey: normalizedKey,
            existingToolKey: suggestion.tool_key,
            similarity: Number(similarity.toFixed(2)),
          });
          return null;
        }
      }
    }
  }

  const payload = {
    tool_key: normalizedKey,
    title: input.title,
    reasoning: input.reasoning,
    user_value: input.userValue,
    trigger: input.trigger,
    sample_prompt: input.samplePrompt,
    permissions_needed: input.permissionsNeeded ?? [],
    status,
    trigger_source: input.triggerSource,
    theme: input.theme ?? null,
    seed_id: input.seedId ?? null,
    trigger_text: input.triggerText ?? null,
    trigger_reason: input.triggerReason ?? null,
    shared_at: status === "shared" ? new Date().toISOString() : null,
  };

  const { data, error } = await supabase
    .from(TOOL_SUGGESTIONS_TABLE)
    .insert(payload)
    .select()
    .maybeSingle();

  if (error || !data) {
    console.error(`${LOG_PREFIX} Failed to store tool suggestion`, { error });
    return null;
  }

  console.log(`${LOG_PREFIX} Stored tool suggestion`, {
    id: data.id,
    toolKey: normalizedKey,
    status,
  });
  return mapToolSuggestion(data);
}

export async function markToolSuggestionShared(id: string): Promise<boolean> {
  const { data, error: fetchError } = await supabase
    .from(TOOL_SUGGESTIONS_TABLE)
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    console.error(`${LOG_PREFIX} Failed to fetch tool suggestion`, {
      id,
      error: fetchError,
    });
    return false;
  }

  if (data?.status !== "queued") {
    console.log(`${LOG_PREFIX} Tool suggestion already shared`, {
      id,
      status: data?.status,
    });
    return false;
  }

  const { error } = await supabase
    .from(TOOL_SUGGESTIONS_TABLE)
    .update({
      status: "shared",
      shared_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "queued");

  if (error) {
    console.error(`${LOG_PREFIX} Failed to mark tool suggestion shared`, {
      id,
      error,
    });
    return false;
  }

  console.log(`${LOG_PREFIX} Tool suggestion marked shared`, { id });
  return true;
}
