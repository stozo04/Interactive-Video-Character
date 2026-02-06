/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string; // Not in env
  readonly VITE_SUPABASE_ANON_KEY: string; // Not in env
  readonly VITE_USER_ID: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_GROK_API_KEY: string;
  readonly VITE_CHATGPT_API_KEY: string;
  readonly VITE_CHATGPT_VECTOR_ID: string;
  readonly VITE_GEMINI_MODEL: string;
  readonly VITE_GEMINI_TTS_MODEL: string;
  readonly VITE_GEMINI_VIDEO_MODEL: string;
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_GROK_MODEL: string;
  readonly VITE_CHATGPT_MODEL: string;
  readonly VITE_GMAIL_POLL_INTERVAL_MS: string;
  readonly VITE_CHATGPT_ASSISTANT_NAME: string;
  readonly VITE_CHATGPT_VECTOR_STORE_ID: string;
  readonly VITE_IMAGE_GENERATOR_SERVICE: string;
  readonly VITE_GEMINI_IMAGEN_MODEL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

