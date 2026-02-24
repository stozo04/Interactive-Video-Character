// ./server/agent/opey-dev/githubOps.ts
// Github (The CICD)

import { execSync } from "node:child_process";
import { log } from "../../runtimeLogger";

const SHELL_OPTS = process.platform === "win32" ? { shell: "bash" as const } : {};

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, ...SHELL_OPTS }).toString().trim();
}

/** Parse "owner/repo" from the git remote URL. */
function getOwnerRepo(workPath: string): { owner: string; repo: string } {
  const url = run("git remote get-url origin", workPath);
  // Handles both https://github.com/owner/repo.git and git@github.com:owner/repo.git
  const match = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Cannot parse GitHub owner/repo from remote: ${url}`);
  return { owner: match[1], repo: match[2] };
}

export async function createPullRequest(workPath: string, ticket: any) {
  try {
    // 1. Commit any uncommitted changes (Claude may have already committed)
    const status = run("git status --porcelain", workPath);

    if (status.length > 0) {
      log.info("Staging uncommitted changes", {
        source: "githubOps.ts",
        ticketId: ticket?.id,
      });
      run("git add .", workPath);
      run(`git commit -m "Opey: ${ticket.title}"`, workPath);
    } else {
      log.info("No uncommitted changes — Claude already committed", {
        source: "githubOps.ts",
        ticketId: ticket?.id,
      });
    }

    // 2. Check if there are any commits ahead of main
    const commitsAhead = run("git log main..HEAD --oneline", workPath);
    if (commitsAhead.length === 0) {
      log.warning("No commits ahead of main — Claude made no changes", {
        source: "githubOps.ts",
        ticketId: ticket?.id,
      });
      return null;
    }

    // 3. Push the branch to origin (force: remote may exist from a prior run of this ticket)
    log.info("Pushing branch", {
      source: "githubOps.ts",
      ticketId: ticket?.id,
    });
    run("git push origin HEAD --force", workPath);

    // 4. Create the PR via GitHub REST API
    const token = process.env.GITHUB_API_KEY;
    if (!token) throw new Error("GITHUB_API_KEY not set in environment");

    const { owner, repo } = getOwnerRepo(workPath);
    const head = run("git rev-parse --abbrev-ref HEAD", workPath);
    const title = ticket.title ?? "Opey fix";
    const summary = ticket.request_summary ?? ticket.requestSummary ?? ticket.description ?? "";

    log.info("Creating PR via GitHub API", {
      source: "githubOps.ts",
      ticketId: ticket?.id,
      owner,
      repo,
      head,
    });

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        body: `Automated fix by Opey.\n\n${summary}`,
        head,
        base: "main",
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GitHub API ${res.status}: ${errBody}`);
    }

    const pr = (await res.json()) as { html_url: string };

    log.info("PR created", {
      source: "githubOps.ts",
      ticketId: ticket?.id,
      prUrl: pr.html_url,
    });
    return pr.html_url;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.critical("Failed to create PR", {
      source: "githubOps.ts",
      ticketId: ticket?.id,
      error: message,
    });
    throw err;
  }
}
