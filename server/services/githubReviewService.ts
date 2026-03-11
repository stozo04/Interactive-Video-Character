// server/services/githubReviewService.ts
//
// Fetches a GitHub PR's metadata, diff, and CI check status using the
// GitHub REST API. Called by the review_pr Gemini function tool via a
// dynamic import in memoryService.ts.
//
// Uses GITHUB_API_KEY — same token Opey uses to create PRs in githubOps.ts.

import { log } from "../runtimeLogger";
import { supabaseAdmin } from "./supabaseAdmin";

const runtimeLog = log.fromContext({ source: "githubReviewService", route: "github/review" });

const GITHUB_API_BASE = "https://api.github.com";

// Truncate large diffs so Kayley's context window stays sane.
// 12k chars ≈ ~300-400 lines of diff — enough to review meaningfully.
const MAX_DIFF_CHARS = 12_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrReviewSummary {
  prNumber: number;
  title: string;
  author: string;
  state: string; // "open" | "closed" | "merged"
  url: string;
  description: string;
  headSha: string;
  checksStatus: "all_passed" | "some_failed" | "pending" | "no_checks";
  failingChecks: string[];
  diff: string;
  diffTruncated: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePrUrl(prUrl: string): { owner: string; repo: string; number: number } {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error(`Cannot parse GitHub PR URL: ${prUrl}`);
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

async function githubFetch(
  path: string,
  token: string,
  accept = "application/vnd.github+json",
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function fetchPrReview(prUrl: string): Promise<PrReviewSummary> {
  const token = process.env.GITHUB_API_KEY;
  if (!token) throw new Error("GITHUB_API_KEY not set — cannot fetch PR review");

  const { owner, repo, number } = parsePrUrl(prUrl);
  const prPath = `/repos/${owner}/${repo}/pulls/${number}`;

  runtimeLog.info("Fetching PR review", {
    source: "githubReviewService",
    owner,
    repo,
    prNumber: number,
  });

  // Fetch PR metadata and diff in parallel — check-runs need the head SHA first.
  const [prRes, diffRes] = await Promise.all([
    githubFetch(prPath, token),
    githubFetch(prPath, token, "application/vnd.github.diff"),
  ]);

  if (!prRes.ok) {
    throw new Error(
      `GitHub API ${prRes.status} fetching PR #${number}: ${prRes.body.slice(0, 200)}`,
    );
  }

  const pr = JSON.parse(prRes.body) as {
    number: number;
    title: string;
    body: string | null;
    state: string;
    merged: boolean;
    html_url: string;
    user: { login: string };
    head: { sha: string };
  };

  // Now we have the SHA — fetch check-runs.
  const checksRes = await githubFetch(
    `/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs`,
    token,
  );

  let checksStatus: PrReviewSummary["checksStatus"] = "no_checks";
  const failingChecks: string[] = [];

  if (checksRes.ok) {
    const parsed = JSON.parse(checksRes.body) as {
      check_runs: Array<{ name: string; status: string; conclusion: string | null }>;
    };
    const runs = parsed.check_runs;
    if (runs.length > 0) {
      const pending = runs.filter((r) => r.status !== "completed");
      const failed = runs.filter(
        (r) =>
          r.status === "completed" &&
          r.conclusion !== "success" &&
          r.conclusion !== "skipped" &&
          r.conclusion !== "neutral",
      );
      for (const r of failed) failingChecks.push(r.name);

      if (pending.length > 0) checksStatus = "pending";
      else if (failingChecks.length > 0) checksStatus = "some_failed";
      else checksStatus = "all_passed";
    }
  }

  // Diff — truncate if needed.
  let diff = diffRes.ok ? diffRes.body : "(diff unavailable)";
  const diffTruncated = diff.length > MAX_DIFF_CHARS;
  if (diffTruncated) {
    diff =
      diff.slice(0, MAX_DIFF_CHARS) +
      `\n\n[DIFF TRUNCATED — ${diff.length - MAX_DIFF_CHARS} more chars not shown]`;
  }

  const state = pr.merged ? "merged" : pr.state;

  runtimeLog.info("PR review fetched", {
    source: "githubReviewService",
    owner,
    repo,
    prNumber: number,
    state,
    checksStatus,
    failingCheckCount: failingChecks.length,
    diffTruncated,
  });

  return {
    prNumber: number,
    title: pr.title,
    author: pr.user.login,
    state,
    url: pr.html_url,
    description: pr.body?.trim() || "(no description)",
    headSha: pr.head.sha,
    checksStatus,
    failingChecks,
    diff,
    diffTruncated,
  };
}

// ---------------------------------------------------------------------------
// Output formatter — called by the memoryService case to produce a single
// readable string for Kayley's context window.
// ---------------------------------------------------------------------------

export function formatPrReview(summary: PrReviewSummary): string {
  const ciLine =
    summary.checksStatus === "all_passed"
      ? "CI: all checks passed ✓"
      : summary.checksStatus === "some_failed"
        ? `CI: ${summary.failingChecks.length} check(s) failed — ${summary.failingChecks.join(", ")}`
        : summary.checksStatus === "pending"
          ? "CI: checks still running"
          : "CI: no checks found";

  const truncationNote = summary.diffTruncated
    ? "\n[Note: diff was truncated — only the first 12,000 chars are shown]"
    : "";

  return [
    `PR #${summary.prNumber} — "${summary.title}"`,
    `Author: ${summary.author} | State: ${summary.state} | ${ciLine}`,
    `URL: ${summary.url}`,
    ``,
    `Description:`,
    summary.description,
    ``,
    `--- DIFF ---${truncationNote}`,
    summary.diff,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// PR feedback submission — called by submit_pr_review tool when verdict is
// 'needs_changes'. Writes feedback to the ticket and resets it to 'created'
// so Opey picks it up and fixes the existing PR.
// ---------------------------------------------------------------------------

export async function submitPrFeedback(
  ticketId: string,
  feedback: string,
): Promise<void> {
  runtimeLog.info("Writing PR review feedback to ticket", {
    source: "githubReviewService",
    ticketId,
  });

  const { error } = await supabaseAdmin
    .from("engineering_tickets")
    .update({
      pr_feedback: feedback,
      status: "created",
    })
    .eq("id", ticketId);

  if (error) {
    throw new Error(`Failed to write PR feedback for ticket ${ticketId}: ${error.message}`);
  }

  runtimeLog.info("PR feedback written — ticket reset to created", {
    source: "githubReviewService",
    ticketId,
  });
}
