-- Add pr_feedback column to engineering_tickets.
-- Used by Kayley's review_pr → submit_pr_review workflow:
--   1. Kayley reviews Opey's PR via the review_pr tool.
--   2. If changes are needed, she calls submit_pr_review with her feedback.
--   3. submit_pr_review writes to pr_feedback and resets status to 'created'.
--   4. Opey picks up the ticket again, sees pr_feedback is set, and knows to
--      fix the existing PR (not create a new one).

ALTER TABLE engineering_tickets
  ADD COLUMN IF NOT EXISTS pr_feedback text;

COMMENT ON COLUMN engineering_tickets.pr_feedback IS
  'Kayley PR review feedback. Non-null means the ticket was returned for fixes after a PR review. Opey must push to the existing branch (final_pr_url) rather than opening a new PR.';
