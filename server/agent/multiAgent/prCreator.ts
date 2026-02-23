import fs from "node:fs/promises";
import path from "node:path";
import type { EngineeringTicket } from "./types";

const DEFAULT_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "server",
  "docs",
  "PR_Template.md",
);

interface GitHubRepoInfo {
  owner: string;
  repo: string;
}

export interface PrBodyEvidence {
  patchArtifacts?: {
    summaryPath?: string | null;
    statusPath?: string | null;
    diffStatPath?: string | null;
    diffPath?: string | null;
  } | null;
  changedFiles?: string[];
  diffStatText?: string;
  workspaceRunSummaries?: Array<{
    runId: string;
    action: string;
    status: string;
    summary: string;
  }>;
}

export function resolveGitHubToken(): string {
  const token = process.env.GITHUB_API_TOKEN;
  if (!token || !token.trim()) {
    throw new Error("Missing GITHUB_API_TOKEN env var for GitHub API calls.");
  }
  return token.trim();
}

export function resolveGitHubRepo(): GitHubRepoInfo {
  const raw =
    (process.env.GITHUB_REPO || process.env.GITHUB_REPO_URL || "").trim();
  if (!raw) {
    throw new Error("Missing GITHUB_REPO or GITHUB_REPO_URL env var.");
  }

  if (raw.includes("github.com/")) {
    const parts = raw.split("github.com/")[1]?.split("/") ?? [];
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
    }
  }

  const simple = raw.split("/");
  if (simple.length === 2) {
    return { owner: simple[0], repo: simple[1] };
  }

  throw new Error(`Invalid GitHub repo format: ${raw}`);
}

export async function fetchDefaultBranch(
  token: string,
  repo: GitHubRepoInfo,
): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
    headers: buildGitHubHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`GitHub repo lookup failed (${response.status}).`);
  }
  const data = (await response.json()) as { default_branch?: string };
  if (!data.default_branch) {
    throw new Error("GitHub repo lookup missing default_branch.");
  }
  return data.default_branch;
}

export async function createGitHubPullRequest(options: {
  token: string;
  repo: GitHubRepoInfo;
  title: string;
  head: string;
  base: string;
  body: string;
}): Promise<{ htmlUrl: string }> {
  const response = await fetch(
    `https://api.github.com/repos/${options.repo.owner}/${options.repo.repo}/pulls`,
    {
      method: "POST",
      headers: buildGitHubHeaders(options.token),
      body: JSON.stringify({
        title: options.title,
        head: options.head,
        base: options.base,
        body: options.body,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub PR create failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as { html_url?: string };
  if (!data.html_url) {
    throw new Error("GitHub PR create response missing html_url.");
  }

  return { htmlUrl: data.html_url };
}

export async function buildPrBodyFromTemplate(
  ticket: EngineeringTicket,
  templatePath: string = DEFAULT_TEMPLATE_PATH,
  evidence?: PrBodyEvidence,
): Promise<string> {
  const template = await fs.readFile(templatePath, "utf-8");
  const summaryLines = [
    "## Auto Summary",
    `- Ticket: ${ticket.id}`,
    `- Title: ${ticket.title || "(untitled)"}`,
    `- Summary: ${ticket.requestSummary || "(none)"}`,
    "",
  ].join("\n");

  const automationEvidence = buildAutomationEvidenceSection(evidence);

  let patched = template;
  if (ticket.requestType === "bug") {
    patched = patched.replace("-   [ ] Bug fix", "-   [x] Bug fix");
  } else if (ticket.requestType === "feature") {
    patched = patched.replace("-   [ ] Feature", "-   [x] Feature");
  }

  return `${summaryLines}${automationEvidence}${patched}`.trim();
}

function buildGitHubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
}

function buildAutomationEvidenceSection(evidence?: PrBodyEvidence): string {
  if (!evidence) {
    return "";
  }

  const changedFiles = Array.isArray(evidence.changedFiles)
    ? evidence.changedFiles.filter((file) => typeof file === "string" && file.trim())
    : [];
  const runSummaries = Array.isArray(evidence.workspaceRunSummaries)
    ? evidence.workspaceRunSummaries.slice(0, 10)
    : [];
  const diffStatText = typeof evidence.diffStatText === "string"
    ? evidence.diffStatText.trim()
    : "";
  const patchArtifacts = evidence.patchArtifacts ?? null;

  if (!patchArtifacts && changedFiles.length === 0 && !diffStatText && runSummaries.length === 0) {
    return "";
  }

  const patchArtifactLines = patchArtifacts
    ? [
        patchArtifacts.summaryPath ? `- Patch Summary: ${patchArtifacts.summaryPath}` : "",
        patchArtifacts.statusPath ? `- Patch Status: ${patchArtifacts.statusPath}` : "",
        patchArtifacts.diffStatPath ? `- Patch DiffStat: ${patchArtifacts.diffStatPath}` : "",
        patchArtifacts.diffPath ? `- Patch Diff: ${patchArtifacts.diffPath}` : "",
      ].filter(Boolean)
    : [];

  const changedFileLines = changedFiles.length > 0
    ? changedFiles.slice(0, 25).map((file) => `- ${file}`)
    : ["- None recorded"];
  const runLines = runSummaries.length > 0
    ? runSummaries.map((run) =>
        `- ${run.runId} | action=${run.action} | status=${run.status} | summary=${run.summary}`,
      )
    : ["- No workspace runs summarized"];
  const diffStatPreview = diffStatText ? diffStatText.slice(0, 2000) : "(empty)";

  return [
    "## Automation Evidence",
    "",
    "### Patch Artifacts",
    ...(patchArtifactLines.length > 0 ? patchArtifactLines : ["- None recorded"]),
    "",
    "### Changed Files",
    ...changedFileLines,
    "",
    "### DiffStat",
    "```text",
    diffStatPreview,
    "```",
    "",
    "### Workspace Run Summary",
    ...runLines,
    "",
  ].join("\n");
}
