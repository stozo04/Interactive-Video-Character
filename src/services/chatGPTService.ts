import OpenAI from "openai";
import {
  IAIChatService,
  AIChatOptions,
  AIChatSession,
  UserContent,
} from "./aiService";
import { AIActionResponse, OpenAIMemoryToolDeclarations } from "./aiSchema";
import { buildSystemPrompt, buildGreetingPrompt } from "./promptUtils";
import { ChatMessage, CharacterProfile } from "../types";
import { RelationshipMetrics } from "./relationshipService";
import { generateSpeech } from "./elevenLabsService";
import { executeMemoryTool, MemoryToolName } from "./memoryService";

const API_KEY = import.meta.env.VITE_CHATGPT_API_KEY;
const ASSISTANT_NAME = import.meta.env.VITE_CHATGPT_ASSISTANT_NAME;
const MODEL = import.meta.env.VITE_CHATGPT_MODEL;
const USER_ID = import.meta.env.VITE_USER_ID;
const VECTOR_STORE_ID = import.meta.env.VITE_CHATGPT_VECTOR_STORE_ID;

// Feature flag for memory tools
const ENABLE_MEMORY_TOOLS = true;

if (!API_KEY || !ASSISTANT_NAME || !MODEL || !USER_ID || !VECTOR_STORE_ID) {
  console.warn("Missing environment variables for ChatGPT service.");
  throw new Error("Missing environment variables for ChatGPT service.");
}

const client = new OpenAI({
  apiKey: API_KEY,
  dangerouslyAllowBrowser: true, // Client-side usage
});

function getOpenAIFunctionCallId(toolCall: any): string | undefined {
  // OpenAI Responses API has used both `call_id` and `id` for function calls in different shapes/SDK versions.
  return toolCall?.call_id || toolCall?.id;
}

function parseOpenAIFunctionArgs(raw: any): any {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw;
  return {};
}

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
    task_action: rawJson.task_action || null,
    open_app: rawJson.open_app || null,
    calendar_action: rawJson.calendar_action || null,
    news_action: rawJson.news_action || null,
    selfie_action: rawJson.selfie_action || null,
  };
}

