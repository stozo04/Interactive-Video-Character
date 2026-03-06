// server/services/engineeringTicketBridge.ts
//
// Polls engineering_tickets for terminal/attention statuses and forwards
// notifications to edge channels (Telegram, WhatsApp, etc.).

import { supabaseAdmin as supabase } from "./supabaseAdmin";
import { log } from "../runtimeLogger";

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_REPLAY_MINUTES = 180;
const MAX_ROWS_PER_POLL = 100;
const MAX_RECENT_KEYS = 5000;
const EVENT_TYPE = "bridge_notification_sent";
const NOTIFY_STATUSES = ["completed", "failed", "needs_clarification", "pr_ready"] as const;

type NotifiableStatus = (typeof NOTIFY_STATUSES)[number];

interface TicketRow {
  id: string;
  title: string | null;
  status: string;
  failure_reason: string | null;
  final_pr_url: string | null;
  clarification_questions: string | null;
  updated_at: string;
}

export interface EngineeringTicketBridgeOptions {
  channelName: string;
  actorName: string;
  sendMessage: (message: string) => Promise<void>;
  isReady?: () => boolean;
  pollIntervalMs?: number;
}

export interface EngineeringTicketBridgeHandle {
  stop: () => void;
}

function parseReplayMinutes(raw: string | undefined): number {
  const parsed = Number(raw ?? `${DEFAULT_REPLAY_MINUTES}`);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_REPLAY_MINUTES;
  return parsed;
}

function toNotifiableStatus(status: string): NotifiableStatus | null {
  return (NOTIFY_STATUSES as readonly string[]).includes(status)
    ? (status as NotifiableStatus)
    : null;
}

function buildNotificationMessage(row: TicketRow, status: NotifiableStatus): string {
  const title = row.title?.trim() || "Untitled engineering ticket";

  if (status === "completed") {
    const prLine = row.final_pr_url ? `\nPR: ${row.final_pr_url}` : "";
    return `Opey finished "${title}".${prLine}`;
  }

  if (status === "failed") {
    const reason = row.failure_reason?.trim();
    return reason
      ? `Opey failed "${title}".\nReason: ${reason}`
      : `Opey failed "${title}".`;
  }

  if (status === "pr_ready") {
    const prLine = row.final_pr_url ? `\nPR: ${row.final_pr_url}` : "";
    return `Opey marked "${title}" as PR-ready.${prLine}`;
  }

  const questions = row.clarification_questions?.trim();
  return questions
    ? `Opey needs more info for "${title}".\nQuestions:\n${questions}`
    : `Opey needs more info for "${title}".`;
}

function rememberKey(cache: Set<string>, key: string): void {
  cache.add(key);
  if (cache.size > MAX_RECENT_KEYS) {
    cache.clear();
    cache.add(key);
  }
}

async function alreadySentForRow(
  ticketId: string,
  actorName: string,
  summary: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("engineering_ticket_events")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("event_type", EVENT_TYPE)
    .eq("actor_name", actorName)
    .eq("summary", summary)
    .limit(1);

  if (error) {
    log.error("Failed to query bridge dedupe events", {
      source: "engineeringTicketBridge",
      ticketId,
      actorName,
      error: error.message,
    });
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

async function recordSentEvent(
  row: TicketRow,
  actorName: string,
  summary: string,
  channelName: string,
): Promise<void> {
  const { error } = await supabase.from("engineering_ticket_events").insert({
    id: crypto.randomUUID(),
    ticket_id: row.id,
    event_type: EVENT_TYPE,
    actor_type: "system",
    actor_name: actorName,
    summary,
    payload: {
      channel: channelName,
      status: row.status,
      ticket_updated_at: row.updated_at,
      sent_at: new Date().toISOString(),
    },
  });

  if (error) {
    log.error("Failed to write bridge sent event", {
      source: "engineeringTicketBridge",
      ticketId: row.id,
      actorName,
      error: error.message,
    });
  }
}

export function startEngineeringTicketBridge(
  options: EngineeringTicketBridgeOptions,
): EngineeringTicketBridgeHandle {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const replayMinutes = parseReplayMinutes(process.env.ENGINEERING_TICKET_BRIDGE_REPLAY_MINUTES);
  const runtimeLog = log.fromContext({
    source: "engineeringTicketBridge",
    route: `bridge/${options.channelName}`,
  });

  const recentKeys = new Set<string>();
  let pollTimer: NodeJS.Timeout | null = null;
  let running = false;
  let cursorIso = new Date(Date.now() - replayMinutes * 60_000).toISOString();

  const poll = async (): Promise<void> => {
    if (running) return;
    if (options.isReady && !options.isReady()) return;

    running = true;
    try {
      const { data, error } = await supabase
        .from("engineering_tickets")
        .select("id, title, status, failure_reason, final_pr_url, clarification_questions, updated_at")
        .in("status", [...NOTIFY_STATUSES])
        .gt("updated_at", cursorIso)
        .order("updated_at", { ascending: true })
        .limit(MAX_ROWS_PER_POLL);

      if (error) {
        runtimeLog.error("Ticket bridge poll failed", {
          source: "engineeringTicketBridge",
          channel: options.channelName,
          error: error.message,
          cursorIso,
        });
        return;
      }

      if (!data || data.length === 0) return;

      runtimeLog.info("Ticket bridge poll found candidate rows", {
        source: "engineeringTicketBridge",
        channel: options.channelName,
        count: data.length,
        cursorIso,
      });

      let nextCursorIso = cursorIso;
      for (const row of data as TicketRow[]) {
        const status = toNotifiableStatus(row.status);
        if (!status) continue;

        const dedupeSummary = `${options.channelName}:${row.id}:${status}:${row.updated_at}`;
        if (recentKeys.has(dedupeSummary)) {
          if (row.updated_at > nextCursorIso) nextCursorIso = row.updated_at;
          continue;
        }

        const alreadySent = await alreadySentForRow(row.id, options.actorName, dedupeSummary);
        if (alreadySent) {
          rememberKey(recentKeys, dedupeSummary);
          if (row.updated_at > nextCursorIso) nextCursorIso = row.updated_at;
          continue;
        }

        const message = buildNotificationMessage(row, status);
        await options.sendMessage(message);
        rememberKey(recentKeys, dedupeSummary);

        await recordSentEvent(row, options.actorName, dedupeSummary, options.channelName);
        if (row.updated_at > nextCursorIso) nextCursorIso = row.updated_at;
        runtimeLog.info("Engineering ticket notification sent", {
          source: "engineeringTicketBridge",
          channel: options.channelName,
          ticketId: row.id,
          status,
        });
      }

      cursorIso = nextCursorIso;
    } catch (err) {
      runtimeLog.error("Ticket bridge poll crashed", {
        source: "engineeringTicketBridge",
        channel: options.channelName,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  };

  runtimeLog.info("Engineering ticket bridge started", {
    source: "engineeringTicketBridge",
    channel: options.channelName,
    pollIntervalMs,
    replayMinutes,
    notifyStatuses: NOTIFY_STATUSES.join(", "),
  });

  const kickoffTimer = setTimeout(() => {
    void poll();
    pollTimer = setInterval(() => {
      void poll();
    }, pollIntervalMs);
  }, 3_000);

  return {
    stop: () => {
      clearTimeout(kickoffTimer);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      runtimeLog.info("Engineering ticket bridge stopped", {
        source: "engineeringTicketBridge",
        channel: options.channelName,
      });
    },
  };
}
