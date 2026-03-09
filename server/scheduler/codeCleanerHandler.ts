// server/scheduler/codeCleanerHandler.ts
//
// Cron job handler for Tidy — the nightly code hygiene agent.
// Picks the next BATCH_SIZE unprocessed files in the project, runs Tidy's
// Claude loop against them, and opens a PR.
//
// State is tracked via `processedFiles` in the cron job's payload — a set of
// relative file paths already cleaned in the current loop. When all files have
// been processed, the set resets and the loop starts over. This survives file
// additions/deletions without drifting the way an integer cursor would.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runTidyLoop } from "../../agents/tidy/orchestrator";
import { BranchManager } from "../../agents/opey-dev/branchManager";
import { createPullRequest } from "../../agents/opey-dev/githubOps";
import { log } from "../runtimeLogger";
import type { SupabaseClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_PREFIX = "[CodeCleaner]";
const REPO_ROOT = path.resolve(__dirname, "../..");
const BATCH_SIZE = 5;

const INCLUDE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".claude"]);
const SKIP_SUFFIXES = [".d.ts", ".test.ts", ".spec.ts"];
// Never let Tidy clean himself
const SKIP_ABS_DIRS = [path.join(REPO_ROOT, "agents", "tidy")];

// ============================================================================
// File indexing
// ============================================================================

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_ABS_DIRS.some((skip) => fullPath.startsWith(skip))) continue;
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!INCLUDE_EXTENSIONS.has(ext)) continue;
      if (SKIP_SUFFIXES.some((s) => entry.name.endsWith(s))) continue;
      results.push(fullPath);
    }
  }

  return results;
}

function getProjectFiles(): string[] {
  return [
    ...walkFiles(path.join(REPO_ROOT, "src")),
    ...walkFiles(path.join(REPO_ROOT, "server")),
  ];
}

// ============================================================================
// TIDY comment scanner
// ============================================================================

function scanTidyComments(filePaths: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const filePath of filePaths) {
    try {
      const lines = fs.readFileSync(filePath, "utf-8").split("\n");
      const tidyLines = lines
        .map((line, i) => ({ line: line.trim(), lineNum: i + 1 }))
        .filter(({ line }) => line.includes("// TIDY:"))
        .map(({ line, lineNum }) => `  Line ${lineNum}: ${line}`);

      if (tidyLines.length > 0) result[filePath] = tidyLines;
    } catch {
      // Unreadable file — skip silently
    }
  }

  return result;
}

// ============================================================================
// Prompt builder
// ============================================================================

function buildPrompt(
  batch: string[],
  tidyComments: Record<string, string[]>
): string {
  const date = new Date().toISOString().split("T")[0];

  const fileList = batch
    .map((f) => {
      const rel = path.relative(REPO_ROOT, f);
      const comments = tidyComments[f];
      if (comments?.length) {
        return `- ${rel}\n  TIDY instructions found in this file:\n${comments.join("\n")}`;
      }
      return `- ${rel}`;
    })
    .join("\n\n");

  return `## Tidy Pass — ${date}

Repo root: ${REPO_ROOT}

Process ONLY these files (paths relative to repo root):

${fileList}

For each file:
1. Read it fully before making any changes.
2. Act on any plain \`// TIDY:\` instructions (no ⚠️) within your allowed transforms. Remove the comment when done.
3. Run your 4-transform checklist (Transform 5 / tests is disabled — skip it).
4. Leave \`// TIDY: ⚠️\` notes for anything out of scope that you notice.
5. Commit changes for that file with message: \`chore(tidy): clean <filename>\`
6. If a file needs no changes, make no commit for it.

Remember: touch ONLY the files listed above.`;
}

// ============================================================================
// Batch selection — processedFiles set replaces integer cursor
// ============================================================================

function selectBatch(
  allFiles: string[],
  processedFiles: string[]
): { batch: string[]; isNewLoop: boolean } {
  const processedSet = new Set(processedFiles);
  const relativeAllFiles = allFiles.map((f) => path.relative(REPO_ROOT, f));

  const remaining = relativeAllFiles.filter((rel) => !processedSet.has(rel));

  if (remaining.length === 0) {
    // Full loop complete — start over from the top
    return {
      batch: allFiles.slice(0, BATCH_SIZE),
      isNewLoop: true,
    };
  }

  const nextRelative = remaining.slice(0, BATCH_SIZE);
  const batch = nextRelative.map((rel) => path.join(REPO_ROOT, rel));
  return { batch, isNewLoop: false };
}

