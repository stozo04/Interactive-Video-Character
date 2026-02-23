import { open, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[CodexDiagnostics]";
const runtimeLog = log.fromContext({ source: "codexDiagnostics" });

const MAX_LOG_TAIL_BYTES = 96 * 1024;
const MAX_CLI_STDOUT_BYTES = 24 * 1024;
const MAX_CLI_STDERR_BYTES = 24 * 1024;
const LOG_CHUNK_BYTES = 12 * 1024;
const STALE_LOG_MTIME_GRACE_MS = 15_000;

export interface CodexDiagnosticsCaptureOptions {
  reason: "timeout" | "invalid_json" | "abnormal_exit";
  ticketId?: string;
  cwd?: string;
  startedAtIso?: string;
  finishedAtIso?: string;
  cliStdout?: string;
  cliStderr?: string;
  cliExitCode?: number | null;
}

interface CodexLogFileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

export async function captureCodexDiagnosticsSnapshot(
  options: CodexDiagnosticsCaptureOptions,
): Promise<void> {
  const ticketId = options.ticketId ?? null;
  const baseDetails = {
    ticketId,
    reason: options.reason,
    cwd: options.cwd ?? null,
    startedAtIso: options.startedAtIso ?? null,
    finishedAtIso: options.finishedAtIso ?? null,
    cliExitCode: options.cliExitCode ?? null,
    cliStdoutLength: options.cliStdout?.length ?? 0,
    cliStderrLength: options.cliStderr?.length ?? 0,
  };

  try {
    const logFile = await findLatestCodexLogFile();
    if (!logFile) {
      runtimeLog.warning(`${LOG_PREFIX} no Codex diagnostic log file found`, baseDetails);
      await emitCliExcerpts(options, baseDetails);
      return;
    }

    const startedAtMs = parseIsoTimeMs(options.startedAtIso);
    if (
      startedAtMs !== null &&
      Number.isFinite(logFile.mtimeMs) &&
      logFile.mtimeMs + STALE_LOG_MTIME_GRACE_MS < startedAtMs
    ) {
      const staleDetails = {
        ...baseDetails,
        logPath: logFile.path,
        logFileSizeBytes: logFile.size,
        logFileModifiedAtIso: new Date(logFile.mtimeMs).toISOString(),
        diagnosticsLogStale: true,
        staleByMs: Math.max(0, Math.round(startedAtMs - logFile.mtimeMs)),
      };
      runtimeLog.warning(`${LOG_PREFIX} snapshot skipped stale log file`, staleDetails);
      await emitCliExcerpts(options, staleDetails);
      return;
    }

    const rawTail = await readTailUtf8(logFile.path, MAX_LOG_TAIL_BYTES);
    const redactedTail = redactSensitiveText(rawTail);
    const requestIds = extractRequestIds(redactedTail);
    const highlights = extractHighlights(redactedTail, 20);

    runtimeLog.info(`${LOG_PREFIX} snapshot summary`, {
      ...baseDetails,
      logPath: logFile.path,
      logFileSizeBytes: logFile.size,
      logFileModifiedAtIso: new Date(logFile.mtimeMs).toISOString(),
      logTailBytesRead: Buffer.byteLength(rawTail, "utf8"),
      logTailBytesStored: Buffer.byteLength(redactedTail, "utf8"),
      requestIds,
      highlightCount: highlights.length,
      highlights,
    });

    const logChunks = splitIntoChunks(redactedTail, LOG_CHUNK_BYTES);
    for (let index = 0; index < logChunks.length; index += 1) {
      runtimeLog.info(`${LOG_PREFIX} snapshot log tail chunk`, {
        ...baseDetails,
        logPath: logFile.path,
        chunkIndex: index,
        chunkCount: logChunks.length,
        chunkText: logChunks[index],
      });
    }

    await emitCliExcerpts(options, {
      ...baseDetails,
      logPath: logFile.path,
      requestIds,
    });
  } catch (error) {
    runtimeLog.error(`${LOG_PREFIX} snapshot capture failed`, {
      ...baseDetails,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function emitCliExcerpts(
  options: CodexDiagnosticsCaptureOptions,
  baseDetails: Record<string, unknown>,
): Promise<void> {
  const stdoutExcerpt = truncateUtf8(redactSensitiveText(options.cliStdout ?? ""), MAX_CLI_STDOUT_BYTES);
  const stderrExcerpt = truncateUtf8(redactSensitiveText(options.cliStderr ?? ""), MAX_CLI_STDERR_BYTES);

  if (!stdoutExcerpt && !stderrExcerpt) {
    return;
  }

  runtimeLog.info(`${LOG_PREFIX} cli excerpts`, {
    ...baseDetails,
    stdoutExcerpt,
    stderrExcerpt,
    stdoutTruncated:
      Buffer.byteLength(options.cliStdout ?? "", "utf8") > Buffer.byteLength(stdoutExcerpt, "utf8"),
    stderrTruncated:
      Buffer.byteLength(options.cliStderr ?? "", "utf8") > Buffer.byteLength(stderrExcerpt, "utf8"),
  });
}

async function findLatestCodexLogFile(): Promise<CodexLogFileInfo | null> {
  const home = os.homedir();
  const candidateDirs = [
    path.join(home, ".codex", "log"),
    path.join(home, ".codex", "logs"),
  ];

  const candidates: CodexLogFileInfo[] = [];

  for (const dirPath of candidateDirs) {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const name = entry.name.toLowerCase();
        if (!name.includes("codex") && !name.endsWith(".log")) {
          continue;
        }
        const filePath = path.join(dirPath, entry.name);
        try {
          const fileStat = await stat(filePath);
          candidates.push({
            path: filePath,
            size: fileStat.size,
            mtimeMs: fileStat.mtimeMs,
          });
        } catch {
          // Ignore files that disappear during enumeration.
        }
      }
    } catch {
      // Ignore missing/unreadable directories.
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0];
}

async function readTailUtf8(filePath: string, maxBytes: number): Promise<string> {
  const fileHandle = await open(filePath, "r");
  try {
    const stats = await fileHandle.stat();
    const length = Math.max(Math.min(stats.size, maxBytes), 0);
    if (length === 0) {
      return "";
    }
    const start = Math.max(stats.size - length, 0);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await fileHandle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await fileHandle.close();
  }
}

function redactSensitiveText(input: string): string {
  if (!input) {
    return "";
  }

  return input
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)[^\r\n]+/gi, "$1[REDACTED]");
}

function extractRequestIds(input: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /\breq_[A-Za-z0-9]+\b/g,
    /\brequest[_ -]?id[:= ]+([A-Za-z0-9_-]+)\b/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(input)) !== null) {
      const value = match[1] ?? match[0];
      if (value) {
        ids.add(value);
      }
      if (ids.size >= 20) {
        return [...ids];
      }
    }
  }

  return [...ids];
}

