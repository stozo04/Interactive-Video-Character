import { spawn } from "node:child_process";

interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GitStatusExecutionResult {
  branch: string | null;
  statusSummary: string;
  rawStatus: string;
}

export interface GitCommitExecutionResult {
  commitHash: string | null;
  commitMessage: string;
  commandOutput: string;
}

export interface GitPushExecutionResult {
  remote: string;
  branch: string;
  localHead: string | null;
  remoteHead: string | null;
  commandOutput: string;
}

const DEFAULT_TIMEOUT_MS = 25_000;

export async function getGitStatus(
  workspaceRoot: string,
): Promise<GitStatusExecutionResult> {
  const statusResult = await runGitCommand(workspaceRoot, [
    "status",
    "--short",
    "--branch",
  ]);

  if (statusResult.exitCode !== 0) {
    throw new Error(`git status failed: ${statusResult.stderr || statusResult.stdout}`);
  }

  const firstLine = statusResult.stdout.split(/\r?\n/)[0] || "";
  const branchMatch = firstLine.match(/^##\s+([^\s.]+)/);
  const branch = branchMatch ? branchMatch[1] : null;

  const statusSummary = statusResult.stdout.trim() || "Working tree clean.";

  return {
    branch,
    statusSummary,
    rawStatus: statusResult.stdout.trim(),
  };
}

export async function createCommitWithVerification(options: {
  workspaceRoot: string;
  message: string;
  addAll: boolean;
  paths: string[];
}): Promise<GitCommitExecutionResult> {
  const { workspaceRoot, message, addAll, paths } = options;

  if (addAll || paths.length === 0) {
    const addResult = await runGitCommand(workspaceRoot, ["add", "-A"]);
    if (addResult.exitCode !== 0) {
      throw new Error(`git add failed: ${addResult.stderr || addResult.stdout}`);
    }
  } else {
    const addResult = await runGitCommand(workspaceRoot, ["add", "--", ...paths]);
    if (addResult.exitCode !== 0) {
      throw new Error(`git add failed: ${addResult.stderr || addResult.stdout}`);
    }
  }

  const commitResult = await runGitCommand(workspaceRoot, ["commit", "-m", message]);
  if (commitResult.exitCode !== 0) {
    throw new Error(`git commit failed: ${commitResult.stderr || commitResult.stdout}`);
  }

  const hashResult = await runGitCommand(workspaceRoot, ["rev-parse", "HEAD"]);
  if (hashResult.exitCode !== 0) {
    return {
      commitHash: null,
      commitMessage: message,
      commandOutput: [commitResult.stdout, commitResult.stderr].filter(Boolean).join("\n"),
    };
  }

  return {
    commitHash: hashResult.stdout.trim() || null,
    commitMessage: message,
    commandOutput: [commitResult.stdout, commitResult.stderr].filter(Boolean).join("\n"),
  };
}

export async function pushWithVerification(options: {
  workspaceRoot: string;
  remote: string;
  branch: string;
}): Promise<GitPushExecutionResult> {
  const { workspaceRoot, remote, branch } = options;
  const pushResult = await runGitCommand(workspaceRoot, ["push", remote, branch]);
  if (pushResult.exitCode !== 0) {
    throw new Error(`git push failed: ${pushResult.stderr || pushResult.stdout}`);
  }

  const localHeadResult = await runGitCommand(workspaceRoot, ["rev-parse", "HEAD"]);
  const localHead =
    localHeadResult.exitCode === 0 ? localHeadResult.stdout.trim() || null : null;

  const remoteHeadResult = await runGitCommand(workspaceRoot, [
    "ls-remote",
    remote,
    `refs/heads/${branch}`,
  ]);
  const remoteHead =
    remoteHeadResult.exitCode === 0
      ? (remoteHeadResult.stdout.trim().split(/\s+/)[0] || null)
      : null;

  return {
    remote,
    branch,
    localHead,
    remoteHead,
    commandOutput: [pushResult.stdout, pushResult.stderr].filter(Boolean).join("\n"),
  };
}

export async function resolveCurrentBranch(
  workspaceRoot: string,
): Promise<string | null> {
  const branchResult = await runGitCommand(workspaceRoot, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (branchResult.exitCode !== 0) {
    return null;
  }
  const branch = branchResult.stdout.trim();
  return branch || null;
}

async function runGitCommand(
  workspaceRoot: string,
  args: string[],
): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd: workspaceRoot,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: typeof exitCode === "number" ? exitCode : 1,
        stdout,
        stderr,
      });
    });
  });
}
