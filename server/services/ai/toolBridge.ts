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

/**
 * Handles tool calls Gemini makes for names that aren't declared as callable function tools.
 *
 * Two cases:
 *
 * 1. selfie_action / video_action / gif_action — Gemini sometimes tries to *call* these as
 *    function tools even though they're output JSON fields, not declared tools. We intercept
 *    the failed call and redirect Gemini: "this is a JSON field, not a function — put the
 *    args there instead." This recovers the turn without claiming failure to Steven.
 *
 * 2. Everything else — genuine unknown tool. Tell Gemini to stop and report it.
 */
function buildUndeclaredToolResult(
  toolName: string,
  toolArgs?: Record<string, unknown>
): string {
  if (toolName === "selfie_action" || toolName === "video_action" || toolName === "gif_action") {
    // JSON.stringify throws on circular references. toolArgs comes from Gemini's structured
    // output so this should never happen in practice, but we guard defensively so the
    // function always returns a usable string rather than crashing.
    const serializedArgs = (() => {
      try {
        return JSON.stringify(toolArgs || {});
      } catch {
        return "{}";
      }
    })();

    return [
      `${toolName} is an output JSON field, not a callable function tool.`,
      "Continue this turn by returning final JSON with this field populated.",
      `Reuse these arguments for the JSON field: ${serializedArgs}.`,
      "Do not claim tool failure to Steven.",
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
  // Tracks tool failures across all callTool invocations within this turn.
  // When failureCount hits 3, Gemini gets a hard stop telling her to report back
  // to Steven rather than keep retrying indefinitely.
  let failureCount = 0;

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
                response: {
                  result: buildUndeclaredToolResult(
                    rawToolName || "(empty)",
                    toolArgs
                  ),
                },
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
            failureCount++;
            const remaining = 3 - failureCount;

            runtimeLog.error("Tool execution failed", {
              tool: toolName,
              error: errorMsg,
              failureCount,
            });
            runtimeLog.info("tool_call_summary", {
              tool: toolName,
              status: "failed",
              durationMs: Date.now() - startedAt,
              error: errorMsg,
              failureCount,
            });

            const feedbackMessage = failureCount >= 3
              ? `Tool "${toolName}" failed: ${errorMsg}. You have now failed 3 times this turn. Stop retrying. Report back to Steven honestly: what you were trying to do, what failed each time, and why you're stuck.`
              : `Tool "${toolName}" failed: ${errorMsg}. ${remaining} attempt(s) remaining — think about what went wrong and try a different approach before retrying.`;

            return {
              functionResponse: {
                name: fc.name,
                response: { error: feedbackMessage },
              },
            } as Part;
          }
        })
      );

      return results;
    },
  };
}
