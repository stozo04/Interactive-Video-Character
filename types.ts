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

// Fix: Removed conflicting global type declaration for `window.aistudio`.
