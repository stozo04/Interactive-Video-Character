// server/services/kayley_dashboard/index.ts
// Kayley Dashboard (pulse) - periodic service health checks + snapshot file.

import { log } from "../../runtimeLogger";
import { ai, GEMINI_MODEL } from "../ai/geminiClient";
import { bot, getStevenChatId } from "../../../telegram/telegramClient";
import {
  appendConversationHistory,
  getTodaysInteractionId,
} from "../../../src/services/conversationHistoryService";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeLog = log.fromContext({ source: "kayleyDashboard", route: "kayley/pulse" });

const TICK_MS = 10 * 60 * 1000;
const MAX_HISTORY = 50;
const REQUEST_TIMEOUT_MS = 6_000;

const DEFAULT_SERVER_BASE_URL = "http://localhost:4010";
const DEFAULT_WHATSAPP_HEALTH_URL = "http://localhost:4011";
const DEFAULT_TELEGRAM_HEALTH_URL = "http://localhost:4012";
const DEFAULT_OPEY_HEALTH_URL = "http://localhost:4013";
const DEFAULT_TIDY_HEALTH_URL = "http://localhost:4014";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PULSE_CONFIG_PATH = path.join(__dirname, "pulse-config.json");

type PulseOverallStatus = "ok" | "degraded" | "failed";

type PulseServiceStatus = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
};

type PulseRun = {
  runId: string;
  reason: "scheduled" | "manual";
  requestedBy?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  overallStatus: PulseOverallStatus;
  services: Record<string, PulseServiceStatus>;
  summary: {
    okCount: number;
    failCount: number;
    failingServices: string[];
  };
};

type PulseConfig = {
  version: number;
  updatedAt: string | null;
  latest: PulseRun | null;
  history: PulseRun[];
};

function buildDefaultConfig(): PulseConfig {
  return {
    version: 1,
    updatedAt: null,
    latest: null,
    history: [],
  };
}

function getServerBaseUrl(): string {
  const configured = process.env.KAYLEY_PULSE_SERVER_URL ?? process.env.SERVER_BASE_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  return DEFAULT_SERVER_BASE_URL;
}

function getWhatsAppHealthUrl(): string {
  const configured = process.env.WHATSAPP_HEALTH_URL ?? process.env.WHATSAPP_BRIDGE_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  const port = process.env.WHATSAPP_HEALTH_PORT;
  if (port && port.trim()) return `http://localhost:${port.trim()}`;
  return DEFAULT_WHATSAPP_HEALTH_URL;
}

function getTelegramHealthUrl(): string {
  const configured = process.env.TELEGRAM_HEALTH_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  const port = process.env.TELEGRAM_HEALTH_PORT;
  if (port && port.trim()) return `http://localhost:${port.trim()}`;
  return DEFAULT_TELEGRAM_HEALTH_URL;
}

function getOpeyHealthUrl(): string {
  const configured = process.env.OPEY_HEALTH_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  const port = process.env.OPEY_HEALTH_PORT;
  if (port && port.trim()) return `http://localhost:${port.trim()}`;
  return DEFAULT_OPEY_HEALTH_URL;
}

function getTidyHealthUrl(): string {
  const configured = process.env.TIDY_HEALTH_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  const port = process.env.TIDY_HEALTH_PORT;
  if (port && port.trim()) return `http://localhost:${port.trim()}`;
  return DEFAULT_TIDY_HEALTH_URL;
}

