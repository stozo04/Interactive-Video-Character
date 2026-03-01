import path from "node:path";
import {
  createDirectoryWithVerification,
  deletePathWithVerification,
  readFileWithBounds,
  searchContentInTree,
  writeFileWithVerification,
} from "./fsOps";
import {
  createCommitWithVerification,
  getGitStatus,
  pushWithVerification,
  resolveCurrentBranch,
} from "./gitOps";
import { executeGifAction } from "./gifOps";
import {
  evaluateWorkspacePolicy,
  type WorkspaceActionType,
} from "./policyEngine";
import {
  type WorkspaceRun,
  type WorkspaceRunStep,
  type WorkspaceRunStepStatus,
  type WorkspaceRunStepType,
  type WorkspaceRunStatus,
  type WorkspaceRunStore,
} from "./runStore";

const LOG_PREFIX = "[WorkspaceAgentExecutor]";
const TERMINAL_STATUSES: ReadonlySet<WorkspaceRunStatus> = new Set([
  "success",
  "failed",
  "verification_failed",
  "rejected",
]);

const SUPPORTED_ACTIONS: ReadonlySet<WorkspaceActionType> = new Set([
  "mkdir",
  "read",
  "write",
  "search",
  "status",
  "commit",
  "push",
  "delete",
  "gif",
]);

interface ExecuteRunOptions {
  runStore: WorkspaceRunStore;
  runId: string;
  workspaceRoot: string;
}

export async function executeRunInBackground(
  options: ExecuteRunOptions,
): Promise<void> {
  const { runStore, runId, workspaceRoot } = options;
  const run = await runStore.getRun(runId);
  if (!run) {
    return;
  }

  if (TERMINAL_STATUSES.has(run.status) || run.status === "requires_approval") {
    return;
  }

  const action = asAction(run.request.action);
  if (!action) {
    await runStore.updateRun(runId, (currentRun) =>
      failRun(currentRun, "Unsupported action requested.", "policy_check", [
        `Unsupported action requested: ${currentRun.request.action}`,
      ]),
    );
    return;
  }

  const policy = evaluateWorkspacePolicy({
    workspaceRoot,
    action,
    args: run.request.args,
  });

  const steps: WorkspaceRunStep[] = [];
  steps.push(
    buildStep("s1", "policy_check", policy.allowed ? "success" : "failed", {
      evidence: [...policy.policyNotes],
      error: policy.denialReason,
      exitCode: policy.allowed ? 0 : 1,
    }),
  );

  if (!policy.allowed) {
    await runStore.updateRun(runId, (currentRun) => ({
      ...currentRun,
      status: "failed",
      summary: policy.denialReason || "Policy denied request.",
      steps: cloneSteps(steps),
    }));
    return;
  }

  if (policy.requiresApproval && run.approval.status !== "approved") {
    steps.push(
      buildStep("s2", "approval", "pending", {
        evidence: [
          `Action ${action} requires explicit approval.`,
          "Run is waiting for approve/reject decision.",
        ],
        exitCode: null,
      }),
    );

    await runStore.updateRun(runId, (currentRun) => ({
      ...currentRun,
      status: "requires_approval",
      summary: `Approval required before executing ${action}.`,
      approval: {
        required: true,
        status: "pending",
        reason: `Action ${action} requires approval.`,
      },
      steps: cloneSteps(steps),
    }));
    return;
  }

  if (policy.requiresApproval && run.approval.status === "approved") {
    steps.push(
      buildStep("s2", "approval", "success", {
        evidence: [
          "Action requires approval.",
          `Approval granted${run.approval.reason ? `: ${run.approval.reason}` : "."}`,
        ],
        exitCode: 0,
      }),
    );
  }

  await runStore.updateRun(runId, (currentRun) => ({
    ...currentRun,
    status: "running",
    summary: `Executing ${action}.`,
    approval: policy.requiresApproval
      ? {
          ...currentRun.approval,
          required: true,
          status: currentRun.approval.status === "approved" ? "approved" : "pending",
        }
      : {
          required: false,
          status: "not_required",
        },
    steps: cloneSteps(steps),
  }));

  try {
    const execution = await executeAction({
      action,
      run,
      policy,
      workspaceRoot,
    });

    const mergedSteps = [...steps, ...execution.steps];
    const finalStatus: WorkspaceRunStatus =
      execution.status === "success"
        ? "success"
        : execution.status === "verification_failed"
          ? "verification_failed"
          : "failed";

    await runStore.updateRun(runId, (currentRun) => ({
      ...currentRun,
      status: finalStatus,
      summary: execution.summary,
      steps: cloneSteps(mergedSteps),
    }));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown workspace action error.";

    console.error(`${LOG_PREFIX} Run execution failed`, {
      runId,
      action,
      message,
      error,
    });

    const failureSteps = [
      ...steps,
      buildStep("s_error", actionToStepType(action), "failed", {
        evidence: ["Execution threw before completion."],
        error: message,
        exitCode: 1,
      }),
    ];

    await runStore.updateRun(runId, (currentRun) => ({
      ...currentRun,
      status: "failed",
      summary: message,
      steps: cloneSteps(failureSteps),
    }));
  }
}

