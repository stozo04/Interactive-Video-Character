import { spawn } from "node:child_process";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

const LOG_PREFIX = "[GifOps]";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 25;
const DOWNLOAD_FOLDER_NAME = "Downloads";

const DOWNLOAD_EXTENSIONS = new Set([".gif", ".mp4", ".webm"]);
const EXTRACT_EXTENSIONS = new Set([".gif", ".png", ".jpg", ".jpeg", ".webp"]);

export type GifSource = "giphy" | "tenor" | "auto";
export type GifActionType =
  | "search"
  | "preview"
  | "download"
  | "extract_stills"
  | "extract_sheet";

export interface GifActionOutcome {
  status: "success" | "failed" | "verification_failed";
  summary: string;
  evidence: string[];
}

interface GifActionRequest {
  action: GifActionType;
  query?: string;
  source?: GifSource;
  max_results?: number;
  url?: string;
  id?: string;
  gif_path?: string;
  output_dir?: string;
}

interface GifgrepResult {
  id?: string;
  title?: string;
  url?: string;
  preview_url?: string;
  tags?: string[];
  width?: number;
  height?: number;
}

export async function executeGifAction(options: {
  args: Record<string, unknown>;
  workspaceRoot: string;
}): Promise<GifActionOutcome> {
  const request = parseGifActionRequest(options.args, options.workspaceRoot);

  if (!request) {
    return {
      status: "failed",
      summary: "Invalid gif action request.",
      evidence: ["Unable to parse gif action arguments."],
    };
  }

  switch (request.action) {
    case "search":
      return runSearch(request, false, options.workspaceRoot);
    case "preview":
      return runSearch(request, true, options.workspaceRoot);
    case "download":
      return runDownload(request);
    case "extract_stills":
      return runExtract(request, "stills");
    case "extract_sheet":
      return runExtract(request, "sheet");
    default:
      return {
        status: "failed",
        summary: `Unknown gif action: ${request.action}`,
        evidence: [`Unknown gif action: ${request.action}`],
      };
  }
}

function parseGifActionRequest(
  args: Record<string, unknown>,
  workspaceRoot: string,
): GifActionRequest | null {
  const action = normalizeString(args.action);
  if (!action) {
    return null;
  }

  if (
    action !== "search" &&
    action !== "preview" &&
    action !== "download" &&
    action !== "extract_stills" &&
    action !== "extract_sheet"
  ) {
    return null;
  }

  const outputDir = resolveOptionalPath(args.output_dir, workspaceRoot);
  const gifPath = resolveOptionalPath(args.gif_path, workspaceRoot);

  return {
    action,
    query: normalizeString(args.query),
    source: normalizeGifSource(args.source),
    max_results: normalizeNumber(args.max_results),
    url: normalizeString(args.url),
    id: normalizeString(args.id),
    gif_path: gifPath,
    output_dir: outputDir,
  };
}

async function runSearch(
  request: GifActionRequest,
  previewOnly: boolean,
  cwd: string,
): Promise<GifActionOutcome> {
  const query = request.query?.trim();
  if (!query) {
    return {
      status: "failed",
      summary: "gif search requires a query.",
      evidence: ["Missing query for gif search."],
    };
  }

  const maxResults = clampMaxResults(request.max_results);
  const args = ["search", "--json"];

  if (request.source) {
    args.push("--source", request.source);
  }

  args.push(query);

  const result = await runGifgrep(args, cwd);
  if (!result.ok) {
    return {
      status: "failed",
      summary: "gif search failed.",
      evidence: buildGifgrepEvidence(result, ["Command: gifgrep " + args.join(" ")]),
    };
  }

  const parsed = safeParseJson(result.stdout);
  if (!Array.isArray(parsed)) {
    return {
      status: "failed",
      summary: "gif search returned invalid JSON.",
      evidence: [
        "gifgrep output was not a JSON array.",
        truncateLine(result.stdout, 800),
      ],
    };
  }

  const limited = parsed.slice(0, maxResults) as GifgrepResult[];
  const formatted = formatSearchResults(limited, previewOnly);
  const evidence = [
    `Query: ${query}`,
    `Source: ${request.source ?? "auto"}`,
    `Results: ${limited.length}`,
    ...formatted,
  ];

  return {
    status: "success",
    summary: previewOnly
      ? `gif preview returned ${limited.length} result(s).`
      : `gif search returned ${limited.length} result(s).`,
    evidence,
  };
}

