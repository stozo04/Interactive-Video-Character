import { UploadedImage } from '../types';
import { hashImage, getVideoCache, setVideoCache } from './cacheService';

// Utility to convert file to base64
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        return reject(new Error('FileReader did not return a string.'));
      }
      resolve(reader.result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });
};

const BASE_URL = 'https://api.x.ai/v1';
const API_KEY = process.env.GROK_API_KEY;

if (!API_KEY) {
  throw new Error("GROK_API_KEY environment variable not set.");
}

const describeImage = async (image: UploadedImage): Promise<string> => {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'grok-2-vision-1212',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${image.mimeType};base64,${image.base64}`,
              },
            },
            {
              type: 'text',
              text: 'Describe this character in detail, including appearance, clothing, pose, and setting.',
            },
          ],
        },
      ],
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to describe image: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
};

// Helper function to abstract the image generation call (adapted from video since Grok does not support video generation)
const generateSingleVideo = async (image: UploadedImage, prompt: string): Promise<Blob> => {
  const description = await describeImage(image);
  const fullPrompt = `${prompt} The character looks like this: ${description}`;

  const response = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'grok-2-image-1212',
      prompt: fullPrompt,
      n: 1,
      response_format: 'b64_json',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate image: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const base64Image = data.data[0].b64_json;

  // Assuming the generated image is PNG; adjust if needed
  const imageResponse = await fetch(`data:image/png;base64,${base64Image}`);
  const blob = await imageResponse.blob();
  return blob;
};

export const generateInitialVideo = async (image: UploadedImage): Promise<{ urls: string[], fromCache: boolean }> => {
  const imageHash = await hashImage(image.base64);
  const cachedBlobs = await getVideoCache(imageHash);

  if (cachedBlobs && cachedBlobs.length > 0) {
    console.log("Loading initial image from cache (adapted from video).");
    const urls = cachedBlobs.map(blob => URL.createObjectURL(blob));
    return { urls, fromCache: true };
  }

  console.log("Generating new initial image (adapted from video).");
  // Simplified to a single prompt to reduce API calls and avoid rate limits.
  const prompt = `Animate the character from this image to create a short, seamlessly looping video. The character should be sitting at a desk, looking forward with a pleasant, neutral expression, and subtly breathing, as if waiting for a conversation to start.`;

  // Generate a single image (since video is not supported)
  const blob = await generateSingleVideo(image, prompt);
  
  // Store as an array with one blob to maintain data structure consistency
  await setVideoCache(imageHash, [blob]);
  console.log("Initial image saved to cache.");

  const urls = [URL.createObjectURL(blob)];
  return { urls, fromCache: false };
};

export const generateActionVideo = async (image: UploadedImage, command: string): Promise<string> => {
  const prompt = `Animate the character from this image to perform the following action based on the command: "${command}". The action should be brief (a few seconds). After the action, the character should return to a neutral, waiting state.`;
  const blob = await generateSingleVideo(image, prompt);
  return URL.createObjectURL(blob);
};

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

class Chat {
  private history: Message[] = [];

  constructor(systemInstruction: string) {
    this.history.push({ role: 'system', content: systemInstruction });
  }

  async sendMessage({ message }: { message: string }): Promise<{ text: string }> {
    this.history.push({ role: 'user', content: message });

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-4-fast-reasoning', // Choose a suitable model; adjust as needed
        messages: this.history,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send message: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const text = data.choices[0].message.content;
    this.history.push({ role: 'assistant', content: text });
    return { text };
  }
}

export const startChatSession = async (): Promise<Chat> => {
  return new Chat(
    `You are the character in the video, an interactive AI assistant. A user will give you a command. Your response should be a brief, conversational text confirmation of the action you are about to perform in the video. For example, if the user says "Wave to the camera", you could say "Sure, waving now!" or "Hello there!". Keep responses under 15 words.`
  );
};

export const sendMessage = async (chat: Chat, message: string): Promise<string> => {
  const response = await chat.sendMessage({ message });
  return response.text;
};

export const generateSpeech = async (text: string): Promise<string> => {
  throw new Error("Text-to-speech generation is not supported by the xAI Grok API. Consider using a browser-based TTS like SpeechSynthesis or a third-party service.");
};