import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "./runtimeLogger";

const LOG_PREFIX = "[PatchCollector]";
const runtimeLog = log.fromContext({ source: "patchCollector" });

const GIT_TIMEOUT_MS = 30_000;
const MAX_STATUS_BYTES = 32 * 1024;
const MAX_DIFFSTAT_BYTES = 32 * 1024;
const MAX_DIFF_BYTES = 192 * 1024;
const LOG_CHUNK_BYTES = 12 * 1024;

interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface PatchCheckpointArtifacts {
  bundleDir: string;
  summaryPath: string;
  statusPath: string;
  diffStatPath: string;
  diffPath: string;
}

export interface PatchCheckpointResult {
  ok: boolean;
  ticketId: string;
  worktreePath: string;
  hasAnyChanges: boolean;
  hasChanges: boolean;
  allChangedFiles: string[];
  changedFiles: string[];
  ignoredArtifactPaths: string[];
  statusText: string;
  diffStatText: string;
  diffText: string;
  diffTruncated: boolean;
  artifacts?: PatchCheckpointArtifacts;
  errors: string[];
}

export async function collectPatchCheckpoint(options: {
  ticketId: string;
  worktreePath: string;
}): Promise<PatchCheckpointResult> {
  const { ticketId, worktreePath } = options;
  const startedAt = new Date().toISOString();
  const baseDetails = { ticketId, worktreePath, startedAt };

  console.log(`${LOG_PREFIX} collect start`, baseDetails);
  runtimeLog.info(`${LOG_PREFIX} collect start`, baseDetails);

  const statusResult = await runGitCommand(worktreePath, ["status", "--porcelain", "--branch"]);
  const diffStatResult = await runGitCommand(worktreePath, ["diff", "--stat", "--no-color"]);
  const diffResult = await runGitCommand(worktreePath, ["diff", "--no-color"]);

  const errors: string[] = [];
  if (statusResult.exitCode !== 0) {
    errors.push(`git status failed: ${statusResult.stderr || statusResult.stdout || "unknown"}`);
  }
  if (diffStatResult.exitCode !== 0) {
    errors.push(`git diff --stat failed: ${diffStatResult.stderr || diffStatResult.stdout || "unknown"}`);
  }
  if (diffResult.exitCode !== 0) {
    errors.push(`git diff failed: ${diffResult.stderr || diffResult.stdout || "unknown"}`);
  }

  if (errors.length > 0) {
    const details = {
      ...baseDetails,
      errors,
      statusExitCode: statusResult.exitCode,
      diffStatExitCode: diffStatResult.exitCode,
      diffExitCode: diffResult.exitCode,
      statusTimedOut: statusResult.timedOut,
      diffStatTimedOut: diffStatResult.timedOut,
      diffTimedOut: diffResult.timedOut,
    };
    console.log(`${LOG_PREFIX} collect failed`, details);
    runtimeLog.error(`${LOG_PREFIX} collect failed`, details);
    await emitCommandExcerpts(ticketId, {
      status: statusResult,
      diffStat: diffStatResult,
      diff: diffResult,
    });
    return {
      ok: false,
      ticketId,
      worktreePath,
      hasAnyChanges: false,
      hasChanges: false,
      allChangedFiles: [],
      changedFiles: [],
      ignoredArtifactPaths: [],
      statusText: "",
      diffStatText: "",
      diffText: "",
      diffTruncated: false,
      errors,
    };
  }

  const statusText = truncateUtf8(statusResult.stdout.trim(), MAX_STATUS_BYTES);
  const diffStatText = truncateUtf8(diffStatResult.stdout.trim(), MAX_DIFFSTAT_BYTES);
  const { text: diffText, truncated: diffTruncated } = truncateUtf8WithFlag(
    diffResult.stdout,
    MAX_DIFF_BYTES,
  );
  const allChangedFiles = parseChangedFiles(statusResult.stdout);
  const ignoredArtifactPaths = allChangedFiles.filter(isWorkflowArtifactPath);
  const changedFiles = allChangedFiles.filter((file) => !isWorkflowArtifactPath(file));
  const hasAnyChanges = allChangedFiles.length > 0;
  const hasChanges = changedFiles.length > 0;

  const artifacts = await writePatchArtifacts({
    ticketId,
    worktreePath,
    startedAt,
    statusText,
    diffStatText,
    diffText,
    diffTruncated,
    hasAnyChanges,
    allChangedFiles,
    changedFiles,
    ignoredArtifactPaths,
    hasChanges,
  });

  const summaryDetails = {
    ...baseDetails,
    hasAnyChanges,
    hasChanges,
    allChangedFilesCount: allChangedFiles.length,
    changedFilesCount: changedFiles.length,
    ignoredArtifactPathsCount: ignoredArtifactPaths.length,
    allChangedFiles,
    changedFiles,
    ignoredArtifactPaths,
    diffTruncated,
    artifacts,
    finishedAt: new Date().toISOString(),
  };
  console.log(`${LOG_PREFIX} collect complete`, summaryDetails);
  runtimeLog.info(`${LOG_PREFIX} collect complete`, summaryDetails);

  runtimeLog.info(`${LOG_PREFIX} status snapshot`, {
    ticketId,
    statusText,
    statusBytes: Buffer.byteLength(statusText, "utf8"),
  });
  runtimeLog.info(`${LOG_PREFIX} diffstat snapshot`, {
    ticketId,
    diffStatText,
    diffStatBytes: Buffer.byteLength(diffStatText, "utf8"),
  });

  const diffChunks = splitUtf8Chunks(diffText, LOG_CHUNK_BYTES);
  for (let index = 0; index < diffChunks.length; index += 1) {
    runtimeLog.info(`${LOG_PREFIX} diff chunk`, {
      ticketId,
      chunkIndex: index,
      chunkCount: diffChunks.length,
      diffTruncated,
      chunkText: diffChunks[index],
    });
  }

  return {
    ok: true,
    ticketId,
    worktreePath,
    hasAnyChanges,
    hasChanges,
    allChangedFiles,
    changedFiles,
    ignoredArtifactPaths,
    statusText,
    diffStatText,
    diffText,
    diffTruncated,
    artifacts,
    errors: [],
  };
}

