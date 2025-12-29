-- ============================================================================
-- Fix idle_thoughts.absence_duration_hours type from INTEGER to NUMERIC
-- ============================================================================
-- Issue: absence_duration_hours was INTEGER, but we pass decimal values
-- like 0.82 hours (49 minutes). This causes "invalid input syntax for type integer"
-- errors when trying to insert fractional hour values.
--
-- Solution: Change to NUMERIC(5,2) to support up to 999.99 hours with 2 decimal places.
-- ============================================================================

ALTER TABLE idle_thoughts
  ALTER COLUMN absence_duration_hours TYPE NUMERIC(5,2);

COMMENT ON COLUMN idle_thoughts.absence_duration_hours IS
'How long user was away in hours (supports fractional hours like 0.82 for 49 minutes)';
