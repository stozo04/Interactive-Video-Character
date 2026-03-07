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
const DECLARED_TOOL_NAMES = new Set(
  GeminiMemoryToolDeclarations.map((decl) => decl.name)
);

function buildUndeclaredToolResult(toolName: string): string {
  if (toolName === "selfie_action" || toolName === "video_action" || toolName === "gif_action") {
    return [
      `Unknown tool: ${toolName}.`,
      "This is an output JSON field, not a callable function tool.",
      "Do not substitute another tool. Tell Steven you cannot run that tool right now.",
    ].join(" ");
  }

  return [
    `Unknown tool: ${toolName}.`,
    "Do not substitute another tool.",
    "Tell Steven you cannot run that tool right now.",
  ].join(" ");
}

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
          const rawToolName = String(fc.name || "").trim();
          const toolArgs = (fc.args || {}) as Record<string, unknown>;
          const startedAt = Date.now();

          if (!DECLARED_TOOL_NAMES.has(rawToolName)) {
            runtimeLog.warning("Model attempted undeclared tool", {
              tool: rawToolName || "(empty)",
              argsKeys: Object.keys(toolArgs),
            });
            return {
              functionResponse: {
                name: fc.name || rawToolName || "unknown_tool",
                response: { result: buildUndeclaredToolResult(rawToolName || "(empty)") },
              },
            } as Part;
          }

          const toolName = rawToolName as MemoryToolName;

          runtimeLog.info("Executing tool via bridge", {
            tool: toolName,
            argsKeys: Object.keys(toolArgs),
          });

          try {
            const result = await executeMemoryTool(toolName, toolArgs, context);
            runtimeLog.info("tool_call_summary", {
              tool: toolName,
              status: "success",
              durationMs: Date.now() - startedAt,
            });
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
            runtimeLog.info("tool_call_summary", {
              tool: toolName,
              status: "failed",
              durationMs: Date.now() - startedAt,
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