interface ExecuteActionContext {
  action: WorkspaceActionType;
  run: WorkspaceRun;
  policy: ReturnType<typeof evaluateWorkspacePolicy>;
  workspaceRoot: string;
}

interface ExecuteActionResult {
  status: "success" | "failed" | "verification_failed";
  summary: string;
  steps: WorkspaceRunStep[];
}

async function executeAction(
  context: ExecuteActionContext,
): Promise<ExecuteActionResult> {
  const { action, run, policy, workspaceRoot } = context;
  const args = run.request.args;

  switch (action) {
    case "mkdir": {
      const resolved = requireResolvedPath(policy);
      const mkdirResult = await createDirectoryWithVerification(
        resolved.absolutePath,
      );
      const step = buildStep("s_exec", "mkdir", "success", {
        evidence: [
          `Requested path: ${String(args.path || "")}`,
          `Resolved path: ${resolved.relativePath}`,
          mkdirResult.existedBefore
            ? "Directory already existed before execution."
            : "Directory created by this run.",
        ],
        exitCode: 0,
      });
      const verify = buildStep(
        "s_verify",
        "verify",
        mkdirResult.existsAfter ? "success" : "verification_failed",
        {
          evidence: mkdirResult.existsAfter
            ? ["Verification passed: directory exists after execution."]
            : ["Verification failed: directory does not exist after execution."],
          exitCode: mkdirResult.existsAfter ? 0 : 1,
        },
      );
      return {
        status: mkdirResult.existsAfter ? "success" : "verification_failed",
        summary: mkdirResult.existsAfter
          ? `mkdir completed for ${resolved.relativePath}`
          : `mkdir executed but verification failed for ${resolved.relativePath}`,
        steps: [step, verify],
      };
    }
    case "read": {
      const resolved = requireResolvedPath(policy);
      const readResult = await readFileWithBounds(resolved.absolutePath);
      if (!readResult.exists) {
        return {
          status: "failed",
          summary: `Read failed: path not found (${resolved.relativePath}).`,
          steps: [
            buildStep("s_exec", "read", "failed", {
              evidence: [`Resolved path: ${resolved.relativePath}`],
              error: "Path not found.",
              exitCode: 1,
            }),
          ],
        };
      }
      if (!readResult.isFile) {
        return {
          status: "failed",
          summary: `Read failed: path is not a file (${resolved.relativePath}).`,
          steps: [
            buildStep("s_exec", "read", "failed", {
              evidence: [`Resolved path: ${resolved.relativePath}`],
              error: "Path is not a file.",
              exitCode: 1,
            }),
          ],
        };
      }
      const preview = readResult.content.slice(0, 1200);
      return {
        status: "success",
        summary: `Read completed for ${resolved.relativePath}.`,
        steps: [
          buildStep("s_exec", "read", "success", {
            evidence: [
              `Resolved path: ${resolved.relativePath}`,
              `Size bytes: ${readResult.sizeBytes}`,
              `Truncated: ${readResult.truncated ? "yes" : "no"}`,
              `Preview: ${preview || "(empty file)"}`,
            ],
            exitCode: 0,
          }),
        ],
      };
    }
    case "write": {
      const resolved = requireResolvedPath(policy);
      const content = typeof args.content === "string" ? args.content : "";
      const mode: "overwrite" | "append" = args.append === true ? "append" : "overwrite";
      const writeResult = await writeFileWithVerification({
        absolutePath: resolved.absolutePath,
        content,
        mode,
      });
      const verifyRead = await readFileWithBounds(resolved.absolutePath, 32 * 1024);
      const verified =
        verifyRead.exists && verifyRead.isFile && verifyRead.content.includes(content.slice(0, Math.min(200, content.length)));
      return {
        status: verified ? "success" : "verification_failed",
        summary: verified
          ? `write completed for ${resolved.relativePath}`
          : `write executed but verification failed for ${resolved.relativePath}`,
        steps: [
          buildStep("s_exec", "write", "success", {
            evidence: [
              `Resolved path: ${resolved.relativePath}`,
              `Mode: ${writeResult.mode}`,
              `Bytes written: ${writeResult.bytesWritten}`,
              writeResult.existedBefore
                ? "File existed before execution."
                : "File created by this run.",
            ],
            exitCode: 0,
          }),
          buildStep(
            "s_verify",
            "verify",
            verified ? "success" : "verification_failed",
            {
              evidence: verified
                ? ["Verification passed: file content was written."]
                : ["Verification failed: written content could not be confirmed."],
              exitCode: verified ? 0 : 1,
            },
          ),
        ],
      };
    }
    case "search": {
      const resolvedRoot = policy.resolvedSearchRoot;
      if (!resolvedRoot) {
        throw new Error("Search root resolution missing.");
      }
      const query = String(args.query || "");
      const searchResult = await searchContentInTree({
        rootAbsolutePath: resolvedRoot.absolutePath,
        query,
        caseSensitive: args.caseSensitive === true,
      });

      const previewLines = searchResult.matches
        .slice(0, 25)
        .map(
          (match) =>
            `${match.relativePath}:${match.lineNumber}: ${match.lineText}`,
        );
      return {
        status: "success",
        summary: `search completed (${searchResult.matches.length} matches in ${searchResult.filesScanned} files).`,
        steps: [
          buildStep("s_exec", "search", "success", {
            evidence: [
              `Query: ${query}`,
              `Root: ${resolvedRoot.relativePath || "."}`,
              `Files scanned: ${searchResult.filesScanned}`,
              `Matches: ${searchResult.matches.length}`,
              `Truncated: ${searchResult.truncated ? "yes" : "no"}`,
              ...previewLines,
            ],
            exitCode: 0,
          }),
        ],
      };
    }
    case "status": {
      const statusResult = await getGitStatus(workspaceRoot);
      return {
        status: "success",
        summary: "git status completed.",
        steps: [
          buildStep("s_exec", "status", "success", {
            evidence: [
              `Branch: ${statusResult.branch || "(unknown)"}`,
              statusResult.statusSummary,
            ],
            exitCode: 0,
          }),
        ],
      };
    }
    case "commit": {
      const message = String(args.message || "").trim();
      const addAll = args.addAll !== false;
      const paths = Array.isArray(args.paths)
        ? args.paths
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [];

      const commitResult = await createCommitWithVerification({
        workspaceRoot,
        message,
        addAll,
        paths,
      });

      const verified = Boolean(commitResult.commitHash);
      return {
        status: verified ? "success" : "verification_failed",
        summary: verified
          ? `commit completed (${commitResult.commitHash}).`
          : "commit executed but verification failed (missing commit hash).",
        steps: [
          buildStep("s_exec", "commit", "success", {
            evidence: [
              `Commit message: ${message}`,
              `Commit hash: ${commitResult.commitHash || "(unavailable)"}`,
              commitResult.commandOutput || "Commit command executed.",
            ],
            exitCode: 0,
          }),
          buildStep(
            "s_verify",
            "verify",
            verified ? "success" : "verification_failed",
            {
              evidence: verified
                ? ["Verification passed: commit hash resolved from HEAD."]
                : ["Verification failed: unable to resolve commit hash from HEAD."],
              exitCode: verified ? 0 : 1,
            },
          ),
        ],
      };
    }
    case "push": {
      const remote =
        typeof args.remote === "string" && args.remote.trim()
          ? args.remote.trim()
          : "origin";
      const branch =
        typeof args.branch === "string" && args.branch.trim()
          ? args.branch.trim()
          : (await resolveCurrentBranch(workspaceRoot)) || "main";

      const pushResult = await pushWithVerification({
        workspaceRoot,
        remote,
        branch,
      });

      const verified =
        Boolean(pushResult.localHead) &&
        Boolean(pushResult.remoteHead) &&
        pushResult.localHead === pushResult.remoteHead;
      return {
        status: verified ? "success" : "verification_failed",
        summary: verified
          ? `push completed to ${remote}/${branch}.`
          : `push executed but verification failed for ${remote}/${branch}.`,
        steps: [
          buildStep("s_exec", "push", "success", {
            evidence: [
              `Remote: ${remote}`,
              `Branch: ${branch}`,
              `Local HEAD: ${pushResult.localHead || "(unavailable)"}`,
              `Remote HEAD: ${pushResult.remoteHead || "(unavailable)"}`,
              pushResult.commandOutput || "Push command executed.",
            ],
            exitCode: 0,
          }),
          buildStep(
            "s_verify",
            "verify",
            verified ? "success" : "verification_failed",
            {
              evidence: verified
                ? ["Verification passed: remote HEAD matches local HEAD."]
                : ["Verification failed: remote HEAD does not match local HEAD."],
              exitCode: verified ? 0 : 1,
            },
          ),
        ],
      };
    }
    case "delete": {
      const resolved = requireResolvedPath(policy);
      const recursive = args.recursive === true;
      const deleteResult = await deletePathWithVerification({
        absolutePath: resolved.absolutePath,
        recursive,
      });
      const verified = !deleteResult.existsAfter;
      return {
        status: verified ? "success" : "verification_failed",
        summary: verified
          ? `delete completed for ${resolved.relativePath}.`
          : `delete executed but verification failed for ${resolved.relativePath}.`,
        steps: [
          buildStep("s_exec", "delete", "success", {
            evidence: [
              `Resolved path: ${resolved.relativePath}`,
              `Recursive: ${recursive ? "yes" : "no"}`,
              `Target existed before: ${deleteResult.existedBefore ? "yes" : "no"}`,
              `Deleted type: ${deleteResult.deletedType}`,
            ],
            exitCode: 0,
          }),
          buildStep(
            "s_verify",
            "verify",
            verified ? "success" : "verification_failed",
            {
              evidence: verified
                ? ["Verification passed: path no longer exists."]
                : ["Verification failed: path still exists."],
              exitCode: verified ? 0 : 1,
            },
          ),
        ],
      };
    }
    case "gif": {
      const gifResult = await executeGifAction({
        args: run.request.args,
        workspaceRoot,
      });

      const stepStatus: WorkspaceRunStepStatus =
        gifResult.status === "success"
          ? "success"
          : gifResult.status === "verification_failed"
            ? "verification_failed"
            : "failed";

      const steps: WorkspaceRunStep[] = [
        buildStep("s_exec", "gif", stepStatus, {
          evidence: gifResult.evidence,
          error: stepStatus === "failed" ? gifResult.summary : undefined,
          exitCode: stepStatus === "success" ? 0 : 1,
        }),
      ];

      if (gifResult.status === "verification_failed") {
        steps.push(
          buildStep("s_verify", "verify", "verification_failed", {
            evidence: [gifResult.summary],
            exitCode: 1,
          }),
        );
      }

      return {
        status: gifResult.status,
        summary: gifResult.summary,
        steps,
      };
    }
    default:
      return {
        status: "failed",
        summary: `Unsupported action ${action}.`,
        steps: [
          buildStep("s_exec", actionToStepType(action), "failed", {
            evidence: [`Unsupported action: ${action}`],
            exitCode: 1,
          }),
        ],
      };
  }
}

