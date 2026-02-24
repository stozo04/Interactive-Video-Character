// ./server/agent/opey-dev/githubOps.ts
// Github (The CICD)

import { execSync } from "node:child_process";
import { log } from "../../runtimeLogger";

export function createPullRequest(workPath: string, ticket: any) {
  try {
    log.info("Preparing git commit", {
      source: "githubOps.ts",
      ticketId: ticket?.id,
      workPath,
    });
    // 1. Stage and Commit everything Opey did
    execSync(`git add .`, { cwd: workPath });
    execSync(`git commit -m "Opey: ${ticket.title}"`, { cwd: workPath });

    log.info("Pushing branch", {
      source: "githubOps.ts",
      ticketId: ticket?.id,
      workPath,
    });
    // 2. Push the branch to origin
    execSync(`git push origin HEAD`, { cwd: workPath });

    log.info("Creating PR via GitHub CLI", {
      source: "githubOps.ts",
      ticketId: ticket?.id,
    });
    // 3. Create the PR using the GitHub CLI (gh)
    const prCommand = `gh pr create --title "${ticket.title}" --body "Automated fix by Opey. Summary: ${ticket.requestSummary}"`;
    const prUrl = execSync(prCommand, { cwd: workPath }).toString();

    log.info("PR created", {
      source: "githubOps.ts",
      ticketId: ticket?.id,
      prUrl: prUrl.trim(),
    });
    return prUrl.trim();
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
