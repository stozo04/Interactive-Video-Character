-- Google API auth tokens (API key or OAuth)
CREATE TABLE IF NOT EXISTS google_api_auth_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_mode text NOT NULL CHECK (auth_mode IN ('api_key', 'oauth')),
  api_key text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_google_api_auth_tokens_updated_at
  BEFORE UPDATE ON google_api_auth_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Google API config (key-value settings)
CREATE TABLE IF NOT EXISTS google_api_config (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_key text UNIQUE NOT NULL,
  config_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_google_api_config_updated_at
  BEFORE UPDATE ON google_api_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
