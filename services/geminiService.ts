import { GoogleGenAI, Chat, Modality } from "@google/genai";
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


const getAiClient = () => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable not set.");
    }
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

const pollVideoOperation = async (operation: any): Promise<Blob> => {
    const ai = getAiClient();
    let currentOperation = operation;
    while (!currentOperation.done) {
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
        console.error("Video generation completed without a download link. Full operation response:", JSON.stringify(currentOperation, null, 2));
        throw new Error("Video generation failed. This may be due to safety filters blocking the input image. Please try using a different image.");
    }
    
    const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
    if (!response.ok) {
        const errorText = await response.text();
        // The error from the Veo API is often a JSON object in the body
        throw new Error(`Failed to download video: ${response.statusText} - ${errorText}`);
    }
    const blob = await response.blob();
    return blob;
};

// Helper function to abstract the video generation call
const generateSingleVideo = (image: UploadedImage, prompt: string) => {
    const ai = getAiClient();
    return ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt,
        image: {
            imageBytes: image.base64,
            mimeType: image.mimeType,
        },
        config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio: '9:16'
        }
    });
};

export const generateInitialVideo = async (image: UploadedImage): Promise<{ urls: string[], fromCache: boolean }> => {
    const imageHash = await hashImage(image.base64);
    const cachedBlobs = await getVideoCache(imageHash);

    if (cachedBlobs && cachedBlobs.length > 0) {
        console.log("Loading initial video from cache.");
        const urls = cachedBlobs.map(blob => URL.createObjectURL(blob));
        return { urls, fromCache: true };
    }

    console.log("Generating new initial video.");
    // Simplified to a single prompt to reduce API calls and avoid rate limits.
    const prompt = `Animate the character from this image to create a short, seamlessly looping video. The character should be sitting at a desk, looking forward with a pleasant, neutral expression, and subtly breathing, as if waiting for a conversation to start.`;

    // Generate and poll for a single video
    const operation = await generateSingleVideo(image, prompt);
    const blob = await pollVideoOperation(operation);
    
    // Store as an array with one blob to maintain data structure consistency
    await setVideoCache(imageHash, [blob]);
    console.log("Initial video saved to cache.");

    const urls = [URL.createObjectURL(blob)];
    return { urls, fromCache: false };
};

export const generateActionVideo = async (image: UploadedImage, command: string): Promise<string> => {
    const prompt = `Animate the character from this image to perform the following action based on the command: "${command}". The action should be brief (a few seconds). After the action, the character should return to a neutral, waiting state.`;
    const operation = await generateSingleVideo(image, prompt);
    const blob = await pollVideoOperation(operation);
    return URL.createObjectURL(blob);
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

export const generateSpeech = async (text: string): Promise<string> => {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Kore' }, // A friendly, standard voice
                },
            },
        },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
        throw new Error("Speech generation failed, no audio data received.");
    }
    return base64Audio;
};
