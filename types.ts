import { Chat } from "@google/genai";

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface UploadedImage {
  file: File;
  base64: string;
  mimeType: string;
}

export interface CharacterProfile {
  id: string; // image hash
  createdAt: number;
  image: UploadedImage;
  idleVideo: Blob;
}

// Add global type declarations for browser-specific objects
// Fix for line 24: Define AIStudio interface to resolve type conflict.
interface AIStudio {
  hasSelectedApiKey: () => Promise<boolean>;
  openSelectKey: () => Promise<void>;
}

declare global {
  interface Window {
    aistudio?: AIStudio;
    process?: {
      env: {
        [key: string]: string | undefined;
        API_KEY?: string;
      };
    };
  }
}
