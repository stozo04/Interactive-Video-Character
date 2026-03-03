-- Tracks when the Google refresh token was issued so the WA bridge can warn
-- Steven before it hits the 7-day Testing-mode expiry limit.
--
-- refresh_token_issued_at is set ONLY when provider_refresh_token is present
-- (i.e. on first consent / re-consent). Updating the access_token does NOT
-- reset this timestamp — the clock starts when Google issued the refresh token.

ALTER TABLE public.google_api_auth_tokens
  ADD COLUMN IF NOT EXISTS refresh_token_issued_at TIMESTAMPTZ;
