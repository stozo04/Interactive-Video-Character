-- ============================================================================
-- Expand Hairstyle Constraints Migration
-- ============================================================================
-- Expands the allowed hairstyle values to match all reference images
-- in the config.json file.
--
-- Previous allowed values: curly, straight, messy_bun
-- New allowed values: curly, straight, messy_bun, waves, ponytail, headband,
--                     claw_clip, half_up, heatless_curls, dutch_braid, styled_bun
-- ============================================================================

-- ============================================================================
-- 1. Update current_look_state table
-- ============================================================================

-- Drop the old constraint
ALTER TABLE current_look_state
  DROP CONSTRAINT IF EXISTS current_look_state_hairstyle_check;

-- Add the new expanded constraint
ALTER TABLE current_look_state
  ADD CONSTRAINT current_look_state_hairstyle_check
  CHECK (hairstyle IN (
    'curly',
    'straight',
    'messy_bun',
    'waves',
    'ponytail',
    'headband',
    'claw_clip',
    'half_up',
    'heatless_curls',
    'dutch_braid',
    'styled_bun'
  ));

-- ============================================================================
-- 2. Update selfie_generation_history table
-- ============================================================================

-- Drop the old constraint
ALTER TABLE selfie_generation_history
  DROP CONSTRAINT IF EXISTS selfie_generation_history_hairstyle_check;

-- Add the new expanded constraint
ALTER TABLE selfie_generation_history
  ADD CONSTRAINT selfie_generation_history_hairstyle_check
  CHECK (hairstyle IN (
    'curly',
    'straight',
    'messy_bun',
    'waves',
    'ponytail',
    'headband',
    'claw_clip',
    'half_up',
    'heatless_curls',
    'dutch_braid',
    'styled_bun'
  ));

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- This migration expands the hairstyle CHECK constraints to include all
-- hairstyles defined in src/utils/referenceImages/config.json
--
-- Run this in Supabase SQL Editor to apply the changes.
-- ============================================================================
