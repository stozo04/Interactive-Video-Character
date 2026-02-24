// ./server/agent/opey-dev/orchestrator-openai.ts
// OpenAI version — same interface as Claude, different brain

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const LOG_PREFIX = "[Orchestrator-OpenAI]";

// Control which OpenAI model to use
const OPENAI_MODEL = "gpt-5.2-codex";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadSoulPrompt(): string {
  const soulPath = path.join(__dirname, "SOUL.md");
  return fs.readFileSync(soulPath, "utf-8");
}

function buildTicketPrompt(ticket: any): string {
  const parts = [
    `# Ticket: ${ticket.title ?? "Untitled"}`,
    ticket.type ? `**Type:** ${ticket.type}` : null,
    ticket.summary ? `**Summary:** ${ticket.summary}` : null,
    ticket.details ?? ticket.description ?? null,
  ].filter(Boolean);

  return parts.join("\n\n");
}

export async function runOpeyLoop(ticket: any, workPath: string, log: any) {
  log.info(`${LOG_PREFIX} Opey loop start (OpenAI)`, {
    source: "orchestrator-openai.ts",
    ticketId: ticket?.id,
    workPath,
    model: OPENAI_MODEL,
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set in environment");
  }

  const client = new OpenAI({ apiKey });
  const soulPrompt = loadSoulPrompt();
  const ticketPrompt = buildTicketPrompt(ticket);

  try {
    const response = await client.messages.create({
      model: OPENAI_MODEL,
      max_tokens: 4096,
      system: soulPrompt,
      messages: [
        {
          role: "user",
          content: ticketPrompt,
        },
      ],
    });

    // Extract text response
    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from OpenAI");
    }

    const output = textContent.text;

    log.info(`${LOG_PREFIX} OpenAI response`, {
      source: "orchestrator-openai.ts",
      ticketId: ticket?.id,
      outputLength: output.length,
      model: OPENAI_MODEL,
    });

    // Log the output in chunks for visibility
    const chunk = output.slice(0, 2000);
    log.info(`${LOG_PREFIX} OpenAI stdout`, {
      source: "orchestrator-openai.ts",
      ticketId: ticket?.id,
      chunk,
    });

    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error(`${LOG_PREFIX} Opey loop failed`, {
      source: "orchestrator-openai.ts",
      ticketId: ticket?.id,
      error: message,
    });
    throw err;
  }
}
