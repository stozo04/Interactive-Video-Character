import path from "node:path";
import { resolvePathInWorkspace, type ResolvedWorkspacePath } from "./pathGuard";

export type WorkspaceActionType =
  | "command"
  | "mkdir"
  | "read"
  | "write"
  | "search"
  | "status"
  | "commit"
  | "push"
  | "delete";

export interface WorkspacePolicyDecision {
  action: WorkspaceActionType;
  allowed: boolean;
  requiresApproval: boolean;
  requiresVerification: boolean;
  policyNotes: string[];
  denialReason?: string;
  resolvedPath?: ResolvedWorkspacePath;
  resolvedSearchRoot?: ResolvedWorkspacePath;
}

const PATH_ACTIONS: ReadonlySet<WorkspaceActionType> = new Set([
  "mkdir",
  "read",
  "write",
  "delete",
]);

const BLOCKED_SEGMENT_PATTERNS = [/^\.git$/i];
const SAFE_COMMAND_PREFIXES = [
  "npm test",
  "npm run test",
  "npm run build",
  "npm run lint",
  "npm run test:ui",
  "npm run test:coverage",
] as const;
const SHELL_METACHAR_PATTERN = /[|;&><`]/;

export function evaluateWorkspacePolicy(options: {
  workspaceRoot: string;
  action: WorkspaceActionType;
  args: Record<string, unknown>;
  fullAuto?: boolean;
}): WorkspacePolicyDecision {
  const { workspaceRoot, action, args, fullAuto } = options;
  const policyNotes: string[] = [];
  const requiresApproval =
    !fullAuto &&
    (action === "delete" ||
      action === "commit" ||
      action === "push" ||
      action === "command");
  const requiresVerification =
    action === "delete" || action === "commit" || action === "push";

  try {
    if (action === "command") {
      const rawCommand =
        typeof args.command === "string" ? args.command.trim() : "";
      if (!rawCommand) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "args.command is required for command action.",
        });
      }

      const normalizedCommand = normalizeCommand(rawCommand);
      if (!normalizedCommand) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "args.command is empty after normalization.",
        });
      }

      if (SHELL_METACHAR_PATTERN.test(normalizedCommand)) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason:
            "Command contains disallowed shell metacharacters (| ; & > < `).",
        });
      }

      const isAllowedCommand = SAFE_COMMAND_PREFIXES.some((prefix) =>
        normalizedCommand === prefix || normalizedCommand.startsWith(`${prefix} `),
      );
      if (!isAllowedCommand) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason:
            `Command not allowlisted: ${normalizedCommand}. Allowed prefixes: ${SAFE_COMMAND_PREFIXES.join(", ")}`,
        });
      }

      if (typeof args.timeoutMs !== "undefined") {
        const timeoutMs = Number(args.timeoutMs);
        if (!Number.isFinite(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 600_000) {
          return deny({
            action,
            requiresApproval,
            requiresVerification,
            policyNotes,
            denialReason:
              "args.timeoutMs must be a number between 5000 and 600000 when provided.",
          });
        }
      }

      policyNotes.push("Command matched allowlisted npm script prefix.");
      policyNotes.push("Command execution is constrained to the workspace root.");
      if (requiresApproval) {
        policyNotes.push("Command requires explicit approval outside full-auto mode.");
      } else {
        policyNotes.push("Command allowed without approval in full-auto mode.");
      }

      return {
        action,
        allowed: true,
        requiresApproval,
        requiresVerification,
        policyNotes,
      };
    }

    if (PATH_ACTIONS.has(action)) {
      const pathValue =
        typeof args.path === "string" ? args.path.trim() : "";
      if (!pathValue) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "args.path is required for this action.",
        });
      }

      const resolvedPath = resolvePathInWorkspace(workspaceRoot, pathValue);
      const pathSegments = splitPathSegments(resolvedPath.relativePath);

      if (resolvedPath.absolutePath === resolvedPath.workspaceRoot) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "Refusing to target the workspace root directly.",
        });
      }

      const blockedSegment = pathSegments.find((segment) =>
        BLOCKED_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment)),
      );
      if (blockedSegment) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: `Refusing to target sensitive path segment: ${blockedSegment}`,
        });
      }

      policyNotes.push("Path resolved inside workspace root.");

      return {
        action,
        allowed: true,
        requiresApproval,
        requiresVerification,
        policyNotes,
        resolvedPath,
      };
    }

    if (action === "search") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "args.query is required for search.",
        });
      }

      const rootPath =
        typeof args.rootPath === "string" && args.rootPath.trim()
          ? args.rootPath.trim()
          : ".";
      const resolvedSearchRoot = resolvePathInWorkspace(workspaceRoot, rootPath);
      const blockedSegment = splitPathSegments(resolvedSearchRoot.relativePath).find(
        (segment) => BLOCKED_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment)),
      );
      if (blockedSegment) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: `Refusing to search inside sensitive path segment: ${blockedSegment}`,
        });
      }

      policyNotes.push("Search root resolved inside workspace root.");
      return {
        action,
        allowed: true,
        requiresApproval,
        requiresVerification,
        policyNotes,
        resolvedSearchRoot,
      };
    }

    if (action === "commit") {
      const message =
        typeof args.message === "string" ? args.message.trim() : "";
      if (!message) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "args.message is required for commit.",
        });
      }

      policyNotes.push("Commit message is present.");
      policyNotes.push("Commit requires explicit user approval.");
      policyNotes.push("Commit requires post-action verification.");
      return {
        action,
        allowed: true,
        requiresApproval,
        requiresVerification,
        policyNotes,
      };
    }

    if (action === "push") {
      const remote =
        typeof args.remote === "string" && args.remote.trim()
          ? args.remote.trim()
          : "origin";
      const branch =
        typeof args.branch === "string" ? args.branch.trim() : "";
      if (remote !== "origin") {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "Only push to remote='origin' is allowed.",
        });
      }

      if (branch.includes("..") || branch.includes(":")) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "Invalid branch name.",
        });
      }

      policyNotes.push("Push remote constrained to origin.");
      policyNotes.push("Push requires explicit user approval.");
      policyNotes.push("Push requires post-action verification.");
      return {
        action,
        allowed: true,
        requiresApproval,
        requiresVerification,
        policyNotes,
      };
    }

    if (action === "status") {
      policyNotes.push("Git status allowed without approval.");
      return {
        action,
        allowed: true,
        requiresApproval,
        requiresVerification,
        policyNotes,
      };
    }

    return deny({
      action,
      requiresApproval,
      requiresVerification,
      policyNotes,
      denialReason: `Unsupported action: ${action}`,
    });
  } catch (error) {
    return deny({
      action,
      requiresApproval,
      requiresVerification,
      policyNotes,
      denialReason:
        error instanceof Error ? error.message : "Unknown policy evaluation error.",
    });
  }
}

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function deny(options: {
  action: WorkspaceActionType;
  requiresApproval: boolean;
  requiresVerification: boolean;
  policyNotes: string[];
  denialReason: string;
}): WorkspacePolicyDecision {
  return {
    action: options.action,
    allowed: false,
    requiresApproval: options.requiresApproval,
    requiresVerification: options.requiresVerification,
    policyNotes: options.policyNotes,
    denialReason: options.denialReason,
  };
}

function splitPathSegments(relativePath: string): string[] {
  return relativePath
    .split(path.sep)
    .flatMap((segment) => segment.split("/"))
    .filter((segment) => segment.length > 0 && segment !== ".");
}
