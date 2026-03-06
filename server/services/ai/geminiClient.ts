// server/services/ai/geminiClient.ts
//
// Singleton GoogleGenAI client for server-side Gemini API calls.
// Uses GEMINI_API_KEY (no VITE_ prefix) — never exposed to the browser.

import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error(
    "[geminiClient] Missing GEMINI_API_KEY — add it to .env.local (without VITE_ prefix for server-only access)"
  );
}

/** Server-side Gemini model name. Falls back to VITE_ variant for migration. */
export const GEMINI_MODEL =
  process.env.GEMINI_MODEL || process.env.VITE_GEMINI_MODEL || "gemini-2.5-flash";

/** Singleton GoogleGenAI client — import this, never construct your own. */
export const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
