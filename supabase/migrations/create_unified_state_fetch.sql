-- ============================================================================
-- Unified State Fetch RPC Function
-- Optimizes state fetching by combining 3-4 separate queries into 1 RPC call
-- ============================================================================

CREATE OR REPLACE FUNCTION get_full_character_context(user_id TEXT)
RETURNS JSON AS $$
SELECT json_build_object(
  'mood_state', (
    SELECT row_to_json(m) 
    FROM mood_states m 
    WHERE m.user_id = get_full_character_context.user_id
  ),
  'emotional_momentum', (
    SELECT row_to_json(e) 
    FROM emotional_momentum e 
    WHERE e.user_id = get_full_character_context.user_id
  ),
  'ongoing_threads', (
    SELECT COALESCE(json_agg(row_to_json(o) ORDER BY o.intensity DESC), '[]'::json)
    FROM ongoing_threads o 
    WHERE o.user_id = get_full_character_context.user_id
  ),
  'intimacy_state', (
    SELECT row_to_json(i) 
    FROM intimacy_states i 
    WHERE i.user_id = get_full_character_context.user_id
  )
);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION get_full_character_context IS 
'Returns all character state (mood, momentum, threads, intimacy) in a single RPC call. Optimizes network roundtrips from 3-4 calls to 1.';

