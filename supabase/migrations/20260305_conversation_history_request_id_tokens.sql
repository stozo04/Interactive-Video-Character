-- Add request_id (links each turn to server_runtime_logs lifecycle entries)
-- and token count columns using exact Gemini API field names (populated only on model rows).

alter table public.conversation_history
  add column if not exists request_id text,
  add column if not exists total_input_tokens integer,
  add column if not exists total_output_tokens integer,
  add column if not exists total_tokens integer,
  add column if not exists total_thought_tokens integer,
  add column if not exists total_tool_use_tokens integer,
  add column if not exists total_cached_tokens integer,
  add column if not exists input_tokens_by_modality jsonb;

create index if not exists idx_conversation_history_request_id
  on public.conversation_history (request_id);