async function runDownload(request: GifActionRequest): Promise<GifActionOutcome> {
  const target = request.url || request.id || request.query;
  if (!target) {
    return {
      status: "failed",
      summary: "gif download requires a url, id, or query.",
      evidence: ["Missing url/id/query for gif download."],
    };
  }

  const downloadsDir = resolveDownloadsDir(request.output_dir);
  await ensureDir(downloadsDir);

  const beforeSnapshot = await snapshotDirectory(downloadsDir);
  const args = ["download"];
  const isUrlTarget = /^https?:\/\//i.test(target);
  if (request.source && !isUrlTarget) {
    args.push("--source", request.source);
  }
  args.push(target);

  const result = await runGifgrep(args, downloadsDir);
  let downloadEvidence: string[] = [];
  if (!result.ok && request.url) {
    const fallback = await downloadDirect(request.url, downloadsDir);
    if (fallback.status === "success") {
      return {
        status: "success",
        summary: "gif download succeeded via direct URL.",
        evidence: [
          "gifgrep download failed; fell back to direct download.",
          ...fallback.evidence,
          ...buildGifgrepEvidence(result, ["Command: gifgrep " + args.join(" ")]),
        ],
      };
    }
    downloadEvidence = [
      "gifgrep download failed; direct download fallback also failed.",
      ...fallback.evidence,
      ...buildGifgrepEvidence(result, ["Command: gifgrep " + args.join(" ")]),
    ];
  } else if (!result.ok) {
    downloadEvidence = buildGifgrepEvidence(result, ["Command: gifgrep " + args.join(" ")]);
  }

  if (downloadEvidence.length > 0) {
    return {
      status: "failed",
      summary: "gif download failed.",
      evidence: downloadEvidence,
    };
  }

  const afterSnapshot = await snapshotDirectory(downloadsDir);
  const newFiles = diffNewFiles(beforeSnapshot, afterSnapshot, DOWNLOAD_EXTENSIONS);
  if (newFiles.length === 0) {
    return {
      status: "verification_failed",
      summary: "gif download finished but no new media file was detected.",
      evidence: [
        `Download directory: ${downloadsDir}`,
        "No new GIF/MP4/WebM files detected after download.",
      ],
    };
  }

  const newestFile = pickNewestFile(afterSnapshot, newFiles);
  const evidence = [
    `Download directory: ${downloadsDir}`,
    `New files: ${newFiles.join(", ")}`,
  ];

  if (newestFile) {
    evidence.push(`Downloaded file: ${newestFile}`);
  }

  return {
    status: "success",
    summary: "gif download completed.",
    evidence,
  };
}

async function runExtract(
  request: GifActionRequest,
  mode: "stills" | "sheet",
): Promise<GifActionOutcome> {
  const gifPath = request.gif_path?.trim();
  if (!gifPath) {
    return {
      status: "failed",
      summary: "gif extract requires gif_path.",
      evidence: ["Missing gif_path for extract action."],
    };
  }

  if (!fs.existsSync(gifPath)) {
    return {
      status: "failed",
      summary: "gif file not found.",
      evidence: [`gif_path not found: ${gifPath}`],
    };
  }

  const outputDir = request.output_dir
    ? request.output_dir
    : path.dirname(gifPath);
  await ensureDir(outputDir);

  const beforeSnapshot = await snapshotDirectory(outputDir);
  const commandCandidates =
    mode === "stills"
      ? [["stills", gifPath], ["still", gifPath]]
      : [["sheet", gifPath], ["sheets", gifPath]];

  const attempt = await tryGifgrepCandidates(commandCandidates, outputDir);
  if (!attempt.ok) {
    return {
      status: "failed",
      summary: `gif extract ${mode} failed.`,
      evidence: attempt.evidence,
    };
  }

  const afterSnapshot = await snapshotDirectory(outputDir);
  const newFiles = diffNewFiles(beforeSnapshot, afterSnapshot, EXTRACT_EXTENSIONS);
  if (newFiles.length === 0) {
    return {
      status: "verification_failed",
      summary: `gif extract ${mode} finished but no new files were detected.`,
      evidence: [
        `Output directory: ${outputDir}`,
        "No new extract output files detected.",
      ],
    };
  }

  const newestFile = pickNewestFile(afterSnapshot, newFiles);
  const evidence = [
    `Output directory: ${outputDir}`,
    `New files: ${newFiles.join(", ")}`,
  ];
  if (newestFile) {
    evidence.push(`Latest output: ${newestFile}`);
  }

  return {
    status: "success",
    summary: `gif extract ${mode} completed.`,
    evidence,
  };
}

