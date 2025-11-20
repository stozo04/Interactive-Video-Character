export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'model';
  text: string;
}

export interface UploadedImage {
  file: File;
  base64: string;
  mimeType: string;
}

export interface CharacterAction {
  id: string;
  name: string;
  phrases: string[];
  video: Blob;
  videoPath: string;
  sortOrder?: number | null;
  hasAudio?: boolean; // If true, video will play with sound
}

export interface CharacterProfile {
  id: string; // image hash
  createdAt: number;
  image: UploadedImage;
  idleVideo: Blob;
  actions: CharacterAction[];
  name: string; // Full name: "Kayley Adams"
  displayName: string; // Name to go by: "Kayley"
  personaId?: string; // Optional canonical persona/relationship anchor
}

// FIX: Moved browser-specific interface declarations into `declare global` to resolve type errors.
// Add global type declarations for browser-specific objects
declare global {
  // Define AIStudio interface to resolve type conflict.
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  // Add types for the Web Speech API
  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onresult: (event: SpeechRecognitionEvent) => void;
    onerror: (event: Event) => void;
    onend: () => void;
  }

  interface Window {
    aistudio?: AIStudio;
    process?: {
      env: {
        [key: string]: string | undefined;
        API_KEY?: string;
      };
    };
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}
