/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly NEXT_PUBLIC_SUPABASE_URL: string;
  readonly NEXT_PUBLIC_SUPABASE_URL: string;
  readonly GROK_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

