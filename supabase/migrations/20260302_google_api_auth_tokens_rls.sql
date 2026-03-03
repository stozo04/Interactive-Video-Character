-- RLS policies for google_api_auth_tokens
--
-- The browser (authenticated user) needs to write OAuth tokens on sign-in.
-- The server uses the service role key which bypasses RLS entirely.
-- No unauthenticated access is ever allowed.

-- Allow authenticated users to read their own token row
CREATE POLICY "Authenticated users can read oauth tokens"
  ON public.google_api_auth_tokens
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert/update token rows
CREATE POLICY "Authenticated users can upsert oauth tokens"
  ON public.google_api_auth_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update oauth tokens"
  ON public.google_api_auth_tokens
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- RLS policies for google_api_config
--
-- The server (service role) reads/writes this for the Gmail history ID cursor.
-- The browser doesn't touch this table directly.
-- Lock it down completely for non-service-role access.

CREATE POLICY "No direct client access to api config"
  ON public.google_api_config
  FOR ALL
  TO authenticated
  USING (false);