async function fetchJsonWithTimeout(url: string): Promise<{ ok: boolean; status: number | null; json?: any; error?: string; latencyMs: number }>
{
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const text = await response.text();
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: text.trim() || `HTTP ${response.status}`,
        latencyMs,
      };
    }

    if (!text.trim()) {
      return { ok: true, status: response.status, json: {}, latencyMs };
    }

    try {
      const json = JSON.parse(text);
      return { ok: true, status: response.status, json, latencyMs };
    } catch (err) {
      return {
        ok: false,
        status: response.status,
        error: `Non-JSON response: ${text.slice(0, 160)}`,
        latencyMs,
      };
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkMultiAgentHealth(): Promise<PulseServiceStatus> {
  const baseUrl = getServerBaseUrl();
  const response = await fetchJsonWithTimeout(`${baseUrl}/multi-agent/health`);

  if (!response.ok) {
    return { ok: false, latencyMs: response.latencyMs, error: response.error };
  }

  const ok = response.json?.ok === true;
  return {
    ok,
    latencyMs: response.latencyMs,
    error: ok ? undefined : response.json?.error || "Health check failed",
    details: {
      latencyMs: response.json?.latencyMs ?? null,
      status: response.status,
    },
  };
}

async function checkOpeyHealth(): Promise<PulseServiceStatus> {
  const baseUrl = getOpeyHealthUrl();
  const response = await fetchJsonWithTimeout(`${baseUrl}/health`);

  if (!response.ok) {
    return { ok: false, latencyMs: response.latencyMs, error: response.error };
  }

  const alive = response.json?.alive === true;
  const ok = response.json?.ok === true && alive;
  return {
    ok,
    latencyMs: response.latencyMs,
    error: ok ? undefined : response.json?.error || "Opey not alive",
    details: {
      alive,
      currentTicketId: response.json?.currentTicketId ?? null,
      lastPollAt: response.json?.lastPollAt ?? null,
    },
  };
}

async function checkTidyHealth(): Promise<PulseServiceStatus> {
  const baseUrl = getTidyHealthUrl();
  const response = await fetchJsonWithTimeout(`${baseUrl}/health`);

  if (!response.ok) {
    return { ok: false, latencyMs: response.latencyMs, error: response.error };
  }

  const alive = response.json?.alive === true;
  const ok = response.json?.ok === true && alive;
  return {
    ok,
    latencyMs: response.latencyMs,
    error: ok ? undefined : response.json?.error || "Tidy not alive",
    details: {
      alive,
      isProcessing: response.json?.isProcessing === true,
      lastTickAt: response.json?.lastTickAt ?? null,
    },
  };
}

async function checkTelegramHealth(): Promise<PulseServiceStatus> {
  const baseUrl = getTelegramHealthUrl();
  const response = await fetchJsonWithTimeout(`${baseUrl}/health`);

  if (!response.ok) {
    return { ok: false, latencyMs: response.latencyMs, error: response.error };
  }

  const ok = response.json?.ok === true;
  return {
    ok,
    latencyMs: response.latencyMs,
    error: ok ? undefined : response.json?.error || "Telegram health failed",
    details: {
      transport: response.json?.transport ?? null,
    },
  };
}

async function checkWhatsAppHealth(): Promise<PulseServiceStatus> {
  const baseUrl = getWhatsAppHealthUrl();
  const response = await fetchJsonWithTimeout(`${baseUrl}/health`);

  if (!response.ok) {
    return { ok: false, latencyMs: response.latencyMs, error: response.error };
  }

  const connected = response.json?.connected === true;
  const ok = response.json?.ok === true && connected;
  return {
    ok,
    latencyMs: response.latencyMs,
    error: ok ? undefined : response.json?.error || "WhatsApp not connected",
    details: {
      connected,
    },
  };
}

function summarizeRun(services: Record<string, PulseServiceStatus>): {
  overallStatus: PulseOverallStatus;
  okCount: number;
  failCount: number;
  failingServices: string[];
} {
  const entries = Object.entries(services);
  const failing = entries.filter(([, status]) => !status.ok).map(([name]) => name);
  const okCount = entries.length - failing.length;
  const failCount = failing.length;

  let overallStatus: PulseOverallStatus = "ok";
  if (failCount === entries.length && entries.length > 0) {
    overallStatus = "failed";
  } else if (failCount > 0) {
    overallStatus = "degraded";
  }

  return { overallStatus, okCount, failCount, failingServices: failing };
}

async function generatePulseAlertMessage(
  run: PulseRun,
  type: "degraded" | "recovered",
): Promise<string> {
  const failing = run.summary.failingServices.join(", ");

  const prompt =
    type === "degraded"
      ? `I just ran a system health check and these services are down: ${failing}. Overall status: ${run.overallStatus}. Write a brief, calm 1-2 sentence notification to Steven — concerned but not panicked. Mention which services are affected.`
      : `All services just came back online after being down. Write a brief, relieved 1-sentence message to Steven that everything is back to normal.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.6,
      systemInstruction:
        "You are Kayley Adams, a warm AI companion texting Steven. Be natural and brief. No excessive emojis.",
      maxOutputTokens: 100,
    },
  });

  return (
    response.text?.trim() ||
    (type === "degraded"
      ? `Hey, health check flagged an issue — ${failing} ${run.summary.failCount === 1 ? "appears" : "appear"} to be down.`
      : "All systems are back online!")
  );
}

async function sendPulseAlert(
  run: PulseRun,
  type: "degraded" | "recovered",
): Promise<void> {
  const message = await generatePulseAlertMessage(run, type);

  // Telegram push
  const chatId = getStevenChatId();
  if (chatId) {
    try {
      await bot.api.sendMessage(chatId, message);
      runtimeLog.info("Pulse alert delivered to Telegram", {
        source: "kayleyDashboard",
        type,
        overallStatus: run.overallStatus,
      });
    } catch (err) {
      runtimeLog.error("Failed to deliver pulse alert to Telegram", {
        source: "kayleyDashboard",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Persist to conversation_history so Kayley remembers the alert on her next turn
  try {
    const interactionId = await getTodaysInteractionId();
    const logId = crypto.randomUUID();
    await appendConversationHistory(
      [{ role: "model", text: message }],
      interactionId ?? undefined,
      logId,
    );
  } catch (err) {
    runtimeLog.error("Failed to persist pulse alert to conversation_history", {
      source: "kayleyDashboard",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function readPulseConfig(): Promise<PulseConfig> {
  try {
    const raw = await fs.readFile(PULSE_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as PulseConfig;
    if (!parsed || typeof parsed !== "object") {
      return buildDefaultConfig();
    }
    return {
      version: parsed.version ?? 1,
      updatedAt: parsed.updatedAt ?? null,
      latest: parsed.latest ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      runtimeLog.warning("Failed to read pulse config, falling back to default", {
        source: "kayleyDashboard",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return buildDefaultConfig();
  }
}

async function writePulseConfig(config: PulseConfig): Promise<void> {
  const payload = JSON.stringify(config, null, 2);
  await fs.writeFile(PULSE_CONFIG_PATH, `${payload}\n`, "utf8");
}

export async function runPulseCheck(options?: {
  reason?: "scheduled" | "manual";
  requestedBy?: string;
}): Promise<PulseRun> {
  const startedAt = new Date();
  const runId = crypto.randomUUID();
  const reason = options?.reason ?? "scheduled";

  runtimeLog.info("Kayley pulse check starting", {
    source: "kayleyDashboard",
    runId,
    reason,
    requestedBy: options?.requestedBy ?? null,
  });

  const [server, opey, tidy, telegram, whatsapp] = await Promise.all([
    checkMultiAgentHealth(),
    checkOpeyHealth(),
    checkTidyHealth(),
    checkTelegramHealth(),
    checkWhatsAppHealth(),
  ]);

  const services: Record<string, PulseServiceStatus> = {
    server: server,
    opey: opey,
    tidy: tidy,
    telegram: telegram,
    whatsapp: whatsapp,
  };

  const summary = summarizeRun(services);
  const finishedAt = new Date();
  const run: PulseRun = {
    runId,
    reason,
    requestedBy: options?.requestedBy,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    overallStatus: summary.overallStatus,
    services,
    summary: {
      okCount: summary.okCount,
      failCount: summary.failCount,
      failingServices: summary.failingServices,
    },
  };

  const current = await readPulseConfig();
  // Capture previous status BEFORE writing — used for transition detection.
  // null means first run ever; treat as "ok" so we don't alert on cold start.
  const previousStatus: PulseOverallStatus = current.latest?.overallStatus ?? "ok";

  const updatedHistory = [run, ...current.history].slice(0, MAX_HISTORY);
  const updated: PulseConfig = {
    version: 1,
    updatedAt: run.finishedAt,
    latest: run,
    history: updatedHistory,
  };

  await writePulseConfig(updated);

  runtimeLog.info("Kayley pulse check complete", {
    source: "kayleyDashboard",
    runId,
    overallStatus: run.overallStatus,
    okCount: run.summary.okCount,
    failCount: run.summary.failCount,
    failingServices: run.summary.failingServices.join(", ") || "none",
  });

  if (run.overallStatus !== "ok") {
    runtimeLog.warning("Kayley pulse: degraded or failed services detected", {
      source: "kayleyDashboard",
      runId,
      overallStatus: run.overallStatus,
      failingServices: run.summary.failingServices,
    });
  }

  // Push alerts on state transitions — scheduled runs only.
  // Manual runs skip alerts: Kayley triggered it herself, she already knows.
  if (reason === "scheduled") {
    const wentDown = previousStatus === "ok" && run.overallStatus !== "ok";
    const recovered = previousStatus !== "ok" && run.overallStatus === "ok";

    if (wentDown || recovered) {
      const alertType = wentDown ? "degraded" : "recovered";
      runtimeLog.info("Pulse state transition detected — sending alert", {
        source: "kayleyDashboard",
        runId,
        previousStatus,
        currentStatus: run.overallStatus,
        alertType,
      });
      sendPulseAlert(run, alertType).catch((err) => {
        runtimeLog.error("Pulse alert delivery failed", {
          source: "kayleyDashboard",
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  return run;
}

let intervalId: NodeJS.Timeout | null = null;

export function startKayleyPulseDashboard(): { stop: () => void } {
  runtimeLog.info("Starting Kayley pulse dashboard", {
    source: "kayleyDashboard",
    tickMs: TICK_MS,
    maxHistory: MAX_HISTORY,
    pulseConfigPath: PULSE_CONFIG_PATH,
  });

  // Initial tick after a short delay to allow services to come up.
  setTimeout(() => {
    runPulseCheck({ reason: "scheduled" }).catch((error) => {
      runtimeLog.error("Initial pulse check failed", {
        source: "kayleyDashboard",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 15_000);

  intervalId = setInterval(() => {
    runPulseCheck({ reason: "scheduled" }).catch((error) => {
      runtimeLog.error("Pulse check failed", {
        source: "kayleyDashboard",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, TICK_MS);

  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      runtimeLog.info("Kayley pulse dashboard stopped", { source: "kayleyDashboard" });
    },
  };
}

export function getPulseConfigPath(): string {
  return PULSE_CONFIG_PATH;
}
