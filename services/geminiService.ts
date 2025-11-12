import { GoogleGenAI, Chat, Modality } from "@google/genai";
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

export const generateInitialVideo = async (image: UploadedImage): Promise<Blob> => {
    console.log("Generating new initial video.");
    const prompt = `Animate the character from this image to create a short, seamlessly looping video. The character should be sitting at a desk, looking forward with a pleasant, neutral expression, and subtly breathing, as if waiting for a conversation to start.`;
    const operation = await generateSingleVideo(image, prompt);
    const blob = await pollVideoOperation(operation);
    return blob;
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
            systemInstruction: `You are an interactive AI character. The user will give you a command to perform an action. Your response will be spoken by the character.
- For commands that should have a verbal response, provide a brief, conversational text confirmation (under 15 words).
- For purely physical actions where speech is unnatural (like a simple nod or wave), respond with an empty string.
Examples:
User: "Tell me a joke." -> Model: "Of course! Why don't scientists trust atoms? Because they make up everything!"
User: "Wave to me." -> Model: "Hello there!"
User: "Nod." -> Model: "" (an empty string)`,
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