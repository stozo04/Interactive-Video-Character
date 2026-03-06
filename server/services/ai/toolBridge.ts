// server/services/ai/toolBridge.ts
//
// Wraps the existing GeminiMemoryToolDeclarations + executeMemoryTool()
// into the @google/genai SDK CallableTool interface.
//
// This is a zero-migration bridge: all tool declarations and execution logic
// stay in their current files. The bridge just adapts the interface.
//
// PHASE 2 NOTE: When services move to server/services/, update imports below.

import type { CallableTool, FunctionCall, Part, Tool } from "@google/genai";
import { GeminiMemoryToolDeclarations } from "../../../src/services/aiSchema";
import {
  executeMemoryTool,
  type MemoryToolName,
  type ToolExecutionContext,
} from "../../../src/services/memoryService";
import { log } from "../../runtimeLogger";

const runtimeLog = log.fromContext({ source: "toolBridge" });

/**
 * Creates a CallableTool that wraps ALL existing Gemini memory/action tools.
 *
 * The SDK's automaticFunctionCalling will:
 * 1. Call tool() to get the function declarations
 * 2. When the model emits function_call, call callTool() with the calls
 * 3. Feed the results back to the model automatically
 *
 * @param context - Optional execution context (access tokens, current events, etc.)
 */
export function createCallableTools(context?: ToolExecutionContext): CallableTool {
  return {
    async tool(): Promise<Tool> {
      return {
        functionDeclarations: GeminiMemoryToolDeclarations.map((decl) => ({
          name: decl.name,
          description: decl.description,
          parameters: decl.parameters as any,
        })),
      };
    },

    async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
      const results = await Promise.all(
        functionCalls.map(async (fc) => {
          const toolName = fc.name as MemoryToolName;
          const toolArgs = fc.args || {};

          runtimeLog.info("Executing tool via bridge", {
            tool: toolName,
            argsKeys: Object.keys(toolArgs),
          });

          try {
            const result = await executeMemoryTool(toolName, toolArgs, context);
            return {
              functionResponse: {
                name: fc.name,
                response: { result },
              },
            } as Part;
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            runtimeLog.error("Tool execution failed", {
              tool: toolName,
              error: errorMsg,
            });
            return {
              functionResponse: {
                name: fc.name,
                response: { error: errorMsg },
              },
            } as Part;
          }
        })
      );

      return results;
    },
  };
}