function asAction(raw: string): WorkspaceActionType | null {
  if (!SUPPORTED_ACTIONS.has(raw as WorkspaceActionType)) {
    return null;
  }
  return raw as WorkspaceActionType;
}

function requireResolvedPath(
  policy: ReturnType<typeof evaluateWorkspacePolicy>,
): { absolutePath: string; relativePath: string } {
  if (!policy.resolvedPath) {
    throw new Error("Resolved path is missing after policy check.");
  }
  return {
    absolutePath: policy.resolvedPath.absolutePath,
    relativePath: normalizeRelativePath(policy.resolvedPath.relativePath),
  };
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function actionToStepType(action: WorkspaceActionType): WorkspaceRunStepType {
  return action;
}

function buildStep(
  stepId: string,
  type: WorkspaceRunStepType,
  status: WorkspaceRunStepStatus,
  options: {
    evidence: string[];
    exitCode: number | null;
    error?: string;
  },
): WorkspaceRunStep {
  return {
    stepId,
    type,
    status,
    exitCode: options.exitCode,
    evidence: options.evidence,
    error: options.error,
    startedAt: nowIso(),
    finishedAt: nowIso(),
  };
}

function failRun(
  run: WorkspaceRun,
  summary: string,
  stepType: WorkspaceRunStepType,
  evidence: string[],
): WorkspaceRun {
  return {
    ...run,
    status: "failed",
    summary,
    steps: [
      buildStep("s_error", stepType, "failed", {
        evidence,
        exitCode: 1,
      }),
    ],
  };
}

function cloneSteps(steps: WorkspaceRunStep[]): WorkspaceRunStep[] {
  return steps.map((step) => ({
    ...step,
    evidence: [...step.evidence],
  }));
}

function nowIso(): string {
  return new Date().toISOString();
}
