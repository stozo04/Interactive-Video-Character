import { GoogleGenAI, Chat } from "@google/genai";
import { UploadedImage } from '../types';

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


const getAiClient = () => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable not set.");
    }
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

const pollVideoOperation = async (operation: any): Promise<string> => {
    const ai = getAiClient();
    let currentOperation = operation;
    while (!currentOperation.done) {
        // Fix: Increased polling delay to 10 seconds as per API guidelines for video operations.
        await new Promise(resolve => setTimeout(resolve, 10000));
        try {
            currentOperation = await ai.operations.getVideosOperation({ operation: currentOperation });
        } catch(e) {
            console.error("Polling failed", e);
            throw new Error("Failed while polling for video generation status.");
        }
    }
    
    if (currentOperation.error) {
        console.error("Video generation failed:", currentOperation.error);
        throw new Error(`Video generation failed: ${currentOperation.error.message}`);
    }

    const downloadLink = currentOperation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
        throw new Error("Video generation completed, but no download link was found. The operation may have failed without a specific error message.");
    }
    
    const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
    if (!response.ok) {
        throw new Error(`Failed to download video: ${response.statusText}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
};

export const generateInitialVideo = async (image: UploadedImage): Promise<string> => {
    const ai = getAiClient();
    const operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: `Animate the character from this image to create a short, seamlessly looping video. The character should be sitting at a desk, looking forward with a pleasant, neutral expression, and subtly breathing, as if waiting for a conversation to start.`,
        image: {
            imageBytes: image.base64,
            mimeType: image.mimeType,
        },
        config: {
            numberOfVideos: 1,
            resolution: '720p',
            // Fix: Changed aspect ratio to '9:16' as '1:1' is not a supported value for video generation.
            aspectRatio: '9:16'
        }
    });

    return pollVideoOperation(operation);
};

export const generateActionVideo = async (image: UploadedImage, command: string): Promise<string> => {
    const ai = getAiClient();
    const operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: `Animate the character from this image to perform the following action based on the command: "${command}". The action should be brief (a few seconds). After the action, the character should return to a neutral, waiting state.`,
        image: {
            imageBytes: image.base64,
            mimeType: image.mimeType,
        },
        config: {
            numberOfVideos: 1,
            resolution: '720p',
            // Fix: Changed aspect ratio to '9:16' as '1:1' is not a supported value for video generation.
            aspectRatio: '9:16'
        }
    });
    return pollVideoOperation(operation);
};

export const startChatSession = async (): Promise<Chat> => {
    const ai = getAiClient();
    const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: `You are the character in the video, an interactive AI assistant. A user will give you a command. Your response should be a brief, conversational text confirmation of the action you are about to perform in the video. For example, if the user says "Wave to the camera", you could say "Sure, waving now!" or "Hello there!". Keep responses under 15 words.`,
        },
    });
    return chat;
};

export const sendMessage = async (chat: Chat, message: string): Promise<string> => {
    const response = await chat.sendMessage({ message });
    return response.text;
};