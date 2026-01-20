export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'model';
  text: string;
  image?: string; // base64 string for user-sent images
  imageMimeType?: string; // mime type for user-sent images
  assistantImage?: string; // base64 string for AI-generated images (selfies)
  assistantImageMimeType?: string; // mime type for assistant images
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
  idleVideoUrls: string[]; // Public URLs - browser cache handles storage (not RAM!)
  actions: CharacterAction[];
  name: string; // Full name: "Kayley Adams"
  displayName: string; // Name to go by: "Kayley"
  personaId?: string; // Optional canonical persona/relationship anchor
}

export interface Task {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number; // timestamp
  completedAt: number | null;
  priority?: 'low' | 'medium' | 'high';
  category?: string;
  scheduledDate?: string; // YYYY-MM-DD
}

export interface TaskState {
  tasks: Task[];
  lastResetDate: string; // ISO date string (YYYY-MM-DD)
}

/**
 * Proactive feature settings
 * Controls what Kayley proactively brings up during check-ins
 */
export interface ProactiveSettings {
  calendar: boolean;  // Calendar event reminders (day before, approaching, post-event)
  news: boolean;      // Tech news from Hacker News during idle
  checkins: boolean;  // Random conversation starters when idle
}

// Default settings - all features enabled
export const DEFAULT_PROACTIVE_SETTINGS: ProactiveSettings = {
  calendar: true,
  news: true,
  checkins: true,
};

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