function extractHighlights(input: string, maxLines: number): string[] {
  if (!input) {
    return [];
  }
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const highlighted = lines.filter((line) =>
    /error|warn|timeout|retry|fail|denied|disconnect|exception/i.test(line),
  );
  return highlighted.slice(-maxLines);
}

function splitIntoChunks(input: string, maxBytesPerChunk: number): string[] {
  if (!input) {
    return [];
  }
  const chunks: string[] = [];
  let remaining = input;
  while (remaining.length > 0) {
    let sliceLength = remaining.length;
    let chunk = remaining;
    while (sliceLength > 0 && Buffer.byteLength(chunk, "utf8") > maxBytesPerChunk) {
      sliceLength = Math.floor(sliceLength * 0.8);
      chunk = remaining.slice(0, sliceLength);
    }
    if (!chunk) {
      chunk = truncateUtf8(remaining, maxBytesPerChunk);
      if (!chunk) {
        break;
      }
    }
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length);
  }
  return chunks;
}

function truncateUtf8(input: string, maxBytes: number): string {
  if (!input) {
    return "";
  }
  if (Buffer.byteLength(input, "utf8") <= maxBytes) {
    return input;
  }
  let end = input.length;
  while (end > 0 && Buffer.byteLength(input.slice(0, end), "utf8") > maxBytes) {
    end -= 1;
  }
  return input.slice(0, end);
}

function parseIsoTimeMs(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