// ============================================================================
// Main handler — called by cronScheduler's JOB_HANDLERS
// ============================================================================

export async function runCodeCleanerBatch(
  job: { id: string; payload: Record<string, unknown> },
  client: SupabaseClient
): Promise<{ summary: string; metadata: Record<string, unknown>; skipSuccessMessage: boolean }> {
  log.info(`${LOG_PREFIX} Starting batch`, { source: "codeCleanerHandler.ts", jobId: job.id });

  const processedFiles: string[] = Array.isArray(job.payload?.processedFiles)
    ? (job.payload.processedFiles as string[])
    : [];

  const allFiles = getProjectFiles();

  if (allFiles.length === 0) {
    log.warning(`${LOG_PREFIX} No files found`, { source: "codeCleanerHandler.ts" });
    return { summary: "No files found to process.", metadata: {}, skipSuccessMessage: true };
  }

  const { batch, isNewLoop } = selectBatch(allFiles, processedFiles);
  const tidyComments = scanTidyComments(batch);
  const batchRelative = batch.map((f) => path.relative(REPO_ROOT, f));

  log.info(`${LOG_PREFIX} Batch selected`, {
    source: "codeCleanerHandler.ts",
    isNewLoop,
    batchSize: batch.length,
    totalFiles: allFiles.length,
    processedSoFar: isNewLoop ? 0 : processedFiles.length,
    filesWithTidyNotes: Object.keys(tidyComments).length,
    files: batchRelative,
  });

  if (isNewLoop) {
    log.info(`${LOG_PREFIX} Full loop complete — starting new loop`, {
      source: "codeCleanerHandler.ts",
      totalFiles: allFiles.length,
    });
  }

  const batchId = `tidy-${Date.now()}`;
  const manager = new BranchManager(REPO_ROOT);
  const { workPath } = manager.create(batchId);

  let prUrl: string | null = null;

  try {
    const prompt = buildPrompt(batch, tidyComments);
    await runTidyLoop(prompt, workPath);

    const loopProgress = isNewLoop
      ? `files 1–${batch.length} of ${allFiles.length} (new loop)`
      : `files ${processedFiles.length + 1}–${processedFiles.length + batch.length} of ${allFiles.length}`;

    const ticket = {
      id: batchId,
      title: `🧹 Tidy — ${new Date().toISOString().split("T")[0]} (${loopProgress})`,
      request_summary: [
        `Automated hygiene pass on ${batch.length} files.`,
        `Transforms: remove commented-out code, dead imports, standardize logging & error handling.`,
        `Files: ${batchRelative.join(", ")}`,
      ].join(" "),
    };

    prUrl = await createPullRequest(workPath, ticket);

    log.info(`${LOG_PREFIX} Batch complete`, {
      source: "codeCleanerHandler.ts",
      prUrl: prUrl ?? "no changes",
      files: batchRelative,
    });
  } finally {
    try {
      manager.cleanup(batchId);
    } catch (err) {
      log.error(`${LOG_PREFIX} Branch cleanup failed`, {
        source: "codeCleanerHandler.ts",
        error: err instanceof Error ? err.message : "Unknown",
      });
    }
  }

  // Advance processedFiles — reset on new loop
  const nextProcessedFiles = isNewLoop
    ? batchRelative
    : [...processedFiles, ...batchRelative];

  await client
    .from("cron_jobs")
    .update({ payload: { ...job.payload, processedFiles: nextProcessedFiles } })
    .eq("id", job.id);

  const remaining = allFiles.length - nextProcessedFiles.length;
  const summary = prUrl
    ? `PR opened: ${prUrl} — ${remaining} file(s) remaining in this loop`
    : `No changes needed — ${remaining} file(s) remaining in this loop`;

  return {
    summary,
    metadata: {
      prUrl,
      filesProcessed: batchRelative,
      processedCount: nextProcessedFiles.length,
      totalFiles: allFiles.length,
      remainingInLoop: remaining,
      isNewLoop,
    },
    skipSuccessMessage: true,
  };
}
