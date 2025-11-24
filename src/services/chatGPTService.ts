import OpenAI from "openai";
import {
  IAIChatService,
  AIChatOptions,
  AIChatSession,
  UserContent,
} from "./aiService";
import { AIActionResponse } from "./aiSchema";
import { buildSystemPrompt } from "./promptUtils";
import { ChatMessage, CharacterProfile } from "../types";
import { RelationshipMetrics } from "./relationshipService";

const API_KEY = import.meta.env.VITE_CHATGPT_API_KEY;
const ASSISTANT_NAME = import.meta.env.VITE_CHATGPT_ASSISTANT_NAME;
const MODEL = import.meta.env.VITE_CHATGPT_MODEL;
const USER_ID = import.meta.env.VITE_USER_ID;
const VECTOR_STORE_ID = import.meta.env.VITE_CHATGPT_VECTOR_STORE_ID;

if (!API_KEY || !ASSISTANT_NAME || !MODEL || !USER_ID || !VECTOR_STORE_ID) {
  console.warn("Missing environment variables for ChatGPT service.");
  throw new Error("Missing environment variables for ChatGPT service.");
}

const client = new OpenAI({
  apiKey: API_KEY,
  dangerouslyAllowBrowser: true, // Client-side usage
});

// Helper: Convert base64 to File/Blob for Whisper
async function base64ToFile(
  base64: string,
  mimeType: string,
  fileName: string
): Promise<File> {
  const res = await fetch(`data:${mimeType};base64,${base64}`);
  const blob = await res.blob();
  return new File([blob], fileName, { type: mimeType });
}

// Helper: Remove citations like 【4:0†source】 from text
function stripCitations(text: string): string {
  return text.replace(/【\d+:\d+†source】/g, "").trim();
}

// Helper: Normalize JSON response
function normalizeAiResponse(rawJson: any, rawText: string): AIActionResponse {
  return {
    text_response: rawJson.text_response || rawJson.response || rawText,
    action_id: rawJson.action_id || null,
    user_transcription: rawJson.user_transcription || null,
  };
}


import { generateSpeech } from "./elevenLabsService";

export const chatGPTService: IAIChatService = {
  model: MODEL,
  generateResponse: async (
    input: UserContent,
    options: AIChatOptions,
    session?: AIChatSession
  ) => {

    try {
        console.log("Generating generateResponse for ChatGPT");
        console.log("Input:", input);
        console.log("Options:", options);
        console.log("Session:", session);
        // Add incoming message to chat history
        options.chatHistory?.push({
          role: "user",
          text: input.type === "text" ? input.text : "🎤 [Audio Message]"
        });
        const response = await client.responses.create({
          model: MODEL,
          previous_response_id: session?.previousResponseId,
          reasoning: { effort: "low" },
          input: input.type === "text" ? input.text : "🎤 [Audio Message]",
          tools: [
            {
                type: "file_search",
                vector_store_ids: [VECTOR_STORE_ID],
            },
        ],
        });
  
        console.log(response.output_text);

        const cleanText = stripCitations(response.output_text);
  
        let structuredResponse: AIActionResponse;
        try {
          const cleanedJson = cleanText.replace(/```json\n?|\n?```/g, "").trim();
          const parsed = JSON.parse(cleanedJson);
          structuredResponse = normalizeAiResponse(parsed, cleanedJson);
        } catch (e) {
          structuredResponse = { text_response: cleanText, action_id: null };
        }
  
        const audioData = await generateSpeech(structuredResponse.text_response);
  
        return {
          response: structuredResponse,
          session: {
            userId: USER_ID,
            model: "chatgpt",
            previousResponseId: response.id,
          },
          audioData,
        };
      } catch (error) {
        console.error("ChatGPT generateResponse Error:", error);
        throw error;
      }

  },

  generateGreeting: async (
    character: CharacterProfile,
    session?: AIChatSession,
    chatHistory?: ChatMessage[],
    relationship?: RelationshipMetrics | null,
    characterContext?: string
  ) => {
    try {
      console.log("Generating greeting for ChatGPT");
      console.log("Character:", character);
      console.log("Session:", session);
      console.log("Chat History:", chatHistory);
      console.log("Relationship:", relationship);
      const response = await client.responses.create({
        model: MODEL,
        reasoning: { effort: "low" },
        input: [
          {
            role: "system",
            content: buildSystemPrompt(character, relationship, [], characterContext),
          },
          {
            role: "user",
            content:
              "Generate a friendly, brief greeting. Keep it under 15 words.",
          },
        ],
      });

      console.log(response.output_text);

      const cleanText = stripCitations(response.output_text);

      let structuredResponse: AIActionResponse;
      try {
        const cleanedJson = cleanText.replace(/```json\n?|\n?```/g, "").trim();
        const parsed = JSON.parse(cleanedJson);
        structuredResponse = normalizeAiResponse(parsed, cleanedJson);
      } catch (e) {
        structuredResponse = { text_response: cleanText, action_id: null };
      }

      const audioData = await generateSpeech(structuredResponse.text_response);

      return {
        greeting: structuredResponse,
        session: {
          userId: USER_ID,
          model: "chatgpt",
          previousResponseId: response.id, // Not used in ChatGPT instead we use Chat History
        },
        audioData,
      };
    } catch (error) {
      console.error("ChatGPT Greeting Error:", error);
      throw error;
    }
  },
};
