-- Drop Dead Code Tables Migration
--
-- This migration drops tables that are no longer used in the codebase.
-- These were identified as part of the dead code cleanup initiative.
--
-- Part 2: Tables with NO code references (true dead)
-- Part 3: Tables with orphaned code (code deleted)
-- Part 4: Tables from deleted services (narrativeArcs, dynamicRelationships, storyRetelling)
--
-- NOTE: This is a DESTRUCTIVE operation. Ensure you have backups if needed.
-- All these tables are confirmed to have 0 rows.

-- ============================================
-- Part 2: True Dead Tables (no code references)
-- ============================================

-- Drop kayley_pending_shares (no code ever used this)
DROP TABLE IF EXISTS kayley_pending_shares CASCADE;

-- Drop conversation_spontaneity_state (only referenced in docs)
DROP TABLE IF EXISTS conversation_spontaneity_state CASCADE;

-- Drop spontaneous_selfie_history (only referenced in docs)
DROP TABLE IF EXISTS spontaneous_selfie_history CASCADE;

-- ============================================
-- Part 3: Orphaned Code Tables (code now deleted)
-- ============================================

-- Drop session_reflections (sessionReflection.ts deleted)
DROP TABLE IF EXISTS session_reflections CASCADE;

-- Drop visual_state_mapping (visualStateMapper.ts deleted)
DROP TABLE IF EXISTS visual_state_mapping CASCADE;

-- ============================================
-- Part 4: Deleted Service Tables
-- ============================================

-- Narrative Arcs (narrativeArcsService.ts deleted)
DROP TABLE IF EXISTS narrative_arcs CASCADE;

-- Dynamic Relationships (dynamicRelationshipsService.ts deleted)
DROP TABLE IF EXISTS kayley_people CASCADE;
DROP TABLE IF EXISTS user_person_relationships CASCADE;

-- Story Retelling (storyRetellingService.ts deleted)
DROP TABLE IF EXISTS kayley_stories CASCADE;
DROP TABLE IF EXISTS user_story_tracking CASCADE;

-- ============================================
-- Summary: 10 tables dropped
-- ============================================
-- 1. kayley_pending_shares
-- 2. conversation_spontaneity_state
-- 3. spontaneous_selfie_history
-- 4. session_reflections
-- 5. visual_state_mapping
-- 6. narrative_arcs
-- 7. kayley_people
-- 8. user_person_relationships
-- 9. kayley_stories
-- 10. user_story_tracking
