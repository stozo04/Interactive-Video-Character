-- Add clarification_questions column to engineering_tickets
-- Stores Opey's questions when he needs clarification before implementing.
-- Cleared when the user responds and the ticket resets to "created".
ALTER TABLE engineering_tickets
  ADD COLUMN IF NOT EXISTS clarification_questions text;