export const chatGPTService: IAIChatService = {
  model: MODEL,
  generateResponse: async (
    input: UserContent,
    options: AIChatOptions,
    session?: AIChatSession
  ) => {
    const userId = session?.userId || USER_ID;

    try {
        console.log("🤖 [ChatGPT] Generating response");
        
        // Build tools array - include both file_search and memory tools
        const tools: any[] = [
          {
            type: "file_search",
            vector_store_ids: [VECTOR_STORE_ID],
          },
        ];

        // Add memory tools if enabled
        if (ENABLE_MEMORY_TOOLS) {
          tools.push(...OpenAIMemoryToolDeclarations);
          console.log('🧠 [ChatGPT] Memory tools enabled');
        }

        // Build system prompt with memory tool instructions
        const systemPrompt = buildSystemPrompt(
          options.character,
          options.relationship,
          options.upcomingEvents || [],
          options.characterContext,
          options.tasks
        );

        // Initial request
        let response = await client.responses.create({
          model: MODEL,
          previous_response_id: session?.previousResponseId,
          reasoning: { effort: "low" },
          instructions: systemPrompt,
          input: input.type === "text" ? input.text : "🎤 [Audio Message]",
          tools,
        });

        // ============================================
        // TOOL CALLING LOOP
        // Process any tool calls from the AI
        // ============================================
        const MAX_TOOL_ITERATIONS = 3;
        let iterations = 0;

        while (response.output && iterations < MAX_TOOL_ITERATIONS) {
          // Check for tool calls in the output
          const toolCalls = response.output.filter(
            (item: any) => item.type === 'function_call'
          );

          if (toolCalls.length === 0) break;

          iterations++;
          console.log(`🔧 [ChatGPT] Tool call iteration ${iterations}:`, 
            toolCalls.map((tc: any) => tc.name)
          );

          // Execute all tool calls
          const toolResults: any[] = [];
          for (const toolCall of toolCalls) {
            const toolName = (toolCall as any).name as MemoryToolName;
            const toolArgs = parseOpenAIFunctionArgs((toolCall as any).arguments);
            const callId = getOpenAIFunctionCallId(toolCall);

            if (!callId) {
              console.warn("🔧 [ChatGPT] Skipping tool call with missing id/call_id:", toolCall);
              continue;
            }

            console.log(`🔧 [ChatGPT] Executing tool: ${toolName} (callId=${callId})`, toolArgs);
            
            const result = await executeMemoryTool(toolName, toolArgs, userId);
            
            toolResults.push({
              type: "function_call_output",
              call_id: callId,
              output: result,
            });
          }

          if (toolResults.length === 0) {
            console.warn("🔧 [ChatGPT] Tool calls present but no tool outputs were produced; aborting tool loop.");
            break;
          }

          // Continue the conversation with tool results
          response = await client.responses.create({
            model: MODEL,
            previous_response_id: response.id,
            input: toolResults,
            tools,
          });
        }

        if (iterations >= MAX_TOOL_ITERATIONS) {
          console.warn('⚠️ [ChatGPT] Max tool iterations reached');
        }

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
            userId: userId,
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
    relationship?: RelationshipMetrics | null,
    characterContext?: string
  ) => {
    const userId = session?.userId || USER_ID;
    
    try {
      console.log("🤖 [ChatGPT] Generating greeting (fresh session)");
      
      // Build tools - include memory tools so greeting can be personalized
      const tools: any[] = [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
      ];

      if (ENABLE_MEMORY_TOOLS) {
        tools.push(...OpenAIMemoryToolDeclarations);
        console.log('🧠 [ChatGPT] Memory tools enabled for greeting');
      }

      const systemPrompt = buildSystemPrompt(character, relationship, [], characterContext);

      // First, try to get user's name from stored facts
      let userName: string | null = null;
      let hasUserFacts = false;
      
      try {
        const userFacts = await executeMemoryTool('recall_user_info', { category: 'identity' }, userId);
        hasUserFacts = userFacts && !userFacts.includes('No stored information');
        
        // Extract name if present
        const nameMatch = userFacts.match(/name:\s*(\w+)/i);
        if (nameMatch) {
          userName = nameMatch[1];
          console.log(`🤖 [ChatGPT] Found user name: ${userName}`);
        }
      } catch (e) {
        console.log('🤖 [ChatGPT] Could not fetch user facts for greeting');
      }

      // Build relationship-aware greeting prompt
      const greetingPrompt = buildGreetingPrompt(relationship, hasUserFacts, userName);
      console.log(`🤖 [ChatGPT] Greeting tier: ${relationship?.relationshipTier || 'new'}, interactions: ${relationship?.totalInteractions || 0}`);

      // Initial greeting request - can use recall_user_info to personalize
      let response = await client.responses.create({
        model: MODEL,
        reasoning: { effort: "low" },
        instructions: systemPrompt,
        input: greetingPrompt,
        tools,
      });

      // Handle tool calls for greeting (e.g., looking up user's name)
      const MAX_TOOL_ITERATIONS = 2;
      let iterations = 0;

      while (response.output && iterations < MAX_TOOL_ITERATIONS) {
        const toolCalls = response.output.filter(
          (item: any) => item.type === 'function_call'
        );

        if (toolCalls.length === 0) break;

        iterations++;
        console.log(`🔧 [ChatGPT Greeting] Tool call iteration ${iterations}`);

        const toolResults: any[] = [];
        for (const toolCall of toolCalls) {
          const toolName = (toolCall as any).name as MemoryToolName;
          const toolArgs = parseOpenAIFunctionArgs((toolCall as any).arguments);
          const callId = getOpenAIFunctionCallId(toolCall);

          if (!callId) {
            console.warn("🔧 [ChatGPT Greeting] Skipping tool call with missing id/call_id:", toolCall);
            continue;
          }

          const result = await executeMemoryTool(toolName, toolArgs, userId);
          
          toolResults.push({
            type: "function_call_output",
            call_id: callId,
            output: result,
          });
        }

        if (toolResults.length === 0) {
          console.warn("🔧 [ChatGPT Greeting] Tool calls present but no tool outputs were produced; aborting tool loop.");
          break;
        }

        response = await client.responses.create({
          model: MODEL,
          previous_response_id: response.id,
          input: toolResults,
          tools,
        });
      }

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
          userId: userId,
          model: "chatgpt",
          previousResponseId: response.id,
        },
        audioData,
      };
    } catch (error) {
      console.error("ChatGPT Greeting Error:", error);
      throw error;
    }
  },
};

