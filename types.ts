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

// Fix: Removed conflicting global type declaration for `window.aistudio`.
