import os from "node:os";
import path from "node:path";
import { resolvePathInWorkspace, type ResolvedWorkspacePath } from "./pathGuard";

export type WorkspaceActionType =
  | "mkdir"
  | "read"
  | "write"
  | "search"
  | "status"
  | "commit"
  | "push"
  | "delete"
  | "gif";

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
const GIF_ACTIONS: ReadonlySet<string> = new Set([
  "search",
  "preview",
  "download",
  "extract_stills",
  "extract_sheet",
]);

export function evaluateWorkspacePolicy(options: {
  workspaceRoot: string;
  action: WorkspaceActionType;
  args: Record<string, unknown>;
}): WorkspacePolicyDecision {
  const { workspaceRoot, action, args } = options;
  const policyNotes: string[] = [];
  const requiresApproval = action === "delete" || action === "commit" || action === "push";
  const requiresVerification =
    action === "delete" || action === "commit" || action === "push";

  try {
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

    if (action === "gif") {
      const gifAction = typeof args.action === "string" ? args.action.trim() : "";
      if (!gifAction || !GIF_ACTIONS.has(gifAction)) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "args.action must be a supported gif action.",
        });
      }

      if (gifAction === "search" || gifAction === "preview") {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) {
          return deny({
            action,
            requiresApproval,
            requiresVerification,
            policyNotes,
            denialReason: "gif search/preview requires args.query.",
          });
        }
      }

      if (gifAction === "download") {
        const hasUrl = typeof args.url === "string" && args.url.trim().length > 0;
        const hasId = typeof args.id === "string" && args.id.trim().length > 0;
        const hasQuery = typeof args.query === "string" && args.query.trim().length > 0;
        if (!hasUrl && !hasId && !hasQuery) {
          return deny({
            action,
            requiresApproval,
            requiresVerification,
            policyNotes,
            denialReason: "gif download requires args.url, args.id, or args.query.",
          });
        }
      }

      if (gifAction === "extract_stills" || gifAction === "extract_sheet") {
        if (typeof args.gif_path !== "string" || !args.gif_path.trim()) {
          return deny({
            action,
            requiresApproval,
            requiresVerification,
            policyNotes,
            denialReason: "gif extract requires args.gif_path.",
          });
        }
      }

      const downloadsRoot = path.join(os.homedir(), "Downloads");
      const allowedRoots = [workspaceRoot, downloadsRoot];

      const gifPath = resolvePathIfPresent(args.gif_path, workspaceRoot);
      if (gifPath && !isWithinAllowedRoots(gifPath, allowedRoots)) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "gif_path must be inside workspace root or ~/Downloads.",
        });
      }

      const outputDir = resolvePathIfPresent(args.output_dir, workspaceRoot);
      if (outputDir && !isWithinAllowedRoots(outputDir, allowedRoots)) {
        return deny({
          action,
          requiresApproval,
          requiresVerification,
          policyNotes,
          denialReason: "output_dir must be inside workspace root or ~/Downloads.",
        });
      }

      policyNotes.push(`gif action allowed: ${gifAction}`);
      policyNotes.push(`Allowed roots: ${allowedRoots.join(", ")}`);
      return {
        action,
        allowed: true,
        requiresApproval: false,
        requiresVerification: false,
        policyNotes,
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

function resolvePathIfPresent(value: unknown, workspaceRoot: string): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const raw = value.trim();
  const expanded = expandHomePath(raw);
  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspaceRoot, expanded);
  return resolved;
}

function isWithinAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
  const normalizedTarget = normalizePath(targetPath);
  return allowedRoots.some((root) =>
    isPathWithin(normalizePath(root), normalizedTarget),
  );
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  if (process.platform === "win32") {
    return resolved.toLowerCase();
  }
  return resolved;
}

function isPathWithin(root: string, target: string): boolean {
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return target === root || target.startsWith(rootWithSep);
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
