-- Adds a UNIQUE constraint on auth_mode so the browser can UPSERT
-- the Google OAuth token row cleanly (INSERT ... ON CONFLICT DO UPDATE).
-- Without this, every sign-in creates a new row instead of updating the existing one.

ALTER TABLE public.google_api_auth_tokens
  ADD CONSTRAINT google_api_auth_tokens_auth_mode_unique UNIQUE (auth_mode);
