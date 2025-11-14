// Type definitions for Google Identity Services (GIS)

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(): void;
}

interface OAuth2Options {
  client_id: string;
  scope: string;
  prompt?: string | '';
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { message?: string; type?: string }) => void;
}

interface RevokeResponse {
  error?: string;
  successful?: boolean;
}

interface GoogleAccounts {
  oauth2: {
    initTokenClient(config: OAuth2Options): TokenClient;
    revoke(token: string, callback: (response: RevokeResponse) => void): void;
  };
}

interface Google {
  accounts: GoogleAccounts;
}

declare global {
  interface Window {
    google: Google;
  }
  
  const google: Google;
}

export {};