async function writePatchArtifacts(options: {
  ticketId: string;
  worktreePath: string;
  startedAt: string;
  statusText: string;
  diffStatText: string;
  diffText: string;
  diffTruncated: boolean;
  hasAnyChanges: boolean;
  allChangedFiles: string[];
  changedFiles: string[];
  ignoredArtifactPaths: string[];
  hasChanges: boolean;
}): Promise<PatchCheckpointArtifacts> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bundleDirAbsolute = path.join(
    options.worktreePath,
    "patches",
    "checkpoints",
    `${timestamp}_${options.ticketId}`,
  );
  await mkdir(bundleDirAbsolute, { recursive: true });

  const summaryPathAbsolute = path.join(bundleDirAbsolute, "SUMMARY.json");
  const statusPathAbsolute = path.join(bundleDirAbsolute, "STATUS.txt");
  const diffStatPathAbsolute = path.join(bundleDirAbsolute, "DIFFSTAT.txt");
  const diffPathAbsolute = path.join(bundleDirAbsolute, "PATCH.diff");

  const summaryJson = JSON.stringify(
    {
      ticketId: options.ticketId,
      generatedAt: new Date().toISOString(),
      startedAt: options.startedAt,
      hasAnyChanges: options.hasAnyChanges,
      hasChanges: options.hasChanges,
      allChangedFiles: options.allChangedFiles,
      changedFiles: options.changedFiles,
      ignoredArtifactPaths: options.ignoredArtifactPaths,
      diffTruncated: options.diffTruncated,
      statusBytes: Buffer.byteLength(options.statusText, "utf8"),
      diffStatBytes: Buffer.byteLength(options.diffStatText, "utf8"),
      diffBytes: Buffer.byteLength(options.diffText, "utf8"),
    },
    null,
    2,
  );

  await Promise.all([
    writeFile(summaryPathAbsolute, summaryJson, "utf8"),
    writeFile(statusPathAbsolute, options.statusText || "(empty)\n", "utf8"),
    writeFile(diffStatPathAbsolute, options.diffStatText || "(empty)\n", "utf8"),
    writeFile(diffPathAbsolute, options.diffText || "(empty)\n", "utf8"),
  ]);

  const bundleDir = normalizeRelativePath(path.relative(options.worktreePath, bundleDirAbsolute));
  return {
    bundleDir,
    summaryPath: normalizeRelativePath(path.relative(options.worktreePath, summaryPathAbsolute)),
    statusPath: normalizeRelativePath(path.relative(options.worktreePath, statusPathAbsolute)),
    diffStatPath: normalizeRelativePath(path.relative(options.worktreePath, diffStatPathAbsolute)),
    diffPath: normalizeRelativePath(path.relative(options.worktreePath, diffPathAbsolute)),
  };
}