async function runGifgrep(
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }> {
  console.log(`${LOG_PREFIX} Running gifgrep`, { args, cwd });

  return new Promise((resolve) => {
    const child = spawn("gifgrep", args, {
      cwd,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${String(error.message || error)}`,
        exitCode: null,
      });
    });

    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code ?? null,
      });
    });
  });
}

async function tryGifgrepCandidates(
  candidates: string[][],
  cwd: string,
): Promise<{ ok: boolean; evidence: string[] }> {
  const evidence: string[] = [];
  for (const args of candidates) {
    const result = await runGifgrep(args, cwd);
    if (result.ok) {
      evidence.push(`Command: gifgrep ${args.join(" ")}`);
      evidence.push(...buildGifgrepEvidence(result));
      return { ok: true, evidence };
    }

    evidence.push(`Command failed: gifgrep ${args.join(" ")}`);
    evidence.push(...buildGifgrepEvidence(result));
  }

  return { ok: false, evidence };
}

async function downloadDirect(
  url: string,
  downloadDir: string,
): Promise<GifActionOutcome> {
  try {
    console.log(`${LOG_PREFIX} Direct download fallback`, { url, downloadDir });
    const response = await fetch(url);
    if (!response.ok) {
      return {
        status: "failed",
        summary: "Direct download failed.",
        evidence: [
          `Direct download HTTP ${response.status}`,
          `URL: ${url}`,
        ],
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!isMediaContentType(contentType)) {
      return {
        status: "failed",
        summary: "Direct download returned non-media content.",
        evidence: [
          `Content-Type: ${contentType || "(unknown)"}`,
          `URL: ${url}`,
        ],
      };
    }

    let urlExtension = "";
    try {
      const parsed = new URL(url);
      urlExtension = path.extname(parsed.pathname);
    } catch {
      urlExtension = path.extname(url);
    }
    const extension = extensionForContentType(contentType) || urlExtension || ".gif";
    const filename = `gifgrep_${Date.now()}${extension}`;
    const filePath = path.join(downloadDir, filename);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fsp.writeFile(filePath, buffer);

    return {
      status: "success",
      summary: "Direct download completed.",
      evidence: [`Downloaded file: ${filePath}`, `Content-Type: ${contentType}`],
    };
  } catch (error) {
    return {
      status: "failed",
      summary: "Direct download threw an error.",
      evidence: [String(error instanceof Error ? error.message : error)],
    };
  }
}

function buildGifgrepEvidence(
  result: { stdout: string; stderr: string; exitCode: number | null },
  extra: string[] = [],
): string[] {
  const evidence: string[] = [...extra];
  if (result.exitCode !== null) {
    evidence.push(`Exit code: ${result.exitCode}`);
  }
  if (result.stderr.trim()) {
    evidence.push(`stderr: ${truncateLine(result.stderr, 800)}`);
  }
  if (result.stdout.trim()) {
    evidence.push(`stdout: ${truncateLine(result.stdout, 800)}`);
  }
  return evidence;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatSearchResults(
  results: GifgrepResult[],
  previewOnly: boolean,
): string[] {
  return results.map((result, index) => {
    const title = result.title ? `title="${result.title}"` : "title=(untitled)";
    const id = result.id ? `id=${result.id}` : "id=(none)";
    const url = previewOnly
      ? result.preview_url || result.url || "(no preview url)"
      : result.url || result.preview_url || "(no url)";
    const size =
      typeof result.width === "number" && typeof result.height === "number"
        ? `${result.width}x${result.height}`
        : "size=(unknown)";
    return `${index + 1}. ${title} ${id} ${size} url=${url}`;
  });
}

function clampMaxResults(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.max(1, Math.min(MAX_RESULTS_LIMIT, Math.floor(value)));
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function normalizeGifSource(value: unknown): GifSource | undefined {
  if (value === "giphy" || value === "tenor" || value === "auto") {
    return value;
  }
  return undefined;
}

function resolveOptionalPath(
  value: unknown,
  workspaceRoot: string,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const raw = value.trim();
  const expanded = expandHomePath(raw);
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  return path.resolve(workspaceRoot, expanded);
}

function resolveDownloadsDir(override?: string): string {
  if (override && override.trim().length > 0) {
    const expanded = expandHomePath(override.trim());
    return path.resolve(expanded);
  }
  return path.join(os.homedir(), DOWNLOAD_FOLDER_NAME);
}

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

async function snapshotDirectory(dir: string): Promise<Map<string, number>> {
  const snapshot = new Map<string, number>();
  try {
    const entries = await fsp.readdir(dir);
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry);
        try {
          const stat = await fsp.stat(fullPath);
          if (stat.isFile()) {
            snapshot.set(entry, stat.mtimeMs);
          }
        } catch {
          // Ignore entries that cannot be stat'd.
        }
      }),
    );
  } catch {
    return snapshot;
  }
  return snapshot;
}

function diffNewFiles(
  before: Map<string, number>,
  after: Map<string, number>,
  allowedExtensions: Set<string>,
): string[] {
  const newFiles: string[] = [];
  for (const [fileName, afterTime] of after) {
    const beforeTime = before.get(fileName);
    if (typeof beforeTime === "number" && afterTime <= beforeTime) {
      continue;
    }
    const extension = path.extname(fileName).toLowerCase();
    if (allowedExtensions.has(extension)) {
      newFiles.push(fileName);
    }
  }
  return newFiles;
}

function pickNewestFile(
  snapshot: Map<string, number>,
  fileNames: string[],
): string | null {
  let newest: string | null = null;
  let newestTime = 0;
  for (const fileName of fileNames) {
    const time = snapshot.get(fileName);
    if (typeof time === "number" && time >= newestTime) {
      newestTime = time;
      newest = fileName;
    }
  }
  return newest;
}

function isMediaContentType(contentType: string): boolean {
  return contentType.includes("image/") || contentType.includes("video/");
}

function extensionForContentType(contentType: string): string | null {
  if (contentType.includes("image/gif")) return ".gif";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("video/mp4")) return ".mp4";
  if (contentType.includes("video/webm")) return ".webm";
  return null;
}

function truncateLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) {
    return line;
  }
  return `${line.slice(0, maxLength)}...`;
}

function expandHomePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}
