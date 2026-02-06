// src/vite-env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY: string;
  readonly VITE_GROK_API_KEY: string;
  // Add other env variables here if needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Allow importing text files with ?raw suffix
declare module '*?raw' {
  const content: string;
  export default content;
}

// Allow importing images as base64 with ?base64 suffix
declare module '*?base64' {
  const content: string;
  export default content;
}