async function emitCommandExcerpts(
  ticketId: string,
  results: {
    status: GitCommandResult;
    diffStat: GitCommandResult;
    diff: GitCommandResult;
  },
): Promise<void> {
  runtimeLog.info(`${LOG_PREFIX} command excerpts`, {
    ticketId,
    statusStdout: truncateUtf8(results.status.stdout, 4_000),
    statusStderr: truncateUtf8(results.status.stderr, 4_000),
    diffStatStdout: truncateUtf8(results.diffStat.stdout, 4_000),
    diffStatStderr: truncateUtf8(results.diffStat.stderr, 4_000),
    diffStdout: truncateUtf8(results.diff.stdout, 4_000),
    diffStderr: truncateUtf8(results.diff.stderr, 4_000),
  });
}

async function runGitCommand(worktreePath: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd: worktreePath,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve({ exitCode, stdout, stderr, timedOut });
    };

    const timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 2_000).unref();
    }, GIT_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      stderr = [stderr, error.message].filter(Boolean).join("\n");
      finish(1);
    });

    child.on("close", (exitCode) => {
      finish(typeof exitCode === "number" ? exitCode : 1);
    });
  });
}

export function parseChangedFiles(rawStatus: string): string[] {
  const files = new Set<string>();
  for (const line of rawStatus.split(/\r?\n/)) {
    if (!line || line.startsWith("##")) {
      continue;
    }
    const remainder = line.length >= 4 ? line.slice(3).trim() : line.trim();
    if (!remainder) {
      continue;
    }
    const file = remainder.includes(" -> ")
      ? remainder.split(" -> ").pop() || remainder
      : remainder;
    files.add(file.replace(/^"+|"+$/g, ""));
  }
  return [...files];
}

export function isWorkflowArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!normalized) {
    return false;
  }
  return normalized === "bugs"
    || normalized.startsWith("bugs/")
    || normalized === "patches"
    || normalized.startsWith("patches/");
}

function splitUtf8Chunks(input: string, maxBytes: number): string[] {
  if (!input) {
    return [];
  }
  const chunks: string[] = [];
  let offset = 0;
  while (offset < input.length) {
    let end = Math.min(input.length, offset + Math.ceil(maxBytes / 2));
    while (end < input.length && Buffer.byteLength(input.slice(offset, end), "utf8") < maxBytes) {
      end += 256;
    }
    while (end > offset && Buffer.byteLength(input.slice(offset, end), "utf8") > maxBytes) {
      end -= 1;
    }
    if (end <= offset) {
      break;
    }
    chunks.push(input.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function truncateUtf8(input: string, maxBytes: number): string {
  return truncateUtf8WithFlag(input, maxBytes).text;
}

function truncateUtf8WithFlag(
  input: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) {
    return { text: input, truncated: false };
  }
  let end = input.length;
  while (end > 0 && Buffer.byteLength(input.slice(0, end), "utf8") > maxBytes) {
    end -= 1;
  }
  return { text: input.slice(0, end), truncated: true };
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
